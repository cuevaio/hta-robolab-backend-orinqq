import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { liveMode, liveStatus, liveProgress } from "./lib/liveValidators";

export const educationLevel = v.union(
  v.literal("inicial"),
  v.literal("primaria"),
  v.literal("secundaria"),
);

export default defineSchema({
  // Tablas de Convex Auth. Los docentes son los usuarios autenticados.
  ...authTables,

  classrooms: defineTable({
    teacherId: v.id("users"),
    level: educationLevel,
    grade: v.string(),
    section: v.string(),
    // Código para que los alumnos se unan (ABC-123). Las clases anteriores a los códigos no lo tienen.
    joinCode: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_teacher", ["teacherId"])
    .index("by_join_code", ["joinCode"]),

  // Los alumnos no tienen cuenta: se unen a la clase con su código y un apodo (`student.join`),
  // o entran con un código personal que les da el docente (`accessCode`, solo los que él agregó).
  students: defineTable({
    classroomId: v.id("classrooms"),
    displayName: v.string(),
    accessCode: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_classroom", ["classroomId"])
    .index("by_access_code", ["accessCode"]),

  evaluations: defineTable({
    teacherId: v.id("users"),
    classroomId: v.id("classrooms"),
    title: v.string(),
    scheduledDate: v.string(), // "AAAA-MM-DD" del calendario del docente
    createdAt: v.number(),
  })
    .index("by_teacher_date", ["teacherId", "scheduledDate"])
    .index("by_classroom_date", ["classroomId", "scheduledDate"]),

  // La respuesta correcta vive solo aquí y nunca se envía al alumno.
  questions: defineTable({
    evaluationId: v.id("evaluations"),
    order: v.number(),
    prompt: v.string(),
    options: v.array(v.string()),
    correctOption: v.number(),
    points: v.number(),
  }).index("by_evaluation_order", ["evaluationId", "order"]),

  studentSessions: defineTable({
    studentId: v.id("students"),
    token: v.string(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_student", ["studentId"]),

  // Ingresos de alumno fallidos (código que no existe), para frenar a quien adivina códigos.
  signInFailures: defineTable({
    at: v.number(),
  }).index("by_at", ["at"]),

  attempts: defineTable({
    evaluationId: v.id("evaluations"),
    studentId: v.id("students"),
    // Vez que rinde la evaluación (1, 2, 3…). Los intentos antiguos no lo tienen: son la 1.
    number: v.optional(v.number()),
    startedAt: v.number(),
    stage: v.number(), // etapa actual del minijuego, 0-based
    questionShownAt: v.optional(v.number()), // pregunta de la etapa ya desbloqueada
    finishedAt: v.optional(v.number()),
    score: v.optional(v.number()),
    maxScore: v.optional(v.number()),
    percent: v.optional(v.number()),
    totalMs: v.optional(v.number()),
    totalRuns: v.optional(v.number()), // veces que tocó "Ejecutar" en todo el intento
  })
    .index("by_student_evaluation", ["studentId", "evaluationId"])
    .index("by_evaluation", ["evaluationId"]),

  answers: defineTable({
    attemptId: v.id("attempts"),
    questionId: v.id("questions"),
    stage: v.number(),
    chosenOption: v.number(),
    isCorrect: v.boolean(),
    pointsAwarded: v.number(),
    shownAt: v.number(),
    answeredAt: v.number(),
    blocksUsed: v.number(),
    runs: v.number(),
  }).index("by_attempt", ["attemptId"]),

  // Cada vez que el alumno toca "Ejecutar": el servidor lo simula y lo anota.
  runs: defineTable({
    attemptId: v.id("attempts"),
    stage: v.number(),
    outcome: v.union(v.literal("GOAL"), v.literal("OFF_PATH"), v.literal("INCOMPLETE"), v.literal("EMPTY")),
    failedStep: v.optional(v.number()),
    blocks: v.number(),
    createdAt: v.number(),
  }).index("by_attempt_stage", ["attemptId", "stage"]),

  // Modo abierto: una fila por reto jugado, con un id de dispositivo al azar (sin nombres).
  explorePlays: defineTable({
    deviceId: v.string(),
    challengeId: v.string(),
    solved: v.boolean(),
    runs: v.number(),
    hints: v.number(),
    ms: v.number(),
    createdAt: v.number(),
  }).index("by_device_time", ["deviceId", "createdAt"]),

  // Robots físicos (ESP32 por wifi). La clave solo se guarda cifrada (SHA-256).
  robots: defineTable({
    name: v.string(),
    code: v.string(), // código de emparejamiento (6 caracteres)
    codeExpiresAt: v.optional(v.number()),
    keyHash: v.string(),
    createdAt: v.number(),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_key_hash", ["keyHash"]),

  // Programas enviados a un robot, en letras (A R D Z), y lo que respondió.
  robotCommands: defineTable({
    robotId: v.id("robots"),
    letters: v.string(),
    status: v.union(
      v.literal("pending"), // en cola
      v.literal("sent"), // el robot lo recogió
      v.literal("received"), // OK
      v.literal("running"), // RUN
      v.literal("done"), // DONE
      v.literal("failed"), // ERR:<código>
      v.literal("replaced"), // de la versión anterior del relé
      v.literal("expired"), // el robot no dio noticias a tiempo
    ),
    error: v.optional(v.string()),
    requestId: v.optional(v.string()), // id de envío de la web (idempotencia)
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    doneAt: v.optional(v.number()),
  })
    .index("by_robot", ["robotId"])
    .index("by_robot_status", ["robotId", "status"])
    .index("by_robot_request", ["robotId", "requestId"]),

  // Registro de cada correo pedido: confirma si salió y sirve para frenar abusos.
  // Panel de impacto: cuentas por día (hora de Perú) y una fila "total". Solo cifras.
  impactDays: defineTable({
    day: v.string(),
    plays: v.number(),
    solved: v.number(),
    withHints: v.number(),
    withHintsSolved: v.number(),
    runsSolved: v.number(),
    msSolved: v.number(),
    devices: v.number(),
    attemptsFinished: v.number(),
    students: v.number(),
  }).index("by_day", ["day"]),
  // Qué clave opaca (dispositivo o alumno) ya se contó cada día, para no contarla dos veces.
  impactSeen: defineTable({
    day: v.string(),
    key: v.string(),
  }).index("by_day_key", ["day", "key"]),

  // Laboratorio multigrado: misiones de Primaria creadas por docentes y las partidas
  // (anónimas) de cualquier misión, sea del modo abierto o de un docente.
  labMissions: defineTable({
    teacherId: v.optional(v.id("users")), // sin docente: la misión semilla
    title: v.string(),
    theme: v.string(),
    prompt: v.string(),
    mission: v.any(), // Mission de domain/lab; parseMission la revisa al leer
    visibility: v.union(v.literal("public"), v.literal("draft")),
    createdAt: v.number(),
  })
    .index("by_visibility", ["visibility"])
    .index("by_teacher", ["teacherId"]),
  // Asistente de misiones (Gemini o Anthropic): peticiones por docente (tope de gasto) y misiones verificadas que eligió.
  agentUsage: defineTable({
    teacherId: v.id("users"),
    createdAt: v.number(),
  }).index("by_teacher_time", ["teacherId", "createdAt"]),
  agentMissions: defineTable({
    teacherId: v.id("users"),
    grade: v.number(),
    title: v.string(),
    objective: v.string(),
    mission: v.any(), // Mission v1 (domain/mission); parseCustomMission la revisa al guardar
    metrics: v.any(), // evaluate_difficulty al guardar
    createdAt: v.number(),
  }).index("by_teacher", ["teacherId"]),
  labPlays: defineTable({
    missionId: v.string(), // id de MISSIONS (dominio) o id de labMissions
    level: v.number(), // subnivel 0, 1 o 2
    deviceId: v.optional(v.string()),
    ok: v.boolean(),
    error: v.optional(v.string()),
    energy: v.number(),
    steps: v.number(),
    hints: v.number(),
    createdAt: v.number(),
  })
    .index("by_mission_time", ["missionId", "createdAt"])
    .index("by_device_time", ["deviceId", "createdAt"]),

  // @robolab/backend 0.4.0: retos asignados a una clase y las partidas verificadas de sus alumnos.
  assignments: defineTable({
    // Sin clase mientras el docente aún no lo asigna (T7 "Asignar a una clase").
    classroomId: v.optional(v.id("classrooms")),
    // Id de un reto de bloques o de una misión de Primaria (domain/classroom/catalog).
    challengeId: v.string(),
    visibility: v.union(v.literal("public"), v.literal("class"), v.literal("draft")),
    teacherId: v.id("users"),
    createdAt: v.number(),
    // Cuando el docente lo cierra deja de verse para los alumnos; sus resultados se conservan.
    closedAt: v.optional(v.number()),
  })
    .index("by_classroom", ["classroomId"])
    .index("by_teacher", ["teacherId"]),
  // Una fila por partida de un alumno con sesión; `solved` lo decide el servidor.
  challengePlays: defineTable({
    studentId: v.id("students"),
    classroomId: v.id("classrooms"),
    challengeId: v.string(),
    solved: v.boolean(),
    runs: v.number(),
    hints: v.number(),
    ms: v.number(),
    createdAt: v.number(),
  })
    .index("by_student", ["studentId", "createdAt"])
    .index("by_classroom_challenge", ["classroomId", "challengeId"]),

  liveRooms: defineTable({
    teacherId: v.id("users"), classroomId: v.id("classrooms"), mazeId: v.string(), mode: liveMode,
    status: liveStatus, createdAt: v.number(), startedAt: v.union(v.number(), v.null()), closedAt: v.union(v.number(), v.null()),
    participantCount: v.number(), finisherCount: v.number(),
    shared: v.object({ ...liveProgress, revision: v.number() }),
  }).index("by_teacherId", ["teacherId"]).index("by_classroomId", ["classroomId"]),
  liveParticipants: defineTable({
    roomId: v.id("liveRooms"), classroomId: v.id("classrooms"), studentId: v.id("students"), displayName: v.string(),
    ...liveProgress, place: v.union(v.number(), v.null()), lastRunAt: v.union(v.number(), v.null()),
  }).index("by_roomId", ["roomId"]).index("by_roomId_and_studentId", ["roomId", "studentId"]).index("by_classroomId", ["classroomId"]),
  liveRunRequests: defineTable({
    roomId: v.id("liveRooms"), classroomId: v.id("classrooms"), studentId: v.id("students"), requestId: v.string(),
  }).index("by_roomId_and_studentId_and_requestId", ["roomId", "studentId", "requestId"]).index("by_classroomId", ["classroomId"]),

  emailDeliveries: defineTable({
    to: v.string(),
    kind: v.literal("password-reset"),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    provider: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    requestedAt: v.number(),
    settledAt: v.optional(v.number()),
  }).index("by_to_requested", ["to", "requestedAt"]),
});
