import { describe, it, expect, vi } from "vitest";
import { MECHANICS, validateMechanic } from "../domain/mission/mechanics";
import type { MissionFamily } from "../domain/mission/mechanics";
import { mechanicFixture } from "../domain/mission/mechanicsFixtures";
import { missionFixtures } from "../domain/mission/fixtures";
import { executeMission } from "../domain/mission/engine";
import { generateActivity } from "./orchestrator";
import { buildPedagogy, generatePedagogicalActivity, savePedagogicalMission } from "./pedagogy";
import { parseActivityRequest } from "./request";
import { realEnergyMission } from "../domain/mission/realEnergyFixture";
const request = { objective: "Comparar sumas de costos y planificar recorridos.", grades: [3], family: "ROUTE_COMPARISON" };

describe("mecánicas pedagógicas verificables", () => {
  it("acepta A1 en el orquestador y certifica su sidecar sin reparación ni fallback", async () => {
    const propose = vi.fn().mockResolvedValue(realEnergyMission);
    const [entry] = await generatePedagogicalActivity({
      objective: realEnergyMission.objective, grades: [3], family: "ENERGY_OPTIMIZATION", difficulty: "balanced",
      constraints: { rows: 4, cols: 5, checkpoints: 2, minObstacles: 1, minRough: 1, plainCost: 1, roughCost: 3, maxEnergy: 18 },
    }, { name: "groq", model: "fake", propose });
    expect(propose).toHaveBeenCalledTimes(1);
    expect(entry!.proposal).toMatchObject({ origin: "ai_generated", calls: 1, repairs: 0, fallbackSatisfiesConstraints: true });
    expect(entry!.pedagogy).toMatchObject({ verification: "verified", evidence: { minimumEnergy: 11, budget: 18 } });
  });
  it.each(Object.keys(MECHANICS) as MissionFamily[])("certifica %s con testigos reproducibles", family => {
    const m = mechanicFixture(family);
    const v = validateMechanic(m, family);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error(JSON.stringify(v.issues));
    expect(executeMission(m, v.evidence.solution).outcome).toBe("SUCCESS");
    expect(v.evidence.alternative!.cost).toBeGreaterThan(m.energyBudget);
    expect(executeMission(m, v.evidence.alternative!.program).outcome).toBe("ENERGY_EXCEEDED");
    expect(executeMission({ ...m, energyBudget: 10000 }, v.evidence.alternative!.program).energyUsed).toBe(v.evidence.alternative!.cost);
    if (family === "CHECKPOINT_DELIVERY") {
      expect(v.evidence.checkpointBypass!.cost).toBeLessThan(v.evidence.minimumEnergy);
      expect(executeMission(m, v.evidence.checkpointBypass!.program).outcome).toBe("MISSING_CHECKPOINTS");
    }
  });
  it("rechaza estaciones decorativas, energía irrelevante y terreno sin decisión", () => {
    const m = mechanicFixture("ROUTE_COMPARISON");
    expect(validateMechanic({ ...m, energyBudget: 10000 }, "ENERGY_OPTIMIZATION").ok).toBe(false);
    expect(validateMechanic({ ...m, grid: { ...m.grid, cells: m.grid.cells.map(c => ({ ...c, cost: 1 })) } }, "ROUTE_COMPARISON").ok).toBe(false);
    expect(validateMechanic(m, "CHECKPOINT_DELIVERY").ok).toBe(false);
    expect(validateMechanic(missionFixtures[1], "CHECKPOINT_DELIVERY").ok).toBe(false);
    expect(validateMechanic({ ...m, energyBudget: 1 }, "ENERGY_OPTIMIZATION").ok).toBe(false);
  });
  it.each(["RECHARGE", "SYMMETRY", "PATTERNS", "toString", "UNKNOWN"])("rechaza %s antes de llamar al proveedor", async family => {
    const propose = vi.fn();
    await expect(generateActivity({ ...request, family }, { name: "groq", model: "fake", propose })).rejects.toThrow();
    expect(propose).not.toHaveBeenCalled();
  });
  it("valida dimensiones, costos y cantidades de terreno en la solicitud", () => {
    for (const constraints of [{ rows: 6 }, { cols: 0 }, { plainCost: 0 }, { roughCost: 101 }, { minRough: 26 }])
      expect(() => parseActivityRequest({ ...request, constraints })).toThrow();
  });
  it("repara una misión resoluble cuya mecánica no coincide", async () => {
    const invalid = { ...missionFixtures[1]!, grade: 3 };
    const propose = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValue(mechanicFixture("ROUTE_COMPARISON"));
    const [p] = await generateActivity(request, { name: "groq", model: "fake", propose });
    expect(p).toMatchObject({ origin: "ai_generated", calls: 2, repairs: 1 });
    expect(propose.mock.calls[1]![0].previousIssues[0].path).toBe("mechanic");
    expect(propose.mock.calls[0]![0].request.family).toBe("ROUTE_COMPARISON");
  });
  it.each([
    { rows: 4 }, { cols: 5 }, { plainCost: 2 }, { roughCost: 3 },
    { minRough: 3 }, { minObstacles: 1 }, { maxEnergy: 4 }, { checkpoints: 1 },
  ])("rechaza propuestas que incumplen %j", async constraints => {
    const propose = vi.fn().mockResolvedValue(mechanicFixture("ROUTE_COMPARISON"));
    const [p] = await generateActivity({ ...request, constraints }, { name: "groq", model: "fake", propose });
    expect(p!.origin).toBe("template_fallback");
    expect(propose).toHaveBeenCalledTimes(3);
    expect(propose.mock.calls[0]![0].request.constraints).toMatchObject(constraints);
    expect(propose.mock.calls[1]![0].previousIssues.length).toBeGreaterThan(0);
  });
  it("limita reparaciones y degrada explícitamente el respaldo", async () => {
    const propose = vi.fn().mockResolvedValue(missionFixtures[1]);
    const [entry] = await generatePedagogicalActivity(request, { name: "groq", model: "fake", propose });
    expect(propose).toHaveBeenCalledTimes(3);
    expect(entry!.proposal).toMatchObject({ origin: "template_fallback", fallbackSatisfiesConstraints: false });
    expect(entry!.pedagogy.verification).toBe("degraded_fallback");
    expect(entry!.pedagogy.evidence).toBeUndefined();
  });
  it("revalida antes de persistir y separa metadatos del contrato", async () => {
    const save = vi.fn().mockResolvedValue("saved");
    const m = mechanicFixture("ROUTE_COMPARISON");
    await expect(savePedagogicalMission(m, request, { save })).resolves.toBe("saved");
    const [mission, pedagogy] = save.mock.calls[0]!;
    expect(mission).not.toHaveProperty("family");
    expect(JSON.parse(JSON.stringify(pedagogy))).toEqual(buildPedagogy(m, request));
    save.mockClear();
    await expect(savePedagogicalMission({ ...m, energyBudget: 10000 }, request, { save })).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});
