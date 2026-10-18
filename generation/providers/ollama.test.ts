import { describe, expect, it } from "vitest";
import { missionFixtures } from "../../domain/mission/fixtures";
import { OllamaProvider } from "./ollama";
import { MAX_GROQ_RESPONSE_BYTES } from "./groq";

const input = () => ({ systemPrompt: "Contrato", request: { objective: "Sumar los costos del recorrido", grade: 2 as const }, previousIssues: [], signal: new AbortController().signal });
const reply = (content: string, done = true, done_reason = "stop") => Response.json({ message: { role: "assistant", content }, done, done_reason });

describe("Ollama local", () => {
  it("usa chat JSON con esquema, modelo cuantizado y contexto limitado sin servicios cloud", async () => {
    let sent: Record<string, unknown> | undefined;
    const provider = new OllamaProvider("http://127.0.0.1:11435", undefined, async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:11435/api/chat");
      sent = JSON.parse(String(init?.body));
      return reply(JSON.stringify(missionFixtures[0]));
    });
    expect(await provider.propose(input())).toEqual(missionFixtures[0]);
    expect(sent).toMatchObject({ format: { properties: { allowedCommands: { const: ["FORWARD", "BACKWARD", "TURN_LEFT", "TURN_RIGHT"] } } } });
    expect(sent).toMatchObject({ model: "qwen2.5:3b-instruct-q4_K_M", stream: false, format: { type: "object", required: expect.arrayContaining(["grid", "checkpoints"]) }, options: { num_ctx: 8192, num_predict: 4096 }, keep_alive: "10m" });
  });
  it("envía la propuesta anterior y los errores para reparar", async () => {
    const provider = new OllamaProvider("http://127.0.0.1:11435", undefined, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.messages[2].content).toContain("energyBudget");
      return reply(JSON.stringify(missionFixtures[0]));
    });
    await provider.propose({ ...input(), previousIssues: [{ code: "UNSOLVABLE", path: "energyBudget", message: "Sin energía" }], previousProposal: { energyBudget: 1 } });
  });
  it.each([reply("{}", false), reply("{}", true, "length"), reply("no es JSON"), reply("[]"), Response.json({})])("rechaza respuestas incompletas o ajenas al contrato", async (response) => {
    const p = new OllamaProvider("http://127.0.0.1:11435", undefined, async () => response);
    await expect(p.propose(input())).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  });
  it("acota la respuesta aunque no declare Content-Length", async () => {
    const p = new OllamaProvider("http://127.0.0.1:11435", undefined, async () => new Response("x".repeat(MAX_GROQ_RESPONSE_BYTES + 1)));
    await expect(p.propose(input())).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_TOO_LARGE" });
  });
  it.each([[404, "PROVIDER_NOT_CONFIGURED"], [429, "PROVIDER_RATE_LIMIT"], [503, "PROVIDER_UNAVAILABLE"]])("convierte HTTP %s a un error seguro", async (status, code) => {
    const p = new OllamaProvider("http://127.0.0.1:11435", undefined, async () => new Response("detalle privado", { status: Number(status) }));
    await expect(p.propose(input())).rejects.toMatchObject({ code });
  });
  it("propaga cancelación sin filtrar errores internos", async () => {
    const controller = new AbortController(); controller.abort();
    const p = new OllamaProvider("http://127.0.0.1:11435", undefined, async (_url, init) => { expect(init?.signal).toBe(controller.signal); throw new Error("privado"); });
    await expect(p.propose({ ...input(), signal: controller.signal })).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });
});

it("comprueba que el modelo esté descargado, sin confundir el servidor con el modelo listo", async () => {
  const available = new OllamaProvider("http://127.0.0.1:11435", undefined, async () => Response.json({ models: [{ name: "qwen2.5:3b-instruct-q4_K_M" }] }));
  expect(await available.isAvailable()).toBe(true);
  const empty = new OllamaProvider("http://127.0.0.1:11435", undefined, async () => Response.json({ models: [] }));
  expect(await empty.isAvailable()).toBe(false);
});

it.each([[2, undefined, 1], [3, undefined, 2], [4, undefined, 3], [2, 0, 0]])("acota estaciones para grado %s y respeta la cantidad explícita %s", async (grade, requested, expected) => {
  const p = new OllamaProvider(undefined, undefined, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.format.properties.grade).toEqual({ const: grade });
    expect(body.format.properties.checkpoints).toMatchObject({ minItems: expected, maxItems: expected });
    return reply(JSON.stringify(missionFixtures[0]));
  });
  await p.propose({ ...input(), request: { ...input().request, grade: grade as 2 | 3 | 4, ...(requested !== undefined ? { constraints: { checkpoints: requested } } : {}) } });
});
