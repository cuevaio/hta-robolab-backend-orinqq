import type { MissionProvider } from "../contracts";
import { generationPrompt, repairPrompt } from "../prompts/activity-v2";
import { ProviderError } from "./errors";
import { limitedText } from "./groq";

export const DEFAULT_OLLAMA_MODEL = "qwen2.5:3b-instruct-q4_K_M";
const integer = { type: "integer" };
const position = { type: "object", properties: { row: integer, col: integer }, required: ["row", "col"], additionalProperties: false };
/** Guía de salida; la autoridad sigue siendo parseCustomMission + validate_mission. */
export const OLLAMA_MISSION_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: 1 }, id: { type: "string" }, revision: { const: 1 },
    title: { type: "string" }, objective: { type: "string" }, grade: { enum: [2, 3, 4] },
    grid: { type: "object", properties: {
      rows: { ...integer, minimum: 2, maximum: 5 }, cols: { ...integer, minimum: 2, maximum: 5 },
      cells: { type: "array", minItems: 4, maxItems: 25, items: {
        type: "object", properties: { position, terrain: { enum: ["plain", "rough"] }, obstacle: { type: "boolean" }, cost: { ...integer, minimum: 1, maximum: 100 } },
        required: ["position", "terrain", "obstacle", "cost"], additionalProperties: false,
      } },
    }, required: ["rows", "cols", "cells"], additionalProperties: false },
    start: position, goal: position, initialHeading: { enum: [0, 90, 180, 270] },
    checkpoints: { type: "array", maxItems: 6, items: { type: "object", properties: { id: { type: "string" }, position }, required: ["id", "position"], additionalProperties: false } },
    energyBudget: { ...integer, minimum: 1, maximum: 10000 },
    allowedCommands: { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["FORWARD", "BACKWARD", "TURN_LEFT", "TURN_RIGHT"] } },
  },
  required: ["schemaVersion", "id", "revision", "title", "objective", "grade", "grid", "start", "goal", "initialHeading", "checkpoints", "energyBudget", "allowedCommands"],
  additionalProperties: false,
};

/** Solo servidor local. La URL viene del operador, nunca de una petición del navegador. */
export class OllamaProvider implements MissionProvider {
  readonly name = "ollama" as const;
  constructor(
    private readonly baseUrl = "http://127.0.0.1:11435",
    readonly model = DEFAULT_OLLAMA_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(5000), redirect: "error" });
      if (!response.ok) { await response.body?.cancel(); return false; }
      const data = JSON.parse(await limitedText(response, AbortSignal.timeout(5000))) as { models?: { name?: string }[] };
      return Array.isArray(data.models) && data.models.some(m => m.name === this.model);
    } catch { return false; }
  }
  async propose(input: Parameters<MissionProvider["propose"]>[0]): Promise<unknown> {
    const fail = (code: ConstructorParameters<typeof ProviderError>[0]) => new ProviderError(code, "ollama");
    try {
      const checkpoints = input.request.constraints?.checkpoints ?? input.request.grade - 1;
      const format = {
        ...OLLAMA_MISSION_SCHEMA,
        properties: {
          ...OLLAMA_MISSION_SCHEMA.properties,
          grade: { const: input.request.grade },
          checkpoints: { ...OLLAMA_MISSION_SCHEMA.properties.checkpoints, minItems: checkpoints, maxItems: checkpoints },
        },
      };
      const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, signal: input.signal,
        body: JSON.stringify({
          model: this.model, stream: false, format, keep_alive: "10m",
          options: { num_ctx: 8192, num_predict: 4096, temperature: 0.3 },
          messages: [
            { role: "system", content: `${input.systemPrompt}\nPara el equipo local prefiere tableros compactos de 3x3. Enumera cada celda exactamente una vez; deja un recorrido libre que visite las estaciones antes de la meta. Incluye exactamente ${checkpoints} estaciones y no pongas ninguna sobre el inicio ni la meta.` },
            { role: "user", content: generationPrompt(input.request) },
            ...(input.previousIssues.length ? [{ role: "user", content: repairPrompt(input.previousIssues, input.previousProposal) }] : []),
          ],
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) throw fail("PROVIDER_NOT_CONFIGURED");
        if (response.status === 429) throw fail("PROVIDER_RATE_LIMIT");
        throw fail("PROVIDER_UNAVAILABLE");
      }
      let envelope;
      try { envelope = JSON.parse(await limitedText(response, input.signal)); }
      catch (error) { if (error instanceof ProviderError) throw error; throw fail("SCHEMA_INVALID"); }
      if (envelope?.done !== true || envelope.done_reason !== "stop" || typeof envelope.message?.content !== "string") throw fail("SCHEMA_INVALID");
      let mission: unknown;
      try { mission = JSON.parse(envelope.message.content); } catch { throw fail("SCHEMA_INVALID"); }
      if (!mission || typeof mission !== "object" || Array.isArray(mission)) throw fail("SCHEMA_INVALID");
      return mission;
    } catch (error) {
      if (input.signal.aborted) throw fail("PROVIDER_TIMEOUT");
      if (error instanceof ProviderError) throw error;
      throw fail("PROVIDER_UNAVAILABLE");
    }
  }
}
