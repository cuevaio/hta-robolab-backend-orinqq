/**
 * Misiones de Primaria (modelo del laboratorio multigrado): un tablero de 6×6
 * con paredes, terreno difícil (+3 de energía), estaciones obligatorias, inicio
 * y meta. Cada misión trae tres subniveles (2.º, 3.º y 4.º) con distinto
 * presupuesto de energía y estaciones requeridas. El alumno programa con
 * flechas absolutas (↑ ↓ ← →).
 *
 * Aquí viven los tipos que comparten el modo abierto, los retos de clase y el
 * creador del docente; el motor (búsqueda, ejecución, pistas, robot) está en
 * `solve.ts`, `execute.ts` y `robot.ts`. Las misiones del docente se guardan
 * como JSON, así que `parseMission` las revisa cada vez que se leen.
 */
import { TOPICS, type Topic } from "../explore/challenges";
import { MISSION_ORDER, MORE_MISSIONS } from "./missions";

export type Dir = "U" | "D" | "L" | "R";
export type Cell = readonly [row: number, col: number]; // 0..5
export type MissionLevel = { readonly name: string; readonly budget: number; readonly need: number; readonly description: string };
export type Mission = {
  readonly id: string; // único, p. ej. "primaria-ciencia-reparto"
  readonly title: string;
  readonly topic: Topic; // de domain/explore/challenges
  readonly level: "primaria";
  readonly story: string; // consigna para el niño
  readonly emoji: string;
  readonly size: 6;
  readonly walls: readonly Cell[];
  readonly rough: readonly Cell[]; // terreno difícil, cuesta 3
  readonly stations: readonly Cell[]; // A, B, …
  readonly start: Cell;
  readonly goal: Cell;
  readonly levels: readonly [MissionLevel, MissionLevel, MissionLevel];
  readonly hints: readonly [string, string, string];
};

export const BOARD_SIZE = 6;
export const STEP_COST = 1;
export const ROUGH_COST = 3;
export const LEVEL_COUNT = 3;
/** A lo sumo cuatro estaciones: la máscara de visitadas usa un bit por estación. */
export const MAX_STATIONS = 4;
/** Como el prototipo: a lo sumo 80 flechas por programa. */
export const MAX_ARROWS = 80;

export const LIMITS = {
  idMax: 80,
  titleMax: 80,
  storyMax: 300,
  hintMax: 200,
  levelNameMax: 40,
  descriptionMax: 160,
  budgetMax: 999,
} as const;

export const DIRS: readonly Dir[] = ["U", "D", "L", "R"];
export const DELTA: Record<Dir, Cell> = { U: [-1, 0], D: [1, 0], L: [0, -1], R: [0, 1] };
export const ARROW: Record<Dir, string> = { U: "↑", D: "↓", L: "←", R: "→" };
export const DIR_LABEL: Record<Dir, string> = { U: "Arriba", D: "Abajo", L: "Izquierda", R: "Derecha" };

export const cellKey = ([row, col]: Cell): string => `${row},${col}`;
export const sameCell = (a: Cell, b: Cell): boolean => a[0] === b[0] && a[1] === b[1];
export const inBoard = (size: number, [row, col]: Cell): boolean => row >= 0 && col >= 0 && row < size && col < size;
export const cellSet = (cells: readonly Cell[]): ReadonlySet<string> => new Set(cells.map(cellKey));
export const moved = (cell: Cell, dir: Dir): Cell => [cell[0] + DELTA[dir][0], cell[1] + DELTA[dir][1]];
export const stationIndex = (mission: Pick<Mission, "stations">, cell: Cell): number =>
  mission.stations.findIndex((s) => sameCell(s, cell));
/** Letra con la que se dibuja cada estación: A, B, … */
export const stationLetter = (index: number): string => String.fromCharCode(65 + index);

export class LabDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabDataError";
  }
}

const fail = (message: string): never => {
  throw new LabDataError(message);
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isTopic = (value: unknown): value is Topic => TOPICS.some((t) => t.id === value);

function parseCell(value: unknown, what: string): Cell {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[0]) || !Number.isInteger(value[1])) {
    return fail(`${what}: la casilla debe ser [fila, columna].`);
  }
  const cell: Cell = [value[0] as number, value[1] as number];
  if (!inBoard(BOARD_SIZE, cell)) fail(`${what}: la casilla (${cell[0]}, ${cell[1]}) está fuera del tablero.`);
  return cell;
}

function parseCells(value: unknown, what: string): Cell[] {
  if (!Array.isArray(value)) return fail(`${what}: debe ser una lista de casillas.`);
  const cells = value.map((c) => parseCell(c, what));
  if (cellSet(cells).size !== cells.length) fail(`${what}: hay casillas repetidas.`);
  return cells;
}

function parseText(value: unknown, what: string, max: number, min = 0): string {
  if (typeof value !== "string") return fail(`${what}: falta el texto.`);
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < min) fail(`${what}: escribe al menos ${min} caracteres.`);
  if (text.length > max) fail(`${what}: máximo ${max} caracteres.`);
  return text;
}

function parseLevel(value: unknown, index: number, stations: number): MissionLevel {
  const what = `Nivel ${index + 1}`;
  if (!isRecord(value)) return fail(`${what}: falta.`);
  const name = parseText(value.name, `${what}, nombre`, LIMITS.levelNameMax, 1);
  const description = parseText(value.description, `${what}, descripción`, LIMITS.descriptionMax);
  const { budget, need } = value;
  if (!Number.isInteger(budget) || (budget as number) < 1 || (budget as number) > LIMITS.budgetMax) {
    fail(`${what}: el presupuesto de energía debe ser un entero entre 1 y ${LIMITS.budgetMax}.`);
  }
  if (!Number.isInteger(need) || (need as number) < 0 || (need as number) > stations) {
    fail(`${what}: las estaciones requeridas deben ser un entero entre 0 y ${stations}.`);
  }
  return { name, budget: budget as number, need: need as number, description };
}

/**
 * Revisa datos sin tipo (lo guardado en la base o lo que devuelva un modelo)
 * y los convierte en una `Mission`. Solo mira la forma: que tenga solución
 * lo decide `validate`, con la búsqueda.
 */
export function parseMission(input: unknown): Mission {
  if (!isRecord(input)) return fail("La misión no tiene el formato esperado.");
  const id = parseText(input.id, "Identificador", LIMITS.idMax, 1);
  if (!/^[a-z0-9-]+$/.test(id)) fail("Identificador: solo minúsculas, dígitos y guiones.");
  const title = parseText(input.title, "Título", LIMITS.titleMax, 1);
  const topic = input.topic;
  if (!isTopic(topic)) return fail("Tópico desconocido.");
  if (input.level !== "primaria") fail("Las misiones son de Primaria.");
  const story = parseText(input.story, "Consigna", LIMITS.storyMax);
  const emoji = parseText(input.emoji, "Emoji", 8, 1);
  if (input.size !== BOARD_SIZE) fail(`El tablero debe ser de ${BOARD_SIZE} × ${BOARD_SIZE}.`);

  const start = parseCell(input.start, "Inicio");
  const goal = parseCell(input.goal, "Meta");
  if (sameCell(start, goal)) fail("El inicio y la meta no pueden ser la misma casilla.");
  const walls = parseCells(input.walls, "Paredes");
  const rough = parseCells(input.rough, "Terreno difícil");
  const stations = parseCells(input.stations, "Estaciones");
  if (stations.length < 1 || stations.length > MAX_STATIONS) fail(`Debe haber entre 1 y ${MAX_STATIONS} estaciones.`);

  const wallSet = cellSet(walls);
  const special = [start, goal, ...stations];
  if (special.some((c) => wallSet.has(cellKey(c)))) fail("Una pared tapa el inicio, la meta o una estación.");
  if (rough.some((c) => wallSet.has(cellKey(c)))) fail("Una casilla no puede ser pared y terreno difícil a la vez.");
  if (cellSet(special).size !== special.length) fail("Las estaciones no pueden estar en el inicio ni en la meta.");

  if (!Array.isArray(input.levels) || input.levels.length !== LEVEL_COUNT) fail(`La misión debe tener ${LEVEL_COUNT} niveles.`);
  const levels = (input.levels as unknown[]).map((l, i) => parseLevel(l, i, stations.length)) as [MissionLevel, MissionLevel, MissionLevel];
  if (!Array.isArray(input.hints) || input.hints.length !== 3) fail("La misión debe tener 3 pistas.");
  const hints = (input.hints as unknown[]).map((h, i) => parseText(h, `Pista ${i + 1}`, LIMITS.hintMax, 1)) as [string, string, string];

  return { id, title, topic, level: "primaria", story, emoji, size: BOARD_SIZE, walls, rough, stations, start, goal, levels, hints };
}

// ---------- Contenido: misiones del modo abierto ----------
// Aquí están las cinco del prototipo; las demás viven en `missions.ts`. En las
// del prototipo los tableros se repiten entre tópicos a propósito: lo que cambia
// es la historia. Todas se validan con `validate()` en las pruebas.

/** Tablero del prototipo (RoboLab_Aula_Multigrado_MVP.html). */
const BOARD_RUTA = {
  walls: [[1, 1], [1, 2], [2, 2], [3, 2], [4, 4], [3, 4]],
  rough: [[0, 2], [1, 4], [2, 4], [4, 2], [5, 3]],
  stations: [[0, 5], [5, 0]],
  budgets: [30, 33, 27],
} as const;

/** Muro vertical arriba y pasillo por la izquierda. */
const BOARD_HUERTO = {
  walls: [[0, 3], [1, 3], [2, 3], [3, 1], [4, 1], [2, 5]],
  rough: [[1, 1], [3, 3], [4, 2], [5, 2], [0, 4]],
  stations: [[3, 0], [1, 5]],
  budgets: [26, 27, 22],
} as const;

/** Muro horizontal al medio y meta cerrada por abajo. */
const BOARD_OBRA = {
  walls: [[2, 1], [2, 2], [2, 3], [4, 3], [4, 4], [1, 5]],
  rough: [[0, 1], [3, 0], [3, 4], [5, 1], [4, 0]],
  stations: [[0, 4], [5, 2]],
  budgets: [24, 25, 20],
} as const;

export type Board = typeof BOARD_RUTA | typeof BOARD_HUERTO | typeof BOARD_OBRA;
/** Tableros disponibles para el creador del docente (variantes). */
export const BOARDS: readonly Board[] = [BOARD_RUTA, BOARD_HUERTO, BOARD_OBRA];

const LEVEL_NAMES = ["2.º primaria", "3.º primaria", "4.º primaria"] as const;

/** Los tres subniveles de siempre: una estación, las dos, las dos con menos energía. */
export const levelsFor = (budgets: readonly [number, number, number], stationA = "A", stationB = "B"): Mission["levels"] => [
  { name: LEVEL_NAMES[0], budget: budgets[0], need: 1, description: "Visita una estación y llega a la meta." },
  { name: LEVEL_NAMES[1], budget: budgets[1], need: 2, description: `Visita ${stationA} y ${stationB}, evita obstáculos y controla la energía.` },
  { name: LEVEL_NAMES[2], budget: budgets[2], need: 2, description: `Visita ${stationA} y ${stationB} con presupuesto reducido.` },
];

const mission = (
  board: Board,
  data: Pick<Mission, "id" | "title" | "topic" | "story" | "emoji" | "hints"> & { readonly swap?: boolean },
): Mission => {
  const [a, b] = board.stations;
  return {
    ...data,
    level: "primaria",
    size: BOARD_SIZE,
    walls: board.walls,
    rough: board.rough,
    stations: data.swap ? [b, a] : [a, b],
    start: [0, 0],
    goal: [5, 5],
    levels: levelsFor(board.budgets),
  };
};

const CORE_MISSIONS: readonly Mission[] = [
  mission(BOARD_RUTA, {
    id: "primaria-tecnologia-materiales",
    title: "Ruta de materiales",
    topic: "tecnologia",
    emoji: "📦",
    story: "Robi reparte materiales en la escuela. Pasa por las estaciones y llega a la meta sin gastar toda la energía.",
    hints: [
      "Cada paso gasta 1 de energía y el terreno amarillo gasta 3.",
      "Las estaciones están en dos esquinas: planifica en qué orden las visitas.",
      "Baja por la columna izquierda hasta B, cruza por abajo y sube a A antes de volver a la meta.",
    ],
  }),
  mission(BOARD_HUERTO, {
    id: "primaria-ciencia-huerto",
    title: "Muestras del huerto",
    topic: "ciencia",
    emoji: "🌱",
    story: "Robi recoge una muestra de tierra en A y una de agua en B para el experimento y las lleva al laboratorio, en la meta.",
    hints: [
      "Hay un muro arriba: no intentes cruzar por la fila de inicio.",
      "La estación A está en el borde izquierdo; la B, en el borde derecho.",
      "Baja por la izquierda hasta A, cruza por la fila 3 hasta B y baja por la derecha a la meta.",
    ],
  }),
  mission(BOARD_OBRA, {
    id: "primaria-ingenieria-obra",
    title: "Piezas para la obra",
    topic: "ingenieria",
    emoji: "🏗️",
    story: "Robi lleva piezas a dos puntos de la obra. Evita las zonas en construcción y el barro, que cuesta el triple.",
    hints: [
      "El muro del medio solo se cruza por los extremos.",
      "Recoge A arriba a la derecha antes de bajar.",
      "Ve por la fila de arriba hasta A, baja por la derecha, cruza por la fila 3 hasta B y vuelve a la meta por abajo.",
    ],
  }),
  mission(BOARD_HUERTO, {
    id: "primaria-artes-mural",
    title: "Colores para el mural",
    topic: "artes",
    emoji: "🎨",
    swap: true,
    story: "Robi recoge pintura en A y pinceles en B antes de llegar al mural de la escuela, en la meta.",
    hints: [
      "Mira dónde está cada estación antes de poner la primera flecha.",
      "El terreno amarillo gasta 3: rodéalo cuando puedas.",
      "Baja por la izquierda, cruza por la fila 3 y sube por la derecha a la otra estación antes de ir a la meta.",
    ],
  }),
  mission(BOARD_OBRA, {
    id: "primaria-matematicas-biblioteca",
    title: "Ruta de la biblioteca",
    topic: "matematicas",
    emoji: "📚",
    swap: true,
    story: "Robi devuelve libros en dos estantes (las estaciones). Suma la energía de cada paso para no pasarte del presupuesto.",
    hints: [
      "Antes de ejecutar, cuenta cuánta energía gastará tu ruta.",
      "Un paso normal cuesta 1; una casilla amarilla, 3.",
      "La ruta más barata pasa por las dos estaciones sin pisar casi ningún terreno amarillo.",
    ],
  }),
];

/**
 * Todas las misiones del modo abierto: las del prototipo y las de `missions.ts`,
 * por tópico y de más fácil a más difícil (así se listan y así avanza "Siguiente").
 */
export const MISSIONS: readonly Mission[] = [...CORE_MISSIONS, ...MORE_MISSIONS].sort(
  (a, b) => MISSION_ORDER.indexOf(a.id) - MISSION_ORDER.indexOf(b.id),
);

export const missionById = (id: string): Mission | undefined => MISSIONS.find((m) => m.id === id);

export const missionsFor = (topic: Topic): Mission[] => MISSIONS.filter((m) => m.topic === topic);
