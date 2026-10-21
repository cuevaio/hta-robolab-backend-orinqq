import type { Mission, ValidationIssue } from "../domain/mission/contracts";

import type { MissionFamily } from "../domain/mission/mechanics";

export type ProviderName = "groq" | "anthropic" | "gemini" | "ollama";
export type GenerationRequest = {
  readonly objective: string;
  readonly family?: MissionFamily;
  readonly grade: Mission["grade"];
  readonly difficulty?: "guided" | "balanced" | "challenge";
  readonly constraints?: {
    readonly rows?: number;
    readonly cols?: number;
    readonly plainCost?: number;
    readonly roughCost?: number;
    readonly minRough?: number;
    readonly checkpoints?: number;
    readonly minObstacles?: number;
    readonly maxEnergy?: number;
  };
  /** Nota que el docente guardó sobre sus clases. Es un dato suyo, no una instrucción. */
  readonly teacherPreferences?: readonly string[];
};
export type GenerationErrorCode =
  | "SCHEMA_INVALID"
  | "UNSOLVABLE"
  | "SEARCH_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "PROVIDER_NOT_CONFIGURED"
  | "PERSISTENCE_FAILED";
/** Solo metadatos; nunca prompts completos, credenciales ni nombres de alumnos. */
export type GenerationEvent = {
  readonly provider: ProviderName;
  readonly model: string;
  readonly promptVersion: string;
  readonly durationMs: number;
  readonly repairCount: number;
  readonly fallback: boolean;
  readonly errorCode?: GenerationErrorCode;
  readonly grade?: Mission["grade"];
  readonly call?: number;
  readonly validation?: "valid" | "invalid" | "provider_error";
};
export interface GenerationObserver {
  record(event: GenerationEvent): void;
}
/** Adaptadores futuros exclusivamente del servidor. La respuesta siempre es no confiable. */
export interface MissionProvider {
  readonly name: ProviderName;
  readonly model: string;
  propose(input: {
    readonly systemPrompt: string;
    readonly request: GenerationRequest;
    readonly previousIssues: readonly ValidationIssue[];
    readonly previousProposal?: unknown;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
}
/** El adaptador Convex futuro debe autorizar al docente y volver a validar al guardar. */
export interface MissionRepository<T = string> {
  save(mission: Mission): Promise<T>;
}
export const GENERATION_POLICY = {
  maxRepairRetries: 2,
  providerTimeoutMs: 15000,
  searchStateLimit: 20000,
} as const;
