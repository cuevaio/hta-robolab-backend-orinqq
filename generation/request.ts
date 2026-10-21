import type { Mission } from "../domain/mission/contracts";
import { ContractError, MISSION_LIMITS } from "../domain/mission/validation";
import { isMissionFamily } from "../domain/mission/mechanics";
import { hasPersonalIdentifiers } from "../domain/teacher/preferences";
import type { GenerationRequest } from "./contracts";
export type ActivityRequest = Omit<GenerationRequest, "grade"> & {
  readonly grades: readonly Mission["grade"][];
  readonly difficulty: "guided" | "balanced" | "challenge";
};
function invalid(path: string, message: string): never {
  throw new ContractError([{ code: "SCHEMA_INVALID", path, message }]);
}
export function parseActivityRequest(input: unknown): ActivityRequest {
  if (!input || typeof input !== "object")
    invalid("request", "Escribe un objetivo y selecciona grados.");
  const r = input as Record<string, unknown>;
  if (
    typeof r.objective !== "string" ||
    r.objective.trim().length < 10 ||
    r.objective.length > 800
  )
    invalid("objective", "El objetivo debe tener entre 10 y 800 caracteres.");
  const objective = r.objective.trim();
  // No se adjuntan datos del aula. Bloqueo básico de identificadores evidentes, no un detector completo de PII.
  if (hasPersonalIdentifiers(objective))
    invalid(
      "objective",
      "Describe solo el aprendizaje, sin correos, teléfonos ni documentos personales.",
    );
  if (
    !Array.isArray(r.grades) ||
    !r.grades.length ||
    r.grades.length > 3 ||
    r.grades.some((g) => ![2, 3, 4].includes(g)) ||
    new Set(r.grades).size !== r.grades.length
  )
    invalid(
      "grades",
      "Selecciona de uno a tres grados distintos entre segundo y cuarto.",
    );
  const difficulty = r.difficulty ?? "balanced";
  if (
    difficulty !== "guided" &&
    difficulty !== "balanced" &&
    difficulty !== "challenge"
  )
    invalid("difficulty", "Selecciona una dificultad válida.");
  if (r.family !== undefined && !isMissionFamily(r.family))
    invalid("family", "Familia no soportada. Recarga, simetría y patrones aún no están habilitados.");
  const constraints: { -readonly [K in keyof NonNullable<GenerationRequest["constraints"]>]: number } = {};
  if (r.constraints !== undefined) {
    if (
      !r.constraints ||
      typeof r.constraints !== "object" ||
      Array.isArray(r.constraints)
    )
      invalid("constraints", "Las restricciones no son válidas.");
    const values = r.constraints as Record<string, unknown>;
    for (const [key, min, max] of [
      ["rows", 1, 5],
      ["cols", 1, 5],
      ["plainCost", 1, 100],
      ["roughCost", 1, 100],
      ["minRough", 0, 25],
      ["checkpoints", 0, MISSION_LIMITS.checkpoints],
      ["minObstacles", 0, 10],
      ["maxEnergy", 1, MISSION_LIMITS.energy],
    ] as const) {
      const value = values[key];
      if (value === undefined) continue;
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < min ||
        value > max
      )
        invalid(
          `constraints.${key}`,
          `La restricción debe ser un entero entre ${min} y ${max}.`,
        );
      constraints[key] = value;
    }
  }
  return {
    objective,
    grades: [...r.grades].sort() as Mission["grade"][],
    difficulty,
    constraints,
    ...(isMissionFamily(r.family) ? { family: r.family } : {}),
  };
}
