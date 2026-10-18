/**
 * Revisa un intento de un reto del modo abierto. Usa el mismo simulador que
 * las evaluaciones; el navegador lo usa para responder al instante y el
 * servidor para verificar lo que se registra.
 */
import { policyFor } from "../game/levels";
import { type Cell, cellKey } from "../game/map";
import { type Command, type Program, compile, countBlocks, usesOnly } from "../game/program";
import { type Simulation, simulate } from "../game/simulator";
import type { Challenge } from "./challenges";

const COMMAND_NAME: Record<Command, string> = {
  FORWARD: "avanzar",
  BACKWARD: "retroceder",
  TURN_LEFT: "girar a la izquierda",
  TURN_RIGHT: "girar a la derecha",
};

export type CheckResult =
  | { readonly ok: true; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: "EMPTY" | "OFF_PATH" | "INCOMPLETE" | "MISSED_STOPS" | "TOO_MANY_BLOCKS" | "WRONG_CELL" | "BLOCKS";
      readonly message: string;
      /** Paso (1, 2, 3…) donde se equivocó, para resaltarlo. */
      readonly step?: number;
    };

const visitedCells = (simulation: Simulation) =>
  new Set([cellKey(simulation.initial.cell), ...simulation.steps.map((s) => cellKey(s.state.cell))]);

/** Dónde termina el robot con un programa (para los retos de predecir). */
export function finalCell(challenge: Challenge, program: Program): Cell {
  const simulation = simulate(challenge.map, compile(program));
  return simulation.steps.at(-1)?.state.cell ?? simulation.initial.cell;
}

/** Revisa el programa del alumno en un reto de armar, corregir, paradas o eficiencia. */
export function checkProgram(challenge: Challenge, program: Program): { simulation: Simulation; result: CheckResult } {
  const policy = policyFor(challenge.level);
  const simulation = simulate(challenge.map, compile(program));
  if (!usesOnly(program, policy.palette)) {
    return { simulation, result: { ok: false, reason: "BLOCKS", message: "Usaste un bloque que no está disponible en este nivel." } };
  }

  const { outcome } = simulation;
  if (outcome.kind === "EMPTY") {
    return { simulation, result: { ok: false, reason: "EMPTY", message: "Tu programa está vacío. Toca los bloques para darle órdenes a Robi." } };
  }
  if (outcome.kind === "OFF_PATH") {
    return {
      simulation,
      result: {
        ok: false,
        reason: "OFF_PATH",
        step: outcome.failedStep,
        message: `¡Uy! Robi se salió del camino en el paso ${outcome.failedStep}, al ${COMMAND_NAME[outcome.command]}.`,
      },
    };
  }
  if (outcome.kind === "INCOMPLETE") {
    return { simulation, result: { ok: false, reason: "INCOMPLETE", message: "¡Casi! Robi se quedó antes de la estrella. Agrega más bloques." } };
  }

  if (challenge.kind === "stops") {
    const visited = visitedCells(simulation);
    const missing = challenge.map.stops.filter((stop) => !visited.has(cellKey(stop))).length;
    if (missing > 0) {
      return {
        simulation,
        result: {
          ok: false,
          reason: "MISSED_STOPS",
          message: `Robi llegó a la estrella, pero le faltó pasar por ${missing === 1 ? "una bandera" : `${missing} banderas`}.`,
        },
      };
    }
  }
  if (challenge.kind === "efficient") {
    const used = countBlocks(program);
    if (used > challenge.maxBlocks) {
      return {
        simulation,
        result: {
          ok: false,
          reason: "TOO_MANY_BLOCKS",
          message: `¡Llegaste! Pero usaste ${used} bloques. Intenta con ${challenge.maxBlocks} o menos: busca lo que se repite.`,
        },
      };
    }
  }
  return { simulation, result: { ok: true, message: "¡Lo lograste! Robi llegó a la estrella." } };
}

/** Revisa la casilla que tocó el alumno en un reto de predecir. */
export function checkPrediction(challenge: Challenge, picked: Cell): CheckResult {
  if (challenge.kind !== "predict") throw new Error(`El reto ${challenge.id} no es de predecir.`);
  const answer = finalCell(challenge, challenge.given);
  return answer.row === picked.row && answer.col === picked.col
    ? { ok: true, message: "¡Adivinaste! Robi terminó justo ahí." }
    : { ok: false, reason: "WRONG_CELL", message: "Robi terminó en otra casilla. Sigue los bloques con tu dedo y vuelve a intentarlo." };
}
