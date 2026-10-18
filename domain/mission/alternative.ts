import type { Heading } from "../game/map";
import type { Command, Program } from "./contracts";
import { parseCustomMission } from "./custom";
import { executeMission } from "./engine";
import { MISSION_LIMITS } from "./validation";

/** Cota determinista global, no una cota nueva por cada rama o celda bloqueada. */
export const ALTERNATIVE_SEARCH_LIMIT = 20000;
export type AlternativeResult =
  | { status: "FOUND"; program: Program; cost: number; exploredStates: number }
  | { status: "ABSENT" | "SEARCH_LIMIT"; exploredStates: number };

/** DFS de rutas simples sobre (posición, orientación, visitadas, checkpoints, comandos).
 * No domina por energía: una etiqueta cara puede ser precisamente el testigo buscado.
 * Giros en sitio se comprimen a la secuencia mínima para CADA orientación de llegada.
 * Conservar ambas llegadas (avanzar/retroceder) evita perder continuaciones con paletas
 * restringidas. No es el enumerador de auditoría: no almacena caminos completos,
 * se detiene al primer testigo y aplica podas admisibles de energía y movimientos.
 */
export function findSimpleAlternative(
  input: unknown,
  options: { maxStates?: number; maxMoves?: number; maxCommands?: number } = {},
): AlternativeResult {
  const m = parseCustomMission(input);
  const maxStates = options.maxStates ?? ALTERNATIVE_SEARCH_LIMIT;
  const maxMoves = options.maxMoves ?? m.grid.rows * m.grid.cols - 1;
  const maxCommands = options.maxCommands ?? MISSION_LIMITS.commands;
  for (const [value, min, max] of [
    [maxStates, 1, ALTERNATIVE_SEARCH_LIMIT], [maxMoves, 0, 24],
    [maxCommands, 1, MISSION_LIMITS.commands],
  ] as const) if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError("Límites inválidos para la búsqueda de alternativas.");

  const index = (row: number, col: number) => row * m.grid.cols + col;
  const cells = [...m.grid.cells].sort((a, b) => index(a.position.row, a.position.col) - index(b.position.row, b.position.col));
  const start = index(m.start.row, m.start.col), goal = index(m.goal.row, m.goal.col);
  const checkpointBits = new Map(m.checkpoints.map((c, i) => [index(c.position.row, c.position.col), 1 << i]));
  const allCheckpoints = (1 << m.checkpoints.length) - 1;
  type Move = { dr: number; dc: number; heading: Heading; commands: Command[] };
  const moves = new Map<Heading, Move[]>();
  const deltas = [[-1, 0], [0, 1], [1, 0], [0, -1]] as const;
  for (const initial of [0, 90, 180, 270] as const) {
    const rotations = new Map<Heading, Command[]>([[initial, []]]);
    const queue: Heading[] = [initial];
    for (let i = 0; i < queue.length; i++) {
      const heading = queue[i]!;
      for (const turn of ["TURN_LEFT", "TURN_RIGHT"] as const) {
        if (!m.allowedCommands.includes(turn)) continue;
        const next = ((heading + (turn === "TURN_LEFT" ? 270 : 90)) % 360) as Heading;
        if (rotations.has(next)) continue;
        rotations.set(next, [...rotations.get(heading)!, turn]);
        queue.push(next);
      }
    }
    const choices: Move[] = [];
    for (const [heading, turns] of rotations) for (const command of ["FORWARD", "BACKWARD"] as const) {
      if (!m.allowedCommands.includes(command)) continue;
      const [dr, dc] = deltas[heading / 90]!;
      const sign = command === "FORWARD" ? 1 : -1;
      choices.push({ dr: sign * dr, dc: sign * dc, heading, commands: [...turns, command] });
    }
    moves.set(initial, choices);
  }
  const relaxed = { ...m, energyBudget: MISSION_LIMITS.energy };
  const commands: Command[] = [];
  let exploredStates = 0;
  let limited = false;
  let found: Extract<AlternativeResult, { status: "FOUND" }> | undefined;
  // Mismo conjunto visitado implica misma energía, checkpoints y movimientos.
  // Para esa posición/orientación solo una llegada con MÁS comandos es dominada.
  // No se comparan rutas con visitadas distintas ni se domina por menor energía.
  const labels = new Map<string, number>();

  function visit(at: number, heading: Heading, visited: number, checkpoints: number, energy: number, steps: number): void {
    if (found || limited) return;
    const key = `${at}:${heading}:${visited}`;
    const previous = labels.get(key);
    if (previous !== undefined && previous <= commands.length) return;
    if (exploredStates >= maxStates) { limited = true; return; }
    exploredStates++;
    labels.set(key, commands.length);
    if (at === goal) {
      if (checkpoints !== allCheckpoints || energy <= m.energyBudget) return;
      const program: Program = { schemaVersion: 1, commands: [...commands] };
      const replay = executeMission(relaxed, program);
      const original = executeMission(m, program);
      if (replay.outcome === "SUCCESS" && replay.energyUsed === energy && original.outcome === "ENERGY_EXCEEDED")
        found = { status: "FOUND", program, cost: energy, exploredStates };
      return;
    }
    const remainingMoves = maxMoves - steps;
    if (remainingMoves <= 0 || commands.length >= maxCommands) return;
    const row = Math.floor(at / m.grid.cols), col = at % m.grid.cols;
    const distance = Math.abs(row - m.goal.row) + Math.abs(col - m.goal.col);
    const missing = m.checkpoints.filter((_, i) => !(checkpoints & (1 << i))).length;
    if (missing + 1 > remainingMoves) return;
    if (distance > remainingMoves) return;
    // Cota superior: ni siquiera entrar en las celdas más caras restantes alcanza
    // a superar el presupuesto. No utiliza costos mínimos para descartar rutas caras.
    const available = cells.filter((c, i) => !c.obstacle && !(visited & (1 << i))).map(c => c.cost).sort((a, b) => b - a);
    if (energy + available.slice(0, remainingMoves).reduce((a, b) => a + b, 0) <= m.energyBudget) return;
    for (const move of moves.get(heading)!) {
      const r = row + move.dr, c = col + move.dc;
      if (r < 0 || c < 0 || r >= m.grid.rows || c >= m.grid.cols) continue;
      const next = index(r, c);
      if (cells[next]!.obstacle || (visited & (1 << next)) || commands.length + move.commands.length > maxCommands) continue;
      const length = commands.length;
      commands.push(...move.commands);
      visit(next, move.heading, visited | (1 << next), checkpoints | (checkpointBits.get(next) ?? 0), energy + cells[next]!.cost, steps + 1);
      commands.length = length;
      if (found || limited) return;
    }
  }
  visit(start, m.initialHeading, 1 << start, 0, 0, 0);
  return found ?? { status: limited ? "SEARCH_LIMIT" : "ABSENT", exploredStates };
}
