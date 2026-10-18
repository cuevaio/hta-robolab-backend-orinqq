import { expect, it } from "vitest";
import type { Mission } from "./contracts";
import { COMMANDS } from "../game/program";
import { findSimpleAlternative } from "./alternative";
import { executeMission } from "./engine";

const square: Mission = {
  schemaVersion: 1, id: "alternative-square", revision: 1, title: "Dos rutas", objective: "Comparar rutas con energía.", grade: 3,
  initialHeading: 90, start: { row: 0, col: 0 }, goal: { row: 0, col: 1 }, energyBudget: 2,
  checkpoints: [], allowedCommands: COMMANDS,
  grid: { rows: 2, cols: 2, cells: [1, 1, 2, 2].map((cost, i) => ({
    position: { row: Math.floor(i / 2), col: i % 2 }, terrain: i > 1 ? "rough" : "plain", obstacle: false, cost,
  })) },
};

it.each(Array.from({ length: 15 }, (_, i) => i + 1))("respeta la paleta %i y las cuatro orientaciones", mask => {
  const allowedCommands = COMMANDS.filter((_, i) => mask & (1 << i));
  for (const initialHeading of [0, 90, 180, 270] as const) {
    const m = { ...square, allowedCommands, initialHeading };
    const result = findSimpleAlternative(m);
    const canTurn = allowedCommands.includes("TURN_LEFT") || allowedCommands.includes("TURN_RIGHT");
    const canMove = allowedCommands.includes("FORWARD") || allowedCommands.includes("BACKWARD");
    expect(result.status).toBe(canTurn && canMove ? "FOUND" : "ABSENT");
    if (result.status === "FOUND") {
      expect(result.cost).toBe(5);
      expect(result.program.commands.every(c => allowedCommands.includes(c))).toBe(true);
      expect(result.program.commands.length).toBeLessThanOrEqual(128);
      expect(executeMission(m, result.program).outcome).toBe("ENERGY_EXCEEDED");
      expect(executeMission({ ...m, energyBudget: 10000 }, result.program)).toMatchObject({ outcome: "SUCCESS", energyUsed: 5 });
    }
  }
});

it("distingue límite agotado de búsqueda completa sin testigo", () => {
  expect(findSimpleAlternative(square, { maxStates: 1 })).toEqual({ status: "SEARCH_LIMIT", exploredStates: 1 });
  expect(findSimpleAlternative(square, { maxMoves: 1 }).status).toBe("ABSENT");
  expect(findSimpleAlternative(square, { maxCommands: 2 }).status).toBe("ABSENT");
  expect(findSimpleAlternative({ ...square, energyBudget: 10000 }).status).toBe("ABSENT");
});

it("conserva orientaciones de llegada que ahorran comandos posteriores", () => {
  const m: Mission = { ...square, allowedCommands: ["FORWARD", "BACKWARD", "TURN_RIGHT"] };
  const result = findSimpleAlternative(m, { maxCommands: 6 });
  expect(result.status).toBe("FOUND");
  if (result.status === "FOUND") {
    expect(result.program.commands).toHaveLength(6);
    expect(result.program.commands).toContain("BACKWARD");
  }
  expect(findSimpleAlternative(m, { maxCommands: 5 }).status).toBe("ABSENT");
});

it("no usa obstáculos, checkpoints omitidos ni retornos a posiciones visitadas", () => {
  const blocked = { ...square, grid: { ...square.grid, cells: square.grid.cells.map((c, i) => i === 3 ? { ...c, obstacle: true } : c) } };
  expect(findSimpleAlternative(blocked).status).toBe("ABSENT");
  const checkpoint = { ...square, checkpoints: [{ id: "entrega", position: { row: 1, col: 0 } }] };
  const result = findSimpleAlternative(checkpoint);
  expect(result.status).toBe("FOUND");
  if (result.status === "FOUND") {
    const trace = executeMission({ ...checkpoint, energyBudget: 10000 }, result.program);
    expect(trace.visitedCheckpoints).toEqual(["entrega"]);
    const visited = [checkpoint.start, ...trace.steps.filter(s => s.cost > 0).map(s => s.state.position)];
    expect(new Set(visited.map(p => `${p.row},${p.col}`)).size).toBe(visited.length);
  }
  // La estación es ahora un callejón: visitarla exige volver a inicio.
  expect(findSimpleAlternative({ ...blocked, checkpoints: checkpoint.checkpoints }).status).toBe("ABSENT");
});

it("es determinista, no muta la misión y rechaza cotas fuera del contrato", () => {
  const before = JSON.stringify(square);
  expect(findSimpleAlternative(square)).toEqual(findSimpleAlternative(square));
  expect(JSON.stringify(square)).toBe(before);
  for (const options of [{ maxStates: 0 }, { maxStates: 20001 }, { maxMoves: 25 }, { maxCommands: 129 }])
    expect(() => findSimpleAlternative(square, options)).toThrow(RangeError);
});
