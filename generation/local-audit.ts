import { createHash } from "node:crypto";
import type { GenerationErrorCode, ProviderName } from "./contracts";

export type LocalGenerationEvent = {
  phase: "started" | "completed" | "cancelled" | "failed";
  generationId: string; at: string; provider: ProviderName; model: string;
  durationMs?: number; calls?: number; repairs?: number;
  missions?: { grade: number; sha256: string }[];
  failed?: { grade: number; code: GenerationErrorCode }[];
};
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)]));
  return value;
}
/** Huella del JSON canónico; no escribe objetivos, prompts ni contenido en los registros. */
export function missionFingerprint(mission: unknown): string {
  return createHash("sha256").update(JSON.stringify(ordered(mission))).digest("hex");
}
