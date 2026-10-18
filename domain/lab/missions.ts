/**
 * Misiones de Primaria del modo abierto: el contenido (21 de las 26). Las cinco
 * del prototipo están en `mission.ts`; `MISSIONS` las junta con estas y las
 * ordena por tópico y de más fácil a más difícil (`MISSION_ORDER`).
 *
 * Cada tablero se escribe como texto, igual que los mapas de bloques:
 *   S inicio   G meta   A, B estaciones   # pared   ~ terreno difícil (cuesta 3)   . libre
 * y cada misión trae los presupuestos de energía de sus tres subniveles (2.º, 3.º
 * y 4.º): holgado con una estación, medio con las dos y ajustado con las dos. Las
 * pruebas de `missions.test.ts` comprueban que todos tengan ruta y que el último
 * deje poco margen. Este archivo solo importa tipos: `mission.ts` lo importa a él.
 */
import type { Topic } from "../explore/challenges";
import type { Cell, Mission } from "./mission";

type Spec = {
  readonly id: string;
  readonly title: string;
  readonly topic: Topic;
  readonly emoji: string;
  readonly story: string;
  readonly board: readonly string[];
  /** Energía de 2.º, 3.º y 4.º: la última es la ajustada. */
  readonly budgets: readonly [number, number, number];
  readonly hints: readonly [string, string, string];
};

const SIZE = 6;

/** Los ids de las 26 misiones en el orden en que se listan: por tópico, de más fácil a más difícil. */
export const MISSION_ORDER: readonly string[] = [
  "primaria-ciencia-hormigas",
  "primaria-ciencia-rocas",
  "primaria-ciencia-telescopio",
  "primaria-ciencia-huerto",
  "primaria-ciencia-lluvia",
  "primaria-ciencia-imanes",
  "primaria-tecnologia-camino",
  "primaria-tecnologia-charco",
  "primaria-tecnologia-menos",
  "primaria-tecnologia-paradas",
  "primaria-tecnologia-materiales",
  "primaria-tecnologia-casa",
  "primaria-ingenieria-tunel",
  "primaria-ingenieria-puente",
  "primaria-ingenieria-obra",
  "primaria-ingenieria-torre",
  "primaria-ingenieria-engranajes",
  "primaria-artes-concierto",
  "primaria-artes-arcilla",
  "primaria-artes-titeres",
  "primaria-artes-mural",
  "primaria-matematicas-balanza",
  "primaria-matematicas-dados",
  "primaria-matematicas-mercado",
  "primaria-matematicas-manzanas",
  "primaria-matematicas-biblioteca",
];

function toMission(spec: Spec): Mission {
  const { id, board } = spec;
  if (board.length !== SIZE || board.some((row) => row.length !== SIZE)) throw new Error(`Misión ${id}: el tablero debe ser de ${SIZE} × ${SIZE}.`);
  const walls: Cell[] = [];
  const rough: Cell[] = [];
  let start: Cell | null = null;
  let goal: Cell | null = null;
  const stations: (Cell | null)[] = [null, null];
  // Con bucles (no con forEach) para que TypeScript siga las asignaciones a inicio y meta.
  for (const [row, line] of board.entries()) {
    for (const [col, ch] of [...line].entries()) {
      if (ch === "#") walls.push([row, col]);
      else if (ch === "~") rough.push([row, col]);
      else if (ch === "S") start = [row, col];
      else if (ch === "G") goal = [row, col];
      else if (ch === "A") stations[0] = [row, col];
      else if (ch === "B") stations[1] = [row, col];
      else if (ch !== ".") throw new Error(`Misión ${id}: carácter no válido "${ch}".`);
    }
  }
  const [a, b] = stations;
  if (!start || !goal || !a || !b) throw new Error(`Misión ${id}: faltan el inicio, la meta o una estación.`);
  const [first, second, third] = spec.budgets;
  return {
    id,
    title: spec.title,
    topic: spec.topic,
    level: "primaria",
    story: spec.story,
    emoji: spec.emoji,
    size: SIZE,
    walls,
    rough,
    stations: [a, b],
    start,
    goal,
    // Mismos nombres y descripciones que `levelsFor` de mission.ts.
    levels: [
      { name: "2.º primaria", budget: first, need: 1, description: "Visita una estación y llega a la meta." },
      { name: "3.º primaria", budget: second, need: 2, description: "Visita A y B, evita obstáculos y controla la energía." },
      { name: "4.º primaria", budget: third, need: 2, description: "Visita A y B con presupuesto reducido." },
    ],
    hints: spec.hints,
  };
}

const SPECS: readonly Spec[] = [
  {
    id: "primaria-ciencia-hormigas",
    title: "Camino de las hormigas",
    topic: "ciencia",
    emoji: "🐜",
    story: "Robi observa a las hormigas con su lupa: visita el hormiguero (A), la zona de comida (B) y anota todo en su cuaderno, en la meta.",
    board: ["...#..", "A.~#~.", "S..#..", ".#...G", ".#~#..", "B..#.."],
    budgets: [20, 21, 16],
    hints: [
      "Cada paso gasta 1 de energía; las casillas amarillas, 3.",
      "Un muro va de arriba abajo y solo tiene una abertura, en el medio: todos los caminos pasan por ahí.",
      "Una ruta posible: sube 1, baja 4, ve a la derecha 2, sube 2, ve a la derecha 3.",
    ],
  },
  {
    id: "primaria-ciencia-rocas",
    title: "Colección de rocas",
    topic: "ciencia",
    emoji: "🪨",
    story: "Robi junta rocas para clasificarlas: una roca lisa en A y una con cristales en B. Luego las deja en la mesa de clasificación, en la meta.",
    board: ["..~G..", ".#.#.A", ".#..~.", "B..#..", ".#~#.#", "..S..."],
    budgets: [22, 23, 18],
    hints: [
      "Un paso normal gasta 1 de energía; una casilla amarilla, 3.",
      "B está en el borde izquierdo y A, arriba a la derecha. La meta queda arriba, hacia el centro.",
      "Una ruta posible: ve a la izquierda 2, sube 2, ve a la derecha 2, sube 1, ve a la derecha 2, sube 1, ve a la derecha 1, sube 1, ve a la izquierda 2.",
    ],
  },
  {
    id: "primaria-ciencia-telescopio",
    title: "Noche de telescopio",
    topic: "ciencia",
    emoji: "🔭",
    story: "Es de noche y Robi quiere ver las estrellas. Recoge el mapa del cielo en A, el telescopio en B y llega a la cabina de observación, en la meta.",
    board: ["....~S", ".##...", "A#..#.", "...~#B", "##....", "G..#~."],
    budgets: [22, 25, 20],
    hints: [
      "Antes de ejecutar, cuenta la energía de tu ruta: paso normal 1, terreno amarillo 3.",
      "B está en la misma columna de tu inicio, más abajo. A está en el borde izquierdo y la meta, abajo a la izquierda.",
      "Una ruta posible: baja 4, ve a la izquierda 3, sube 1, ve a la izquierda 2, sube 1, baja 1, ve a la derecha 2, baja 2, ve a la izquierda 2.",
    ],
  },
  {
    id: "primaria-ciencia-lluvia",
    title: "Gotas de lluvia",
    topic: "ciencia",
    emoji: "🌧️",
    story: "Llovió toda la noche. Robi recoge el agua de dos pluviómetros (A y B) y la lleva al laboratorio, en la meta. El barro amarillo gasta más energía.",
    board: ["..#..G", ".~#.~.", "B...#.", "##.~..", "...#.A", "S....."],
    budgets: [22, 27, 22],
    hints: [
      "El barro amarillo gasta 3 de energía; un paso normal, 1.",
      "A está abajo a la derecha y B, en el borde izquierdo. Decide cuál visitas primero para no devolverte tanto.",
      "Una ruta posible: sube 1, ve a la derecha 2, sube 2, ve a la izquierda 2, ve a la derecha 2, baja 1, ve a la derecha 2, baja 1, ve a la derecha 1, sube 4.",
    ],
  },
  {
    id: "primaria-ciencia-imanes",
    title: "Imanes y clips",
    topic: "ciencia",
    emoji: "🧲",
    story: "Robi prueba su imán: busca clips en A y tornillos en B y lleva todo a la mesa del experimento, en la meta.",
    board: [".A#...", ".##.#.", "..~.#.", "S#..~G", ".#.#..", "...#B."],
    budgets: [27, 28, 23],
    hints: [
      "Cada paso gasta 1 de energía y el terreno amarillo gasta 3.",
      "A está arriba, por la columna izquierda; B está abajo, cerca de la meta. Un muro te impide ir recto a la derecha.",
      "Una ruta posible: sube 3, ve a la derecha 1, ve a la izquierda 1, baja 2, ve a la derecha 2, baja 1, ve a la derecha 2, baja 2, sube 1, ve a la derecha 1, sube 1.",
    ],
  },
  {
    id: "primaria-tecnologia-charco",
    title: "Esquiva el charco",
    topic: "tecnologia",
    emoji: "💧",
    story: "Robi quiere llegar a la meta sin cruzar el charco: el agua es terreno amarillo y gasta el triple. Recoge la caja de herramientas en A y el casco en B.",
    board: ["..##.#", ".A....", "..~~~.", "S.~~~G", "..~~~.", ".#..B."],
    budgets: [21, 22, 17],
    hints: [
      "El agua del charco es terreno amarillo: gasta 3 por casilla.",
      "El charco ocupa el medio: cruzarlo gasta mucho. A está arriba y B, abajo; piensa por dónde rodearlo.",
      "Una ruta posible: sube 2, ve a la derecha 1, baja 3, ve a la derecha 1, baja 1, ve a la derecha 3, sube 2.",
    ],
  },
  {
    id: "primaria-tecnologia-menos",
    title: "Energía justa",
    topic: "tecnologia",
    emoji: "🧩",
    story: "Robi sube por un camino con paredes. Pasa por A y por B y llega a la meta sin dar pasos de más: cada uno gasta energía.",
    board: ["...#.G", ".#.~A.", ".#..#.", "B..~#.", "##.#..", "S....."],
    budgets: [24, 23, 18],
    hints: [
      "Cada paso de más gasta energía: busca el camino más corto.",
      "B queda en un rincón a la izquierda, con paredes abajo, y A está cerca de la meta. Evita los pasos de más.",
      "Una ruta posible: ve a la derecha 2, sube 2, ve a la izquierda 2, ve a la derecha 2, sube 2, ve a la derecha 2, sube 1, ve a la derecha 1.",
    ],
  },
  {
    id: "primaria-tecnologia-camino",
    title: "Camino cerrado",
    topic: "tecnologia",
    emoji: "🚧",
    story: "Un muro cierra el camino de Robi. Busca el paso, recoge el cable en A y la batería en B y llega a la meta.",
    board: ["...#..", ".A.#..", "...#.B", "S..#.G", ".~....", "..~#.."],
    budgets: [21, 20, 15],
    hints: [
      "Cada paso gasta 1 de energía y el terreno amarillo gasta 3.",
      "Un muro corta el tablero por el medio y solo se pasa por abajo. Sube a A antes de bajar.",
      "Una ruta posible: sube 2, ve a la derecha 1, baja 2, ve a la derecha 1, baja 1, ve a la derecha 2, sube 2, ve a la derecha 1, baja 1.",
    ],
  },
  {
    id: "primaria-tecnologia-paradas",
    title: "Pan para los vecinos",
    topic: "tecnologia",
    emoji: "🚩",
    story: "Robi lleva pan a dos vecinos: uno vive en A y el otro en B. Después de repartirlo, llega a la meta.",
    board: ["......", ".####.", "A..~#B", "##..#.", "...#..", "S#...G"],
    budgets: [25, 26, 21],
    hints: [
      "Cada paso gasta 1 de energía y el terreno amarillo gasta 3.",
      "A y B quedan a los lados de un muro largo. El muro se rodea por arriba.",
      "Una ruta posible: sube 1, ve a la derecha 2, sube 2, ve a la izquierda 2, sube 2, ve a la derecha 5, baja 5.",
    ],
  },
  {
    id: "primaria-tecnologia-casa",
    title: "Camino a casa",
    topic: "tecnologia",
    emoji: "🏠",
    story: "Robi termina de jugar y vuelve a casa. Antes pasa por la tienda (A) y por la panadería (B) y cuida la energía de su batería.",
    board: ["..#...", "G.#.~A", ".~..#.", "##.#..", "B..~..", "..#..S"],
    budgets: [27, 30, 25],
    hints: [
      "Cada paso gasta 1 de energía y el terreno amarillo gasta 3.",
      "Para entrar a la casa hay una sola puerta, y es terreno amarillo. Pasa por la tienda (A) y la panadería (B) antes.",
      "Una ruta posible: sube 4, baja 3, ve a la izquierda 5, ve a la derecha 2, sube 2, ve a la izquierda 1, sube 1, ve a la izquierda 1.",
    ],
  },
  {
    id: "primaria-ingenieria-tunel",
    title: "Túnel de la mina",
    topic: "ingenieria",
    emoji: "⛏️",
    story: "Robi recorre los túneles de una mina: recoge el casco en A y la linterna en B, y sale por la puerta, en la meta.",
    board: ["##...#", "...#~.", "S#.B#.", "......", "A#~##G", "......"],
    budgets: [21, 18, 13],
    hints: [
      "Cada paso gasta 1 de energía y el terreno amarillo gasta 3.",
      "Hay paredes a la derecha de tu inicio: sal por arriba o por abajo. A está abajo, en el borde izquierdo.",
      "Una ruta posible: baja 2, sube 1, ve a la derecha 2, sube 1, ve a la derecha 1, baja 1, ve a la derecha 2, baja 1.",
    ],
  },
  {
    id: "primaria-ingenieria-puente",
    title: "Puente de tablones",
    topic: "ingenieria",
    emoji: "🌉",
    story: "Robi construye un puente sobre el río: recoge los tablones en A, cruza por el puente de madera (terreno amarillo) y trae la cuerda de B hasta la meta.",
    board: ["..S...", ".A..~.", "###~##", "......", ".~B.#.", ".....G"],
    budgets: [24, 21, 16],
    hints: [
      "Cada paso gasta 1 de energía; el puente de madera es terreno amarillo y gasta 3.",
      "El río (las paredes) solo se cruza por el puente. A queda de este lado del río y B, del otro.",
      "Una ruta posible: baja 1, ve a la izquierda 1, ve a la derecha 2, baja 3, ve a la izquierda 1, baja 1, ve a la derecha 3.",
    ],
  },
  {
    id: "primaria-ingenieria-torre",
    title: "Torre de ladrillos",
    topic: "ingenieria",
    emoji: "🧱",
    story: "Para levantar la torre, Robi recoge ladrillos en A y en B y los lleva hasta la cima, en la meta.",
    board: ["G..#..", ".#.#.B", ".#~...", "A##~#.", "....#.", ".##..S"],
    budgets: [22, 25, 20],
    hints: [
      "Cada paso gasta 1 de energía y el terreno amarillo gasta 3.",
      "B queda arriba, en tu misma columna; A está en el borde izquierdo. La meta es la esquina de arriba a la izquierda.",
      "Una ruta posible: sube 4, baja 1, ve a la izquierda 2, baja 2, ve a la izquierda 3, sube 4.",
    ],
  },
  {
    id: "primaria-ingenieria-engranajes",
    title: "Engranajes en fila",
    topic: "ingenieria",
    emoji: "⚙️",
    story: "A la máquina le faltan dos engranajes: uno está en A y otro en B. Llévalos y termina en el tablero de control, en la meta.",
    board: [".~...S", "A#.##.", ".#..~.", "...#..", "#.##B.", "..G#.."],
    budgets: [26, 29, 24],
    hints: [
      "Cada paso gasta 1 de energía y el terreno amarillo gasta 3.",
      "B queda abajo a la derecha, bajando por tu columna; A está en el borde izquierdo, lejos. La meta está en un rincón cerrado, abajo.",
      "Una ruta posible: baja 4, ve a la izquierda 1, sube 2, ve a la izquierda 2, baja 1, ve a la izquierda 2, sube 2, baja 2, ve a la derecha 1, baja 2, ve a la derecha 1.",
    ],
  },
  {
    id: "primaria-artes-concierto",
    title: "Concierto en el patio",
    topic: "artes",
    emoji: "🎵",
    story: "Robi organiza un concierto en el patio: recoge los tambores en B y el micrófono en A y llega al escenario, en la meta.",
    board: ["..~...", ".##.#A", "....~.", "S#.#.G", "B..~#.", "..#..."],
    budgets: [23, 20, 15],
    hints: [
      "Cada paso gasta 1 de energía y el terreno amarillo gasta 3.",
      "B está justo debajo de tu inicio; A, arriba a la derecha, cerca de la meta.",
      "Una ruta posible: baja 1, sube 2, ve a la derecha 5, sube 1, baja 2.",
    ],
  },
  {
    id: "primaria-artes-arcilla",
    title: "Escultura de arcilla",
    topic: "artes",
    emoji: "🏺",
    story: "Robi prepara su escultura: busca la arcilla en A y los moldes en B y llega al taller de cerámica, en la meta.",
    board: ["..S...", ".#.~#A", ".#....", "B..#.#", ".~##..", "...G.."],
    budgets: [22, 23, 18],
    hints: [
      "Cada paso gasta 1 de energía y el terreno amarillo gasta 3.",
      "A está arriba a la derecha y B, en el borde izquierdo. La meta queda abajo, hacia el centro.",
      "Una ruta posible: ve a la derecha 3, baja 2, ve a la izquierda 3, baja 1, ve a la izquierda 2, baja 2, ve a la derecha 3.",
    ],
  },
  {
    id: "primaria-artes-titeres",
    title: "Teatro de títeres",
    topic: "artes",
    emoji: "🎭",
    story: "Robi prepara una función de títeres: busca los muñecos en A y el telón en B y llega al teatro, en la meta.",
    board: ["S..~..", "##.##.", "....~.", ".##.#B", "A.~...", "...#.G"],
    budgets: [24, 25, 20],
    hints: [
      "Cada paso gasta 1 de energía y el terreno amarillo gasta 3.",
      "A está abajo a la izquierda y B, a la derecha. Las paredes parten el camino en tramos: busca las aberturas.",
      "Una ruta posible: ve a la derecha 2, baja 2, ve a la izquierda 2, baja 2, ve a la derecha 5, sube 1, baja 2.",
    ],
  },
  {
    id: "primaria-matematicas-balanza",
    title: "La balanza",
    topic: "matematicas",
    emoji: "⚖️",
    story: "Robi pesa dos cajas en una balanza (A y B) y lleva el resultado a la meta. Suma la energía de tu ruta antes de ejecutar.",
    board: ["...#.G", ".#.#~.", ".#....", "..A##B", "#..~..", "S..#.."],
    budgets: [22, 19, 14],
    hints: [
      "Antes de ejecutar, suma la energía: paso normal 1, terreno amarillo 3.",
      "A y B están en la misma fila, con paredes en medio. Cuenta qué tramo conviene recorrer primero.",
      "Una ruta posible: ve a la derecha 1, sube 2, ve a la derecha 1, sube 1, ve a la derecha 3, baja 1, sube 3.",
    ],
  },
  {
    id: "primaria-matematicas-mercado",
    title: "Compras del mercado",
    topic: "matematicas",
    emoji: "🛒",
    story: "Robi compra frutas en A y verduras en B y paga en la caja, en la meta. Haz las cuentas de energía antes de ejecutar.",
    board: ["......", ".#~#.A", "S...#.", ".#.~..", "B..##G", ".....#"],
    budgets: [23, 22, 17],
    hints: [
      "Antes de ejecutar, suma la energía: paso normal 1, terreno amarillo 3.",
      "B queda abajo de tu inicio y A, arriba a la derecha. La caja (la meta) está en un rincón cerrado, a la derecha.",
      "Una ruta posible: baja 2, ve a la derecha 2, sube 1, ve a la derecha 3, sube 2, baja 3.",
    ],
  },
  {
    id: "primaria-matematicas-dados",
    title: "Tablero de dados",
    topic: "matematicas",
    emoji: "🎲",
    story: "En el tablero de dados hay dos casillas especiales, A y B. Pasa por las dos y llega a la meta sin pasarte de energía.",
    board: [".~..~.", ".#B#..", "....#.", "S#.~.G", ".#.#..", "A...~."],
    budgets: [23, 22, 17],
    hints: [
      "Antes de ejecutar, suma la energía: paso normal 1, terreno amarillo 3.",
      "A está abajo, en el borde izquierdo; B queda arriba, entre dos paredes.",
      "Una ruta posible: baja 2, sube 3, ve a la derecha 2, sube 1, baja 2, ve a la derecha 3.",
    ],
  },
  {
    id: "primaria-matematicas-manzanas",
    title: "Reparto de manzanas",
    topic: "matematicas",
    emoji: "🍎",
    story: "Robi reparte manzanas en dos casas, A y B. ¿Cuánta energía necesita para repartirlas y llegar a la meta? Suma los pasos.",
    board: ["S..#..", ".#.#~.", ".....A", "#.#~#.", "B.....", "..#..G"],
    budgets: [22, 23, 18],
    hints: [
      "Antes de ejecutar, suma la energía: paso normal 1, terreno amarillo 3.",
      "B está abajo a la izquierda y A, en el borde derecho, a media altura. Suma los pasos de cada tramo.",
      "Una ruta posible: baja 2, ve a la derecha 1, baja 2, ve a la izquierda 1, ve a la derecha 1, sube 2, ve a la derecha 4, baja 3.",
    ],
  },
];

export const MORE_MISSIONS: readonly Mission[] = SPECS.map(toMission);
