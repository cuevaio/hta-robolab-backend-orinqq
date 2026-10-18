/**
 * Verificación de una partida de una misión del asistente. El servidor vuelve a
 * ejecutar el programa en el tablero guardado: lo que diga el navegador no cuenta.
 */
import { ConvexError } from "convex/values";
import { compile, parseProgram, ProgramError } from "../../domain/game/program";
import { executeMission } from "../../domain/mission/engine";
import { ContractError } from "../../domain/mission/validation";
import type { Doc } from "../_generated/dataModel";
import { type PlayInput, factsOf, MISSION_HINTS_MAX } from "./plays";

/** Un programa mal formado, o con órdenes que la misión no permite, cuenta como no resuelto. */
export function verifyAgentPlay(mission: Doc<"agentMissions">, challengeId: string, input: PlayInput) {
  let solved = false;
  try {
    const commands = compile(parseProgram(input.program));
    solved = executeMission(mission.mission, { schemaVersion: 1, commands }).outcome === "SUCCESS";
  } catch (error) {
    if (!(error instanceof ProgramError) && !(error instanceof ContractError)) throw error;
  }
  if (!mission) throw new ConvexError("Ese reto no existe.");
  return { challengeId, play: factsOf(input, solved, MISSION_HINTS_MAX) };
}
