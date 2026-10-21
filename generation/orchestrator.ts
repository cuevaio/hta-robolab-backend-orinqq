import type { Mission, ValidationIssue } from "../domain/mission/contracts";
import type {
  GenerationEvent,
  MissionProvider,
  GenerationErrorCode,
} from "./contracts";
import { GENERATION_POLICY } from "./contracts";
import { generate_map, validate_mission, evaluate_difficulty } from "./tools";
import { parseActivityRequest } from "./request";
import type { ActivityRequest } from "./request";
import {
  ACTIVITY_PROMPT_VERSION as MECHANICS_PROMPT_VERSION,
  ACTIVITY_SYSTEM_PROMPT as MECHANICS_SYSTEM_PROMPT,
} from "./prompts/activity-v3";
import { ACTIVITY_PROMPT_VERSION as LEGACY_PROMPT_VERSION, ACTIVITY_SYSTEM_PROMPT as LEGACY_SYSTEM_PROMPT } from "./prompts/activity-v2";
import { validateMechanic } from "../domain/mission/mechanics";
import { ProviderError } from "./providers/errors";
export type GeneratedProposal = {
  mission: Mission;
  origin: "ai_generated" | "template_fallback";
  calls: number;
  repairs: number;
  promptVersion: string;
  provider: string;
  model: string;
  errorCode?: GenerationErrorCode;
  warning?: string;
  fallbackSatisfiesConstraints: boolean;
  metrics: ReturnType<typeof evaluate_difficulty>;
  events: GenerationEvent[];
};
export function constraintIssues(
  m: Mission,
  request: ActivityRequest,
  grade: Mission["grade"],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string) =>
    issues.push({ code: "SCHEMA_INVALID", path, message });
  if (m.grade !== grade)
    issue("grade", `La misión debe ser para grado ${grade}.`);
  const c = request.constraints;
  if (c?.checkpoints !== undefined && m.checkpoints.length !== c.checkpoints)
    issue(
      "checkpoints",
      `Se requieren exactamente ${c.checkpoints} estaciones.`,
    );
  if (
    c?.minObstacles !== undefined &&
    m.grid.cells.filter((cell) => cell.obstacle).length < c.minObstacles
  )
    issue("grid.cells", `Se requieren al menos ${c.minObstacles} obstáculos.`);
  if (c?.maxEnergy !== undefined && m.energyBudget > c.maxEnergy)
    issue("energyBudget", `El presupuesto no debe superar ${c.maxEnergy}.`);
  for (const dimension of ["rows", "cols"] as const) {
    if (c?.[dimension] !== undefined && m.grid[dimension] !== c[dimension])
      issue(`grid.${dimension}`, `Se requieren ${c[dimension]} ${dimension}.`);
    if (request.family && m.grid[dimension] > 5)
      issue(`grid.${dimension}`, "Máximo 5 filas y 5 columnas.");
  }
  for (const terrain of ["plain", "rough"] as const) {
    const cost = c?.[terrain === "plain" ? "plainCost" : "roughCost"];
    if (cost !== undefined && m.grid.cells.some(cell => cell.terrain === terrain && cell.cost !== cost))
      issue("grid.cells.cost", `El terreno ${terrain} debe costar ${cost}.`);
  }
  if (c?.minRough !== undefined && m.grid.cells.filter(cell => !cell.obstacle && cell.terrain === "rough").length < c.minRough)
    issue("grid.cells.terrain", `Se requieren ${c.minRough} celdas difíciles transitables.`);
  if (request.family) {
    const mechanic = validateMechanic(m, request.family);
    if (!mechanic.ok) issues.push(...mechanic.issues);
  }
  return issues;
}
/** El timeout también vence si un proveedor fake ignora AbortSignal. Fetch recibe cancelación real. */
async function timedProposal(
  provider: MissionProvider,
  input: Omit<Parameters<MissionProvider["propose"]>[0], "signal">,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
  let cancel: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.propose({ ...input, signal }),
      new Promise<never>((_, reject) => {
        cancel = () => reject(new ProviderError("PROVIDER_TIMEOUT", provider.name));
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            controller.abort();
          } catch {
            /* Algunos transports cierran su stream al cancelar. */
          }
          reject(new ProviderError("PROVIDER_TIMEOUT", provider.name));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (cancel) signal.removeEventListener("abort", cancel);
  }
}
export async function generateActivity(
  input: unknown,
  provider: MissionProvider,
  options: { timeoutMs?: number; totalMs?: number; signal?: AbortSignal; teacherPreferences?: readonly string[] } = {},
): Promise<GeneratedProposal[]> {
  const request = parseActivityRequest(input);
  const promptVersion = request.family ? MECHANICS_PROMPT_VERSION : LEGACY_PROMPT_VERSION;
  const systemPrompt = request.family ? MECHANICS_SYSTEM_PROMPT : LEGACY_SYSTEM_PROMPT;
  const deadline = Date.now() + (options.totalMs ?? 90000);
  const results: GeneratedProposal[] = [];
  for (const grade of request.grades) {
    let previousIssues: ValidationIssue[] = [];
    let previousProposal: unknown;
    let mission: Mission | undefined;
    let errorCode: GenerationErrorCode | undefined;
    let calls = 0;
    const events: GenerationEvent[] = [];
    for (
      let attempt = 0;
      attempt <= GENERATION_POLICY.maxRepairRetries;
      attempt++
    ) {
      if (options.signal?.aborted) throw new ProviderError("PROVIDER_TIMEOUT", provider.name);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        errorCode = "PROVIDER_TIMEOUT";
        break;
      }
      const started = Date.now();
      calls++;
      try {
        previousProposal = await timedProposal(
          provider,
          {
            systemPrompt,
            request: {
              objective: request.objective,
              ...(request.family ? { family: request.family } : {}),
              grade,
              difficulty: request.difficulty,
              constraints: request.constraints,
              ...(options.teacherPreferences?.length ? { teacherPreferences: options.teacherPreferences } : {}),
            },
            previousIssues,
            previousProposal,
          },
          Math.min(
            options.timeoutMs ?? GENERATION_POLICY.providerTimeoutMs,
            remaining,
          ),
          options.signal,
        );
        const validation = validate_mission(previousProposal);
        previousIssues = validation.ok
          ? constraintIssues(validation.value, request, grade)
          : [...validation.issues];
        if (validation.ok && previousIssues.length === 0)
          mission = { ...validation.value, objective: request.objective };
        errorCode = previousIssues[0]?.code;
        events.push({
          provider: provider.name,
          model: provider.model,
          promptVersion,
          grade,
          call: calls,
          durationMs: Date.now() - started,
          repairCount: attempt,
          fallback: false,
          validation: mission ? "valid" : "invalid",
          ...(errorCode ? { errorCode } : {}),
        });
        if (mission) break;
      } catch (error) {
        if (options.signal?.aborted) throw new ProviderError("PROVIDER_TIMEOUT", provider.name);
        const safe =
          error instanceof ProviderError
            ? error
            : new ProviderError("PROVIDER_UNAVAILABLE", provider.name);
        errorCode = safe.code;
        if (errorCode === "PROVIDER_NOT_CONFIGURED") calls--;
        events.push({
          provider: provider.name,
          model: provider.model,
          promptVersion,
          grade,
          call: calls,
          durationMs: Date.now() - started,
          repairCount: attempt,
          fallback: false,
          validation: "provider_error",
          errorCode,
        });
        previousIssues = [
          { code: "SCHEMA_INVALID", path: "provider", message: safe.message },
        ];
        if (errorCode !== "SCHEMA_INVALID") break;
      }
    }
    const origin = mission ? "ai_generated" : "template_fallback";
    if (!mission) {
      // El respaldo conserva su objetivo real; no promete que cumple una solicitud arbitraria.
      mission = generate_map(grade);
      const checked = validate_mission(mission);
      if (!checked.ok)
        throw new Error("La plantilla de respaldo no pudo certificarse.");
    }
    const fallbackSatisfiesConstraints =
      constraintIssues(mission, request, grade).length === 0;
    const metrics = evaluate_difficulty(mission);
    results.push({
      mission,
      origin,
      provider: provider.name,
      model: provider.model,
      calls,
      repairs: Math.max(0, calls - 1),
      promptVersion,
      fallbackSatisfiesConstraints,
      metrics,
      events: events.map((e) => ({
        ...e,
        fallback: origin === "template_fallback",
      })),
      ...(errorCode ? { errorCode } : {}),
      ...(origin === "template_fallback"
        ? {
            warning: `${new ProviderError(errorCode ?? "PROVIDER_UNAVAILABLE", provider.name).message} Se ofrece una plantilla verificada; revisa su objetivo.${fallbackSatisfiesConstraints ? "" : " No cumple todas las restricciones solicitadas."}`,
          }
        : {}),
    });
  }
  return results;
}
