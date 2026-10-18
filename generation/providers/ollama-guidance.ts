import { COMMANDS } from "../../domain/game/program";
import { parseCustomMission } from "../../domain/mission/custom";
import { MISSION_LIMITS } from "../../domain/mission/validation";
import { solveMission } from "../../domain/mission/engine";
import type { GenerationRequest } from "../contracts";

/** Datos del simulador para que el modelo repare; nunca se modifica ni aprueba la propuesta. */
export function localRepairHint(previous: unknown, request: GenerationRequest) {
  try {
    const mission = parseCustomMission(previous);
    const solved = solveMission({ ...mission, allowedCommands: [...COMMANDS], energyBudget: MISSION_LIMITS.energy });
    if (solved.status !== "SOLVED") return undefined;
    const maxEnergy = request.constraints?.maxEnergy ?? MISSION_LIMITS.energy;
    return {
      minimumEnergy: solved.cost,
      maxEnergy,
      mustChangeMap: solved.cost > maxEnergy,
      allowedCommands: [...COMMANDS],
      instruction: solved.cost > maxEnergy
        ? "Reduce costos o cambia el recorrido: no puedes superar maxEnergy."
        : "Con la paleta completa hay una ruta. El presupuesto debe alcanzar minimumEnergy; usa un margen acorde a la dificultad, sin superar maxEnergy.",
    };
  } catch { return undefined; }
}
