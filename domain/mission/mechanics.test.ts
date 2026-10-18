import { expect, it } from "vitest";
import { executeMission, solveMission } from "./engine";
import { validateMechanic } from "./mechanics";
import { realEnergyMission, realEnergyAlternative } from "./realEnergyFixture";

it("certifica el caso real A1 sin perder la alternativa simple sobre presupuesto", () => {
  const m = realEnergyMission;
  const solved = solveMission(m);
  expect(solved).toMatchObject({ status: "SOLVED", cost: 11 });
  expect(executeMission(m, realEnergyAlternative).outcome).toBe("ENERGY_EXCEEDED");
  expect(executeMission({ ...m, energyBudget: 10000 }, realEnergyAlternative)).toMatchObject({ outcome: "SUCCESS", energyUsed: 19 });
  const certified = validateMechanic(m, "ENERGY_OPTIMIZATION");
  expect(certified).toMatchObject({ ok: true });
  if (!certified.ok) throw new Error(JSON.stringify(certified.issues));
  expect(certified.evidence.minimumEnergy).toBe(11);
  const alternative = certified.evidence.alternative!;
  expect(alternative.cost).toBeGreaterThan(18);
  expect(executeMission(m, alternative.program).outcome).toBe("ENERGY_EXCEEDED");
  const replay = executeMission({ ...m, energyBudget: 10000 }, alternative.program);
  expect(replay).toMatchObject({ outcome: "SUCCESS", energyUsed: alternative.cost });
  expect([...replay.visitedCheckpoints].sort()).toEqual(["c1", "c2"]);
  const positions = [m.start, ...replay.steps.filter(s => s.cost > 0).map(s => s.state.position)];
  expect(new Set(positions.map(p => `${p.row},${p.col}`)).size).toBe(positions.length);
});
