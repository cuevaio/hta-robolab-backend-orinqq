/**
 * Verificación común de una partida de reto: la usan el modo abierto
 * (`explore.recordPlay`) y los alumnos con sesión (`student.recordChallengePlay`).
 * El navegador dice qué jugó; si lo logró lo decide el servidor.
 */
import { ConvexError, v } from "convex/values";
import { challengeById } from "../../domain/explore/challenges";
import { checkPrediction, checkProgram } from "../../domain/explore/check";
import { ProgramError, parseProgram } from "../../domain/game/program";
import type { PlayFacts } from "../../domain/impact/summary";
import { execute, parseArrows } from "../../domain/lab/execute";
import { LabDataError, missionById } from "../../domain/lab/mission";

/** Partidas por jugador (dispositivo o alumno) y minuto: una persona jugando de verdad no llega. */
export const MAX_PLAYS_PER_MINUTE = 30;
export const PLAY_WINDOW_MS = 60_000;
export const TOO_MANY_PLAYS = "Enviaste muchas partidas seguidas. Espera un momento.";

/** Lo que manda la web de un reto de bloques (los argumentos de siempre de `explore.recordPlay`). */
export const blockPlayArgs = {
  challengeId: v.string(),
  program: v.optional(v.any()),
  /** Casilla elegida en los retos de predecir. */
  pick: v.optional(v.object({ row: v.number(), col: v.number() })),
  runs: v.number(),
  hints: v.number(),
  ms: v.number(),
};

/** Además, para las misiones de Primaria: flechas U/D/L/R y subnivel (0 = 2.º, 1 = 3.º, 2 = 4.º). */
export const playArgs = {
  ...blockPlayArgs,
  arrows: v.optional(v.array(v.string())),
  level: v.optional(v.number()),
};

export type PlayInput = {
  challengeId: string;
  program?: unknown;
  pick?: { row: number; col: number };
  arrows?: readonly string[];
  level?: number;
  runs: number;
  hints: number;
  ms: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** En una misión las pistas dependen del error de cada ejecución, así que no hay un tope de tres: solo uno que acote el dato. */
export const MISSION_HINTS_MAX = 100;
const clamp = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

type Verified = { challengeId: string; play: PlayFacts };

const NOT_FOUND = "Ese reto no existe.";

export function factsOf(input: PlayInput, solved: boolean, hintsMax: number): PlayFacts {
  return { solved, runs: clamp(input.runs, 1000), hints: clamp(input.hints, hintsMax), ms: clamp(input.ms, DAY_MS) };
}

/** Un reto de bloques; null si el id no es de uno. Un programa mal formado cuenta como no resuelto. */
function verifyBlocks(input: PlayInput): Verified | null {
  const challenge = challengeById(input.challengeId);
  if (!challenge) return null;
  let solved = false;
  if (challenge.kind === "predict") {
    solved = input.pick !== undefined && checkPrediction(challenge, input.pick).ok;
  } else {
    try {
      solved = checkProgram(challenge, parseProgram(input.program)).result.ok;
    } catch (error) {
      if (!(error instanceof ProgramError)) throw error;
    }
  }
  return { challengeId: challenge.id, play: factsOf(input, solved, challenge.hints.length) };
}

/** Solo retos de bloques: lo que acepta el modo abierto (`explore.recordPlay`). Las misiones se anotan con `lab.recordPlay`. */
export function verifyBlockPlay(input: PlayInput): Verified {
  const verified = verifyBlocks(input);
  if (!verified) throw new ConvexError(NOT_FOUND);
  return verified;
}

/** Retos de bloques y misiones de Primaria: lo que acepta un alumno con sesión (`student.recordChallengePlay`). */
export function verifyPlay(input: PlayInput): Verified {
  const blocks = verifyBlocks(input);
  if (blocks) return blocks;

  // Misión de Primaria: el servidor vuelve a ejecutar las flechas en el subnivel que jugó el alumno.
  const mission = missionById(input.challengeId);
  if (!mission) throw new ConvexError(NOT_FOUND);
  const level = input.level ?? 0;
  if (!Number.isInteger(level) || level < 0 || level >= mission.levels.length) throw new ConvexError("Ese nivel no existe.");
  let solved = false;
  try {
    solved = execute(mission, level, parseArrows(input.arrows ?? [])).ok;
  } catch (error) {
    // Como con los bloques, un programa mal formado cuenta como no resuelto.
    if (!(error instanceof LabDataError)) throw error;
  }
  return { challengeId: mission.id, play: factsOf(input, solved, MISSION_HINTS_MAX) };
}
