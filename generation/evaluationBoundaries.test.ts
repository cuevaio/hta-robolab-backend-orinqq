import { describe, expect, it, vi } from "vitest";
import { evaluationScenarios, preflightEvaluation } from "./evaluationScenarios";
import { parseActivityRequest } from "./request";
import { generateActivity } from "./orchestrator";
import { mechanicFixture } from "../domain/mission/mechanicsFixtures";
import { executeMission, solveMission } from "../domain/mission/engine";
import { validateMechanic } from "../domain/mission/mechanics";
import { validate_mission } from "./tools";

const base = evaluationScenarios[0];
describe("fronteras de la evaluación sin llamadas HTTP", () => {
  it.each(evaluationScenarios)("prevalida el caso $id sin alterar restricciones", scenario => {
    const result = preflightEvaluation(scenario);
    expect(result.issues).toEqual([]);
    expect(result.request.constraints).toEqual(scenario.constraints);
  });
  it.each([
    { constraints: { rows: 6 } }, { constraints: { cols: 6 } },
    { grades: [1] }, { grades: [5] }, { family: "RECHARGE" },
    { constraints: { checkpoints: 7 } }, { constraints: { plainCost: 0 } },
    { constraints: { roughCost: 101 } }, { constraints: { maxEnergy: 0 } },
    { constraints: { maxEnergy: 10001 } }, { difficulty: "unknown" }, { objective: "corto" },
  ])("rechaza entrada malformada antes del proveedor: %j", async patch => {
    const propose = vi.fn();
    await expect(generateActivity({ ...base, ...patch }, { name: "groq", model: "fake", propose })).rejects.toThrow();
    expect(propose).not.toHaveBeenCalled();
  });
  it("descarta parámetros desconocidos sin inventar reglas", () => {
    const result = parseActivityRequest({ ...base, recharge: true, constraints: { ...base.constraints, exactEnergy: 18 } });
    expect(result).not.toHaveProperty("recharge");
    expect(result.constraints).not.toHaveProperty("exactEnergy");
    expect(result.constraints?.maxEnergy).toBe(18);
  });
  it("identifica capacidad imposible en preflight, aunque el parser productivo la acepta", () => {
    const input = { ...base, constraints: { rows: 1, cols: 2, checkpoints: 2 } };
    expect(() => parseActivityRequest(input)).not.toThrow();
    expect(preflightEvaluation(input).issues).not.toEqual([]);
  });
  it("identifica terreno y energía imposibles antes de la evaluación", () => {
    expect(preflightEvaluation({ ...base, constraints: { rows: 2, cols: 2, minObstacles: 1, minRough: 4 } }).issues).not.toEqual([]);
    expect(preflightEvaluation({ ...base, constraints: { checkpoints: 2, plainCost: 3, roughCost: 5, maxEnergy: 8 } }).issues).not.toEqual([]);
  });
  it("distingue límite de búsqueda de ausencia de solución y rechaza un mapa aislado", () => {
    const m = mechanicFixture("ROUTE_COMPARISON");
    expect(solveMission(m, 1).status).toBe("SEARCH_LIMIT");
    const blocked = { ...m, grid: { ...m.grid, cells: m.grid.cells.map(c => ({ ...c, obstacle: c.position.row === 1 || (c.position.row === 0 && c.position.col === 1) })) } };
    expect(solveMission(blocked).status).toBe("UNSOLVABLE");
    expect(validate_mission(blocked).ok).toBe(false);
  });
  it("rechaza energía decorativa y omisión de checkpoints al ejecutar", () => {
    const m = mechanicFixture("ROUTE_COMPARISON");
    expect(validateMechanic({ ...m, energyBudget: 10000 }, "ENERGY_OPTIMIZATION").ok).toBe(false);
    const delivery = mechanicFixture("CHECKPOINT_DELIVERY");
    const bypass = solveMission({ ...delivery, checkpoints: [] });
    expect(bypass.status).toBe("SOLVED");
    if (bypass.status === "SOLVED") expect(executeMission(delivery, bypass.program).outcome).toBe("MISSING_CHECKPOINTS");
  });
});
