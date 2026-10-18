/**
 * Retos de bloques del modo abierto ("Explorar retos"): cualquiera los juega
 * sin cuenta. Son los retos de Inicial (3-5 años) de los cinco tópicos; en
 * Primaria el juego es el del laboratorio (misiones en `domain/lab`). Al final
 * quedan seis retos de bloques de Primaria que ya no se listan (ver "Legado").
 *
 * Cada reto es un mapa más una consigna. Hay cinco tipos, todos de
 * pensamiento computacional:
 *   sequence   armar la secuencia para llegar a la estrella
 *   predict    leer un programa y adivinar dónde termina el robot
 *   fix        corregir un programa que tiene un error
 *   stops      pasar por todas las paradas antes de la estrella
 *   efficient  llegar con pocos bloques (en Inicial, sin pasos de más)
 *
 * La mecánica es la misma en todos los tópicos; cambia la ambientación: el
 * jardín (Tecnología), el laboratorio (Ciencia), el taller (Ingeniería), la
 * galería (Artes) y los números (Matemáticas).
 */
import type { EducationLevel } from "../game/levels";
import { type GameMap, parseMap } from "../game/map";
import { type Program, move, repeat } from "../game/program";

export type Topic = "ciencia" | "tecnologia" | "ingenieria" | "artes" | "matematicas";

export type TopicInfo = {
  readonly id: Topic;
  readonly name: string;
  readonly tagline: string;
  readonly emoji: string;
  /** Dónde pasan sus retos: ambienta el tablero. */
  readonly place: string;
  /** Un tópico sin retos se muestra como "Próximamente". */
  readonly available: boolean;
};

export const TOPICS: readonly TopicInfo[] = [
  { id: "ciencia", name: "Ciencia", tagline: "Explora el laboratorio", emoji: "🔬", place: "Laboratorio", available: true },
  { id: "tecnologia", name: "Tecnología", tagline: "Programa al robot", emoji: "🤖", place: "Jardín", available: true },
  { id: "ingenieria", name: "Ingeniería", tagline: "Construye en el taller", emoji: "⚙️", place: "Taller", available: true },
  { id: "artes", name: "Artes", tagline: "Recorre la galería", emoji: "🎨", place: "Galería", available: true },
  { id: "matematicas", name: "Matemáticas", tagline: "Cuenta los pasos", emoji: "➗", place: "Números", available: true },
];

export const topicInfo = (id: string): TopicInfo | undefined => TOPICS.find((t) => t.id === id);

type Common = {
  readonly id: string;
  readonly topic: Topic;
  readonly level: EducationLevel;
  readonly difficulty: 1 | 2 | 3 | 4;
  readonly title: string;
  readonly emoji: string;
  /** Lo que se practica, para la ficha del reto. */
  readonly skill: string;
  readonly minutes: string;
  readonly story: string;
  readonly map: GameMap;
  /** De lo más general a lo más concreto: la tercera casi da la respuesta. */
  readonly hints: readonly [string, string, string];
};

export type Challenge =
  | (Common & { readonly kind: "sequence" })
  | (Common & { readonly kind: "predict"; readonly given: Program })
  | (Common & { readonly kind: "fix"; readonly given: Program })
  | (Common & { readonly kind: "stops" })
  | (Common & { readonly kind: "efficient"; readonly maxBlocks: number });

export const KIND_LABEL: Record<Challenge["kind"], string> = {
  sequence: "Secuencia",
  predict: "Predicción",
  fix: "Corregir",
  stops: "Paradas",
  efficient: "Eficiencia",
};

const F = move("FORWARD");
const B = move("BACKWARD");
const L = move("TURN_LEFT");
const R = move("TURN_RIGHT");

const STRAIGHT_HINTS = (steps: number): [string, string, string] => [
  "Robi ya mira hacia la estrella.",
  "Cuenta las casillas que hay hasta la estrella.",
  `Usa ${steps} bloques de Avanzar.`,
];

const FIX_HINT_1 = "Ejecuta el programa y mira en qué paso se sale Robi.";

export const CHALLENGES: readonly Challenge[] = [
  // ---------- Tecnología · el jardín ----------
  {
    id: "inicial-paseo",
    kind: "sequence",
    topic: "tecnologia",
    level: "inicial",
    difficulty: 1,
    title: "Primer paseo",
    emoji: "🚶",
    skill: "Secuencias",
    minutes: "2-3 min",
    story: "Robi quiere llegar a la estrella. ¡Está en línea recta!",
    map: parseMap("inicial-paseo", ["S..G"], 90),
    hints: STRAIGHT_HINTS(3),
  },
  {
    id: "inicial-gira",
    kind: "sequence",
    topic: "tecnologia",
    level: "inicial",
    difficulty: 1,
    title: "Gira a la estrella",
    emoji: "↪️",
    skill: "Secuencias y giros",
    minutes: "3-5 min",
    story: "El camino baja por la derecha. Ayuda a Robi a girar en el momento justo.",
    map: parseMap("inicial-gira", ["S.#", "#.#", "#.G"], 90),
    hints: [
      "Primero avanza una casilla.",
      "Para bajar, Robi gira a la derecha.",
      "Avanza, gira a la derecha, avanza 2, gira a la izquierda y avanza.",
    ],
  },
  {
    id: "inicial-charquito",
    kind: "sequence",
    topic: "tecnologia",
    level: "inicial",
    difficulty: 2,
    title: "El charquito",
    emoji: "💧",
    skill: "Esquivar obstáculos",
    minutes: "3-5 min",
    story: "Hay un charco entre Robi y la estrella. ¡No quiere mojarse!",
    map: parseMap("inicial-charquito", ["...", "SWG"], 90),
    hints: [
      "No pises el charco: rodéalo por arriba.",
      "Gira a la izquierda para subir.",
      "Sube, avanza 2 a la derecha y baja a la estrella.",
    ],
  },
  {
    id: "inicial-donde",
    kind: "predict",
    topic: "tecnologia",
    level: "inicial",
    difficulty: 2,
    title: "¿Dónde llegará?",
    emoji: "🔮",
    skill: "Leer programas",
    minutes: "2-3 min",
    story: "Mira el programa de Robi y toca la casilla donde va a terminar.",
    map: parseMap("inicial-donde", ["...", "...", "S.."], 0, { goalOptional: true }),
    given: [F, F, R, F],
    hints: [
      "Sigue los bloques uno por uno con tu dedo.",
      "Al empezar, Robi mira hacia arriba.",
      "Sube 2 casillas y luego avanza 1 a la derecha.",
    ],
  },
  {
    id: "inicial-arregla",
    kind: "fix",
    topic: "tecnologia",
    level: "inicial",
    difficulty: 2,
    title: "Arregla el paseo",
    emoji: "🛠️",
    skill: "Encontrar errores",
    minutes: "2-3 min",
    story: "Este programa tiene un error y Robi se sale del camino. ¡Arréglalo!",
    map: parseMap("inicial-arregla", ["S...G"], 90),
    given: [F, F, R, F, F],
    hints: [
      "Ejecuta el programa y mira dónde se sale Robi.",
      "Hay un giro que no debería estar.",
      "Toca el bloque de girar para quitarlo.",
    ],
  },
  {
    id: "inicial-tecnologia-parada",
    kind: "stops",
    topic: "tecnologia",
    level: "inicial",
    difficulty: 2,
    title: "Una parada",
    emoji: "🚩",
    skill: "Metas intermedias",
    minutes: "3-5 min",
    story: "Robi lleva una carta a un vecino. Pasa por la bandera y después llega a la estrella.",
    map: parseMap("inicial-tecnologia-parada", ["S.P", "##.", "##G"], 90),
    hints: [
      "Primero la bandera, después la estrella.",
      "La bandera está al final de la fila; luego hay que bajar.",
      "Avanza 2, gira a la derecha y avanza 2.",
    ],
  },

  // ---------- Ciencia · el laboratorio ----------
  {
    id: "inicial-ciencia-probeta",
    kind: "sequence",
    topic: "ciencia",
    level: "inicial",
    difficulty: 1,
    title: "La probeta",
    emoji: "🧪",
    skill: "Secuencias",
    minutes: "2-3 min",
    story: "Robi lleva una probeta a la mesa del laboratorio. ¡Está en línea recta!",
    map: parseMap("inicial-ciencia-probeta", ["S.G"], 90),
    hints: STRAIGHT_HINTS(2),
  },
  {
    id: "inicial-ciencia-lupa",
    kind: "sequence",
    topic: "ciencia",
    level: "inicial",
    difficulty: 1,
    title: "La lupa",
    emoji: "🔍",
    skill: "Giros",
    minutes: "2-3 min",
    story: "Hay una hormiga al final del pasillo y Robi quiere verla con la lupa. ¡Baja a buscarla!",
    map: parseMap("inicial-ciencia-lupa", ["S#", ".#", "G#"], 90),
    hints: [
      "La estrella está abajo.",
      "Robi mira a la derecha: gira a la derecha para mirar hacia abajo.",
      "Gira a la derecha y avanza 2.",
    ],
  },
  {
    id: "inicial-ciencia-derrame",
    kind: "sequence",
    topic: "ciencia",
    level: "inicial",
    difficulty: 2,
    title: "Agua derramada",
    emoji: "💧",
    skill: "Esquivar obstáculos",
    minutes: "3-5 min",
    story: "¡Se derramó el agua del experimento! Robi debe llegar a la mesa sin pisar el charco.",
    map: parseMap("inicial-ciencia-derrame", ["SW.G", "...."], 90),
    hints: [
      "No pises el charco: pasa por abajo.",
      "Gira a la derecha para bajar y luego a la izquierda para seguir.",
      "Baja 1, gira a la izquierda, avanza 3, gira a la izquierda y sube 1.",
    ],
  },
  {
    id: "inicial-ciencia-muestras",
    kind: "stops",
    topic: "ciencia",
    level: "inicial",
    difficulty: 2,
    title: "Dos muestras",
    emoji: "🌱",
    skill: "Metas intermedias",
    minutes: "3-5 min",
    story: "Robi recoge dos muestras de plantas (las banderas) antes de volver a la mesa.",
    map: parseMap("inicial-ciencia-muestras", ["S.P", "#..", "G.P"], 90),
    hints: [
      "Pasa por las dos banderas antes de la estrella.",
      "Ve hasta el final de la fila, baja y vuelve por abajo.",
      "Avanza 2, gira a la derecha, avanza 2, gira a la derecha y avanza 2.",
    ],
  },
  {
    id: "inicial-ciencia-donde",
    kind: "predict",
    topic: "ciencia",
    level: "inicial",
    difficulty: 2,
    title: "¿Dónde termina?",
    emoji: "🔮",
    skill: "Leer programas",
    minutes: "2-3 min",
    story: "Mira el programa de Robi y toca la casilla donde va a dejar la muestra.",
    map: parseMap("inicial-ciencia-donde", ["...", "...", "..S"], 270, { goalOptional: true }),
    given: [F, F, R, F],
    hints: [
      "Sigue los bloques uno por uno con tu dedo.",
      "Al empezar, Robi mira hacia la izquierda.",
      "Avanza 2 hacia la izquierda y sube 1.",
    ],
  },
  {
    id: "inicial-ciencia-arregla",
    kind: "fix",
    topic: "ciencia",
    level: "inicial",
    difficulty: 3,
    title: "Arregla el experimento",
    emoji: "🧲",
    skill: "Encontrar errores",
    minutes: "3-5 min",
    story: "Este programa debía llevar a Robi hasta el imán, pero tiene un error. ¡Arréglalo!",
    map: parseMap("inicial-ciencia-arregla", ["S..", "#.#", "#G#"], 90),
    given: [F, F, R, F, F],
    hints: [FIX_HINT_1, "Robi avanza una casilla de más antes de girar.", "Quita uno de los dos primeros bloques de Avanzar."],
  },

  // ---------- Ingeniería · el taller ----------
  {
    id: "inicial-ingenieria-tornillo",
    kind: "sequence",
    topic: "ingenieria",
    level: "inicial",
    difficulty: 1,
    title: "El tornillo",
    emoji: "🔩",
    skill: "Secuencias",
    minutes: "2-3 min",
    story: "A la máquina le falta un tornillo. Robi lo lleva por el pasillo del taller, en línea recta.",
    map: parseMap("inicial-ingenieria-tornillo", ["S...G"], 90),
    hints: STRAIGHT_HINTS(4),
  },
  {
    id: "inicial-ingenieria-martillo",
    kind: "sequence",
    topic: "ingenieria",
    level: "inicial",
    difficulty: 1,
    title: "El martillo",
    emoji: "🔨",
    skill: "Giros",
    minutes: "2-3 min",
    story: "El martillo quedó en el estante de arriba. Robi sube a buscarlo.",
    map: parseMap("inicial-ingenieria-martillo", ["G#", ".#", "S#"], 90),
    hints: [
      "La estrella está arriba.",
      "Robi mira a la derecha: gira a la izquierda para mirar hacia arriba.",
      "Gira a la izquierda y avanza 2.",
    ],
  },
  {
    id: "inicial-ingenieria-engranajes",
    kind: "stops",
    topic: "ingenieria",
    level: "inicial",
    difficulty: 2,
    title: "Dos engranajes",
    emoji: "⚙️",
    skill: "Metas intermedias",
    minutes: "3-5 min",
    story: "Para armar la máquina, Robi recoge dos engranajes (las banderas) y los lleva a la estrella.",
    map: parseMap("inicial-ingenieria-engranajes", ["S.P#", "#..#", "#.PG"], 90),
    hints: [
      "Pasa por las dos banderas antes de la estrella.",
      "La primera bandera está al final de la fila de arriba.",
      "Avanza 2, gira a la derecha, avanza 2, gira a la izquierda y avanza 1.",
    ],
  },
  {
    id: "inicial-ingenieria-aceite",
    kind: "sequence",
    topic: "ingenieria",
    level: "inicial",
    difficulty: 2,
    title: "Aceite en el piso",
    emoji: "🛢️",
    skill: "Esquivar obstáculos",
    minutes: "3-5 min",
    story: "Hay aceite derramado en el taller (el charco). Rodéalo para llegar a la caja de herramientas.",
    map: parseMap("inicial-ingenieria-aceite", ["S..", ".W.", "..G"], 90),
    hints: [
      "El charco está en el medio: rodéalo por arriba.",
      "Avanza 2 y gira a la derecha para bajar.",
      "Avanza 2, gira a la derecha y avanza 2.",
    ],
  },
  {
    id: "inicial-ingenieria-arregla",
    kind: "fix",
    topic: "ingenieria",
    level: "inicial",
    difficulty: 3,
    title: "Arregla el plano",
    emoji: "📐",
    skill: "Encontrar errores",
    minutes: "3-5 min",
    story: "El plano para cruzar el puente tiene un error y Robi se sale del camino. Corrígelo.",
    map: parseMap("inicial-ingenieria-arregla", ["S#", "..", "#G"], 90),
    given: [R, F, F, L, F],
    hints: [
      FIX_HINT_1,
      "Robi baja una casilla de más: después de bajar 1, el camino sigue a la derecha.",
      "Deja: gira a la derecha, avanza, gira a la izquierda, avanza, gira a la derecha y avanza.",
    ],
  },

  // ---------- Artes · la galería ----------
  {
    id: "inicial-artes-pincel",
    kind: "sequence",
    topic: "artes",
    level: "inicial",
    difficulty: 1,
    title: "El pincel",
    emoji: "🖌️",
    skill: "Secuencias",
    minutes: "2-3 min",
    story: "Robi lleva el pincel hasta el cuadro del fondo de la galería. ¡Está en línea recta!",
    map: parseMap("inicial-artes-pincel", ["G..S"], 270),
    hints: STRAIGHT_HINTS(3),
  },
  {
    id: "inicial-artes-pintura",
    kind: "sequence",
    topic: "artes",
    level: "inicial",
    difficulty: 2,
    title: "Pintura derramada",
    emoji: "🎨",
    skill: "Esquivar obstáculos",
    minutes: "3-5 min",
    story: "¡Se cayó un frasco de pintura! Rodea el charco para llegar al cuadro.",
    map: parseMap("inicial-artes-pintura", ["S.", "W.", "G."], 90),
    hints: [
      "No pises la pintura: baja por la otra columna.",
      "Avanza 1 y gira a la derecha para bajar.",
      "Avanza, gira a la derecha, avanza 2, gira a la derecha y avanza 1.",
    ],
  },
  {
    id: "inicial-artes-mural",
    kind: "stops",
    topic: "artes",
    level: "inicial",
    difficulty: 2,
    title: "El mural",
    emoji: "🖼️",
    skill: "Metas intermedias",
    minutes: "3-5 min",
    story: "Robi pinta un mural por partes: pasa por las dos banderas y termina en la estrella.",
    map: parseMap("inicial-artes-mural", ["SP#", "#.#", "#PG"], 90),
    hints: [
      "Pasa por las dos banderas antes de la estrella.",
      "La primera bandera está al lado; después hay que bajar.",
      "Avanza 1, gira a la derecha, avanza 2, gira a la izquierda y avanza 1.",
    ],
  },
  {
    id: "inicial-artes-donde",
    kind: "predict",
    topic: "artes",
    level: "inicial",
    difficulty: 2,
    title: "¿Dónde pinta?",
    emoji: "🔮",
    skill: "Leer programas",
    minutes: "2-3 min",
    story: "Lee el programa de Robi y toca la casilla donde va a dejar la gota de pintura.",
    map: parseMap("inicial-artes-donde", ["S..", "...", "..."], 180, { goalOptional: true }),
    given: [F, L, F, F],
    hints: [
      "Sigue los bloques uno por uno con tu dedo.",
      "Al empezar, Robi mira hacia abajo; al girar a la izquierda queda mirando a la derecha.",
      "Baja 1 y avanza 2 hacia la derecha.",
    ],
  },
  {
    id: "inicial-artes-arregla",
    kind: "fix",
    topic: "artes",
    level: "inicial",
    difficulty: 3,
    title: "Arregla el patrón",
    emoji: "🛠️",
    skill: "Encontrar errores",
    minutes: "3-5 min",
    story: "Este programa tiene un giro al revés y Robi se sale de la galería. Encuentra el error.",
    map: parseMap("inicial-artes-arregla", ["S.#", "#..", "##G"], 90),
    given: [F, R, F, R, F, L, F],
    hints: [
      FIX_HINT_1,
      "Después de bajar, el camino sigue hacia la derecha de la pantalla.",
      "Cambia el segundo Girar a la derecha por Girar a la izquierda.",
    ],
  },

  // ---------- Matemáticas · los números ----------
  {
    id: "inicial-matematicas-cinco",
    kind: "sequence",
    topic: "matematicas",
    level: "inicial",
    difficulty: 1,
    title: "Cuenta 5",
    emoji: "5️⃣",
    skill: "Contar pasos",
    minutes: "2-3 min",
    story: "¿Cuántas casillas hay hasta la estrella? Cuéntalas y dale a Robi esa cantidad de pasos.",
    map: parseMap("inicial-matematicas-cinco", ["S....G"], 90),
    hints: ["Robi ya mira hacia la estrella.", "Cuenta las casillas vacías y la de la estrella.", "Usa 5 bloques de Avanzar."],
  },
  {
    id: "inicial-matematicas-dos-y-dos",
    kind: "sequence",
    topic: "matematicas",
    level: "inicial",
    difficulty: 1,
    title: "Dos y dos",
    emoji: "➕",
    skill: "Contar pasos",
    minutes: "2-3 min",
    story: "Avanza 2, gira y avanza 2 más. ¿Cuántos pasos da Robi en total?",
    map: parseMap("inicial-matematicas-dos-y-dos", ["S..", "##.", "##G"], 90),
    hints: ["Son dos tramos de 2 casillas.", "Entre los dos tramos, Robi gira a la derecha.", "Avanza 2, gira a la derecha y avanza 2."],
  },
  {
    id: "inicial-matematicas-esquinas",
    kind: "stops",
    topic: "matematicas",
    level: "inicial",
    difficulty: 2,
    title: "Las esquinas",
    emoji: "🟧",
    skill: "Metas intermedias",
    minutes: "3-5 min",
    story: "Recorre el borde del cuadrado: pasa por las dos banderas de las esquinas de abajo y sube hasta la estrella.",
    map: parseMap("inicial-matematicas-esquinas", ["S#G", ".#.", "P.P"], 180),
    hints: [
      "Pasa por las dos banderas antes de la estrella.",
      "Baja 2, cruza por abajo y sube 2.",
      "Avanza 2, gira a la izquierda, avanza 2, gira a la izquierda y avanza 2.",
    ],
  },
  {
    id: "inicial-matematicas-donde",
    kind: "predict",
    topic: "matematicas",
    level: "inicial",
    difficulty: 2,
    title: "¿En qué casilla?",
    emoji: "🔮",
    skill: "Leer programas",
    minutes: "2-3 min",
    story: "Cuenta los bloques de Avanzar y toca la casilla donde termina Robi.",
    map: parseMap("inicial-matematicas-donde", ["S...", "....", "...."], 90, { goalOptional: true }),
    given: [F, F, F, R, F, F],
    hints: [
      "Cuenta cuántos Avanzar hay antes del giro.",
      "Después de girar a la derecha, Robi mira hacia abajo.",
      "Avanza 3 hacia la derecha y baja 2.",
    ],
  },
  {
    id: "inicial-matematicas-arregla",
    kind: "fix",
    topic: "matematicas",
    level: "inicial",
    difficulty: 3,
    title: "Un paso de más",
    emoji: "🛠️",
    skill: "Encontrar errores",
    minutes: "3-5 min",
    story: "Alguien contó mal: este programa tiene un paso de más y Robi se sale. Arréglalo.",
    map: parseMap("inicial-matematicas-arregla", ["S..#", "##.#", "##.G"], 90),
    given: [F, F, F, R, F, F, L, F],
    hints: [FIX_HINT_1, "Antes del primer giro hay 2 casillas, no 3.", "Quita uno de los tres primeros bloques de Avanzar."],
  },
  {
    id: "inicial-matematicas-justos",
    kind: "efficient",
    topic: "matematicas",
    level: "inicial",
    difficulty: 3,
    title: "Pasos justos",
    emoji: "🎯",
    skill: "Contar y ahorrar bloques",
    minutes: "3-5 min",
    story: "El camino baja al final. Llega a la estrella usando 6 bloques o menos: ni uno de más.",
    map: parseMap("inicial-matematicas-justos", ["S...", "###.", "###G"], 90),
    maxBlocks: 6,
    hints: [
      "Cuenta las casillas de cada tramo.",
      "Son 3 hacia la derecha, un giro y 2 hacia abajo.",
      "Avanza 3, gira a la derecha y avanza 2: 6 bloques.",
    ],
  },

  // ---------- Legado: bloques de Primaria (ya no se listan) ----------
  // Primaria juega misiones (domain/lab). Estos seis retos de Tecnología se conservan
  // para que sigan funcionando los enlaces, las partidas ya enviadas y `explore.recordPlay`
  // de las webs que todavía los usan; `openChallenges()` no los cuenta.
  {
    id: "primaria-casa",
    kind: "sequence",
    topic: "tecnologia",
    level: "primaria",
    difficulty: 1,
    title: "A casa",
    emoji: "🧸",
    skill: "Secuencias y planificación",
    minutes: "3-5 min",
    story: "Robi termina de jugar y vuelve a la estrella por el camino.",
    map: parseMap("primaria-casa", ["S..#", "##.#", "##.G"], 90),
    hints: [
      "El camino va a la derecha y luego baja.",
      "Avanza 2 y gira a la derecha.",
      "Avanza 2, gira a la derecha, avanza 2, gira a la izquierda y avanza 1.",
    ],
  },
  {
    id: "primaria-charco",
    kind: "sequence",
    topic: "tecnologia",
    level: "primaria",
    difficulty: 2,
    title: "El charco",
    emoji: "💧",
    skill: "Esquivar obstáculos",
    minutes: "5-8 min",
    story: "Robi quiere llegar a la estrella sin pasar por el charco. Arma la secuencia de pasos para lograrlo.",
    map: parseMap("primaria-charco", ["....", "S.WG"], 90),
    hints: [
      "Rodea el charco por arriba.",
      "Avanza 1 y gira a la izquierda para subir.",
      "Avanza, sube, avanza 2 a la derecha y baja a la estrella.",
    ],
  },
  {
    id: "primaria-donde",
    kind: "predict",
    topic: "tecnologia",
    level: "primaria",
    difficulty: 2,
    title: "¿Dónde llegará?",
    emoji: "🔮",
    skill: "Leer programas",
    minutes: "3-5 min",
    story: "Lee el programa de Robi, con su Repetir, y toca la casilla donde termina.",
    map: parseMap("primaria-donde", ["....", "....", "....", "S..."], 0, { goalOptional: true }),
    given: [repeat(2, [F]), R, repeat(3, [F]), B],
    hints: [
      "Repetir 2 veces Avanzar es lo mismo que avanzar 2 casillas.",
      "Retroceder mueve a Robi hacia atrás sin girar.",
      "Sube 2, avanza 3 a la derecha y retrocede 1.",
    ],
  },
  {
    id: "primaria-arregla",
    kind: "fix",
    topic: "tecnologia",
    level: "primaria",
    difficulty: 3,
    title: "Arregla el camino",
    emoji: "🛠️",
    skill: "Encontrar errores",
    minutes: "5-8 min",
    story: "Alguien escribió este programa, pero Robi se sale del camino. Encuentra el error y corrígelo.",
    map: parseMap("primaria-arregla", ["S...#", "###.#", "###.G"], 90),
    given: [F, F, F, F, R, F, F, L, F],
    hints: [
      "Ejecuta el programa y mira en qué paso se sale.",
      "Robi avanza una casilla de más antes de girar.",
      "Quita uno de los primeros bloques de Avanzar.",
    ],
  },
  {
    id: "primaria-paradas",
    kind: "stops",
    topic: "tecnologia",
    level: "primaria",
    difficulty: 3,
    title: "Dos paradas",
    emoji: "🚩",
    skill: "Metas intermedias",
    minutes: "5-8 min",
    story: "Robi lleva pan a dos vecinos. Pasa por las dos banderas antes de llegar a la estrella.",
    map: parseMap("primaria-paradas", ["S.P..", "####.", "G..P."], 90),
    hints: [
      "Hay que pasar por las dos banderas antes de la estrella.",
      "El camino va a la derecha, baja y vuelve a la izquierda.",
      "Usa Repetir: avanza 4, gira a la derecha, avanza 2, gira a la derecha y avanza 4.",
    ],
  },
  {
    id: "primaria-menos",
    kind: "efficient",
    topic: "tecnologia",
    level: "primaria",
    difficulty: 4,
    title: "Menos pasos",
    emoji: "🧩",
    skill: "Patrones y eficiencia",
    minutes: "5-8 min",
    story: "El camino es una escalera. Llega a la estrella usando 6 bloques o menos.",
    map: parseMap("primaria-menos", ["S.##", "#..#", "##.G"], 90),
    maxBlocks: 6,
    hints: [
      "La escalera repite el mismo patrón.",
      "El patrón es: avanzar, girar a la derecha, avanzar, girar a la izquierda.",
      "Repite 2 veces ese patrón y termina con un Avanzar.",
    ],
  },
];

export const challengeById = (id: string): Challenge | undefined => CHALLENGES.find((c) => c.id === id);

export const challengesFor = (topic: string, level: EducationLevel): Challenge[] =>
  CHALLENGES.filter((c) => c.topic === topic && c.level === level);

/** El siguiente reto del mismo tópico y nivel, para "Siguiente reto". */
export function nextChallenge(current: Challenge): Challenge | undefined {
  const list = challengesFor(current.topic, current.level);
  return list[list.indexOf(current) + 1];
}
