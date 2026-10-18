/**
 * Portal del alumno: se une a su clase con el código de la clase y un apodo
 * (o entra con el código personal que le dio el docente), juega y responde.
 *
 * El servidor es la autoridad del intento: simula cada programa que el
 * alumno ejecuta (y lo anota), revela la pregunta solo cuando el robot llega
 * a la estrella (sin la respuesta correcta) y calcula la nota con sus propios
 * tiempos. El alumno puede volver a rendir la evaluación; cada vez es un
 * intento nuevo y todos quedan registrados.
 */
import { ConvexError, v } from "convex/values";
import { agentIdOf } from "../domain/classroom/agentItem";
import { isValidJoinCode, normalizeJoinCode } from "../domain/classroom/joinCode";
import { cleanNickname, nameKey } from "../domain/classroom/studentName";
import {
  generateSessionToken,
  isValidAccessCode,
  normalizeAccessCode,
} from "../domain/evaluation/accessCode";
import { limaCalendarDate } from "../domain/evaluation/calendar";
import { gradeAnswer, gradeEvaluation } from "../domain/evaluation/scoring";
import { policyFor } from "../domain/game/levels";
import { ProgramError, compile, countBlocks, parseProgram, usesOnly } from "../domain/game/program";
import { simulate } from "../domain/game/simulator";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, mutation, query } from "./_generated/server";
import { attemptNumber, attemptsOf, runsOf } from "./lib/attempts";
import { classroomLabel, requireStudent } from "./lib/access";
import { verifyAgentPlay } from "./lib/agentPlay";
import { agentMissionOf, resolveItem } from "./lib/items";
import { visibleAssignments, studentsOf } from "./lib/classwork";
import { countFinishedAttempt, countPlay } from "./lib/impact";
import { MAX_PLAYS_PER_MINUTE, PLAY_WINDOW_MS, TOO_MANY_PLAYS, playArgs, verifyPlay } from "./lib/plays";

const SESSION_MS = 8 * 60 * 60 * 1000; // una jornada escolar
/** Tope de veces que se puede rendir una misma evaluación. */
export const MAX_TRIES = 20;
/** Tope de ejecuciones por estrella: evita llenar la base con clics repetidos. */
/** Ejecuciones seguidas que se aceptan por estrella. Pasado el minuto se puede seguir: nunca es un bloqueo definitivo. */
export const RUNS_PER_MINUTE = 30;
export const RUN_WINDOW_MS = 60_000;

async function questionsOf(ctx: QueryCtx, evaluationId: Id<"evaluations">) {
  return await ctx.db
    .query("questions")
    .withIndex("by_evaluation_order", (q) => q.eq("evaluationId", evaluationId))
    .collect();
}

async function requireOwnAttempt(ctx: QueryCtx, token: string, attemptId: Id<"attempts">) {
  const { student, classroom } = await requireStudent(ctx, token);
  const attempt = await ctx.db.get(attemptId);
  if (!attempt || attempt.studentId !== student._id) throw new ConvexError("No encontramos tu evaluación.");
  return { student, classroom, attempt };
}

async function requireOwnEvaluation(ctx: QueryCtx, token: string, evaluationId: Id<"evaluations">) {
  const { student, classroom } = await requireStudent(ctx, token);
  const evaluation = await ctx.db.get(evaluationId);
  if (!evaluation || evaluation.classroomId !== classroom._id) {
    throw new ConvexError("Esa evaluación no es de tu clase.");
  }
  return { student, evaluation };
}

/** Solo se juega el día programado, según el reloj del servidor (hora de Perú), no el de la tablet. */
function requireScheduledToday(evaluation: Doc<"evaluations">) {
  const today = limaCalendarDate();
  if (evaluation.scheduledDate > today) throw new ConvexError("Esta evaluación todavía no empieza. Es para otro día.");
  if (evaluation.scheduledDate < today) throw new ConvexError("Esta evaluación ya pasó. Pídele a tu docente una nueva.");
}

async function requirePlayableAttempt(ctx: QueryCtx, token: string, attemptId: Id<"attempts">) {
  const own = await requireOwnAttempt(ctx, token, attemptId);
  const evaluation = await ctx.db.get(own.attempt.evaluationId);
  if (!evaluation) throw new ConvexError("No encontramos tu evaluación.");
  requireScheduledToday(evaluation);
  return own;
}

/** Cantidad de bloques del programa: dato informativo, nunca invalida la respuesta. */
function blocksIn(program: unknown): number {
  try {
    return countBlocks(parseProgram(program));
  } catch {
    return 0;
  }
}

const toPublicQuestion = (q: Doc<"questions">, stage: number) => ({
  stage,
  prompt: q.prompt,
  options: q.options,
  points: q.points,
});

/**
 * Freno contra adivinar códigos: si en un minuto fallan más ingresos de los
 * que un aula produce de verdad, nadie entra hasta que pase el minuto. Con
 * 887 millones de códigos posibles, a 60 intentos por minuto probarlos todos
 * tomaría siglos. No se guarda quién falló: solo cuándo.
 */
export const MAX_FAILED_SIGNINS_PER_MINUTE = 60;
export const SIGNIN_WINDOW_MS = 60_000;

async function recentFailures(ctx: QueryCtx, now: number) {
  return await ctx.db
    .query("signInFailures")
    .withIndex("by_at", (q) => q.gt("at", now - SIGNIN_WINDOW_MS))
    .collect();
}

export const signIn = mutation({
  args: { code: v.string() },
  // Los fallos se devuelven (no se lanzan): un error deshace las escrituras de la
  // mutación, y el fallo se necesita guardado para contar los intentos.
  handler: async (ctx, { code }): Promise<{ token: string; displayName: string } | { error: string }> => {
    const now = Date.now();
    if ((await recentFailures(ctx, now)).length >= MAX_FAILED_SIGNINS_PER_MINUTE) {
      return { error: "Hubo muchos intentos seguidos. Espera un minuto y vuelve a intentar." };
    }
    const accessCode = normalizeAccessCode(code);
    const student = isValidAccessCode(accessCode)
      ? await ctx.db
          .query("students")
          .withIndex("by_access_code", (q) => q.eq("accessCode", accessCode))
          .unique()
      : null;
    if (!student) {
      await ctx.db.insert("signInFailures", { at: now });
      // Limpieza de paso: los fallos viejos ya no cuentan y no hace falta guardarlos.
      const old = await ctx.db
        .query("signInFailures")
        .withIndex("by_at", (q) => q.lt("at", now - SIGNIN_WINDOW_MS))
        .take(20);
      for (const row of old) await ctx.db.delete(row._id);
      return {
        error: isValidAccessCode(accessCode)
          ? "No encontramos ese código. Pídele ayuda a tu profesora o profesor."
          : "Ese código no es válido. Revisa las letras.",
      };
    }
    const token = generateSessionToken();
    await ctx.db.insert("studentSessions", { studentId: student._id, token, expiresAt: now + SESSION_MS });
    return { token, displayName: student.displayName };
  },
});

/** Se anota el fallo y se limpian los viejos: el freno de `signIn` y `join` es el mismo. */
async function failJoin(ctx: MutationCtx, now: number, error: string): Promise<{ error: string }> {
  await ctx.db.insert("signInFailures", { at: now });
  const old = await ctx.db
    .query("signInFailures")
    .withIndex("by_at", (q) => q.lt("at", now - SIGNIN_WINDOW_MS))
    .take(20);
  for (const row of old) await ctx.db.delete(row._id);
  return { error };
}

/** Tope de alumnos por clase: el código se comparte, y sin tope cualquiera con el podría llenarla. */
export const MAX_STUDENTS_PER_CLASS = 200;

/**
 * El alumno se une a su clase con el código que el docente le dio (ABC-123) y
 * un apodo, sin cuenta ni lista previa. Un código que no existe se devuelve
 * como `{ error }` (cuenta para el freno, igual que `signIn`); un apodo no
 * válido o repetido en la clase se lanza, porque no hay nada que contar.
 */
export const join = mutation({
  args: { code: v.string(), nickname: v.string() },
  handler: async (
    ctx,
    { code, nickname },
  ): Promise<{ token: string; displayName: string; classroomLabel: string } | { error: string }> => {
    const now = Date.now();
    if ((await recentFailures(ctx, now)).length >= MAX_FAILED_SIGNINS_PER_MINUTE) {
      return { error: "Hubo muchos intentos seguidos. Espera un minuto y vuelve a intentar." };
    }
    const joinCode = normalizeJoinCode(code);
    const classroom = isValidJoinCode(joinCode)
      ? await ctx.db
          .query("classrooms")
          .withIndex("by_join_code", (q) => q.eq("joinCode", joinCode))
          .unique()
      : null;
    if (!classroom) return await failJoin(ctx, now, "No encontramos esa clase. Revisa el código.");

    const checked = cleanNickname(nickname);
    if (!checked.ok) throw new ConvexError(checked.reason);
    const classmates = await studentsOf(ctx, classroom._id);
    if (classmates.some((s) => nameKey(s.displayName) === nameKey(checked.name))) {
      throw new ConvexError("Ese apodo ya está en uso en tu clase. Elige otro.");
    }
    if (classmates.length >= MAX_STUDENTS_PER_CLASS) throw new ConvexError("Esta clase ya está llena. Avísale a tu profesora o profesor.");

    const studentId = await ctx.db.insert("students", { classroomId: classroom._id, displayName: checked.name, createdAt: now });
    const token = generateSessionToken();
    await ctx.db.insert("studentSessions", { studentId, token, expiresAt: now + SESSION_MS });
    return { token, displayName: checked.name, classroomLabel: classroomLabel(classroom) };
  },
});

export const signOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("studentSessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});

/** Lo que ve el alumno al entrar: su evaluación del día, directamente. */
export const home = query({
  // `today` lo mandaba la web antigua; se ignora: el día lo decide el servidor.
  args: { token: v.string(), today: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    const today = limaCalendarDate();
    const { student, classroom } = await requireStudent(ctx, token);
    const evaluations = await ctx.db
      .query("evaluations")
      .withIndex("by_classroom_date", (q) => q.eq("classroomId", classroom._id).eq("scheduledDate", today))
      .collect();

    const items = await Promise.all(
      evaluations.map(async (e) => {
        const attempts = await attemptsOf(ctx, student._id, e._id);
        const latest = attempts.at(-1);
        const questions = await questionsOf(ctx, e._id);
        return {
          evaluationId: e._id,
          title: e.title,
          questionCount: questions.length,
          attemptId: latest?._id ?? null,
          stage: latest?.stage ?? 0,
          finished: latest?.finishedAt !== undefined,
          tries: attempts.filter((a) => a.finishedAt !== undefined).length,
          createdAt: e.createdAt,
        };
      }),
    );
    items.sort((a, b) => a.createdAt - b.createdAt);
    // La primera sin terminar; si terminó todas, muestra la última para ver su resultado.
    const current = items.find((i) => !i.finished) ?? items.at(-1) ?? null;

    // Retos de la clase (sin borradores), con una marca en los que este alumno ya resolvió.
    const solvedIds = new Set(
      (
        await ctx.db
          .query("challengePlays")
          .withIndex("by_student", (q) => q.eq("studentId", student._id))
          .collect()
      )
        .filter((p) => p.solved)
        .map((p) => p.challengeId),
    );
    const classChallenges = [];
    for (const a of await visibleAssignments(ctx, classroom._id)) {
      const item = await resolveItem(ctx, a.challengeId);
      if (item) classChallenges.push({ assignmentId: a._id, challengeId: a.challengeId, title: item.title, level: item.level, kind: item.kind, solved: solvedIds.has(a.challengeId) });
    }
    return {
      displayName: student.displayName,
      level: classroom.level,
      classroomLabel: classroomLabel(classroom),
      /** Código de la clase; null en las anteriores a los códigos. */
      joinCode: classroom.joinCode ?? null,
      today,
      evaluation: current,
      pendingCount: items.filter((i) => !i.finished).length,
      classChallenges,
    };
  },
});

/** La misión del asistente `ia:…` si está visible (no es borrador ni está cerrada) en esa clase. */
async function classAgentMission(ctx: QueryCtx, classroomId: Id<"classrooms">, challengeId: string) {
  const visible = (await visibleAssignments(ctx, classroomId)).some((a) => a.challengeId === challengeId);
  return visible ? await agentMissionOf(ctx, challengeId) : null;
}

/** El tablero de una misión del asistente que el docente le dejó a la clase de este alumno; null si no la tiene. */
export const agentMission = query({
  args: { token: v.string(), challengeId: v.string() },
  handler: async (ctx, { token, challengeId }) => {
    const { classroom } = await requireStudent(ctx, token);
    if (agentIdOf(challengeId) === null) return null;
    const doc = await classAgentMission(ctx, classroom._id, challengeId);
    return doc ? doc.mission : null;
  },
});

/**
 * El alumno terminó una partida de un reto de su clase (o de cualquier reto
 * abierto). Igual que `explore.recordPlay`, el servidor vuelve a revisar el
 * programa: en un reto de bloques con `program` o `pick`; en una misión de
 * Primaria con `arrows` y `level`. Queda anotada a nombre del alumno y suma al
 * panel de impacto sin nombres.
 */
export const recordChallengePlay = mutation({
  args: { token: v.string(), ...playArgs },
  handler: async (ctx, { token, ...input }): Promise<{ solved: boolean }> => {
    const { student } = await requireStudent(ctx, token);
    // Una misión del asistente: debe estar visible en la clase de este alumno; el servidor la vuelve a ejecutar.
    const agent = agentIdOf(input.challengeId) === null ? null : await classAgentMission(ctx, student.classroomId, input.challengeId);
    if (agentIdOf(input.challengeId) !== null && !agent) throw new ConvexError("Ese reto no existe.");
    const { challengeId, play } = agent ? verifyAgentPlay(agent, input.challengeId, input) : verifyPlay(input);

    const now = Date.now();
    const recent = await ctx.db
      .query("challengePlays")
      .withIndex("by_student", (q) => q.eq("studentId", student._id).gt("createdAt", now - PLAY_WINDOW_MS))
      .collect();
    if (recent.length >= MAX_PLAYS_PER_MINUTE) throw new ConvexError(TOO_MANY_PLAYS);

    await ctx.db.insert("challengePlays", { studentId: student._id, classroomId: student.classroomId, challengeId, ...play, createdAt: now });
    await countPlay(ctx, now, `alumno:${student._id}`, play);
    return { solved: play.solved };
  },
});

/** Primera vez: crea el intento. Si ya hay uno, lo retoma. */
export const start = mutation({
  args: { token: v.string(), evaluationId: v.id("evaluations") },
  handler: async (ctx, { token, evaluationId }) => {
    const { student, evaluation } = await requireOwnEvaluation(ctx, token, evaluationId);
    const latest = (await attemptsOf(ctx, student._id, evaluationId)).at(-1);
    if (latest) return latest._id;
    requireScheduledToday(evaluation);
    return await ctx.db.insert("attempts", {
      evaluationId,
      studentId: student._id,
      number: 1,
      startedAt: Date.now(),
      stage: 0,
    });
  },
});

/** "Intentar de nuevo": un intento nuevo, después de terminar el anterior. */
export const retry = mutation({
  args: { token: v.string(), evaluationId: v.id("evaluations") },
  handler: async (ctx, { token, evaluationId }) => {
    const { student, evaluation } = await requireOwnEvaluation(ctx, token, evaluationId);
    const attempts = await attemptsOf(ctx, student._id, evaluationId);
    const latest = attempts.at(-1);
    if (!latest) throw new ConvexError("Primero empieza la evaluación.");
    if (latest.finishedAt === undefined) return latest._id; // ya está jugando otra vez
    requireScheduledToday(evaluation);
    if (attempts.length >= MAX_TRIES) throw new ConvexError("Ya jugaste muchas veces esta evaluación. ¡Buen trabajo!");
    return await ctx.db.insert("attempts", {
      evaluationId,
      studentId: student._id,
      number: attemptNumber(latest) + 1,
      startedAt: Date.now(),
      stage: 0,
    });
  },
});

/** Estado del intento para reanudar justo donde quedó el alumno. */
export const attempt = query({
  args: { token: v.string(), attemptId: v.id("attempts") },
  handler: async (ctx, { token, attemptId }) => {
    const { classroom, attempt } = await requireOwnAttempt(ctx, token, attemptId);
    const evaluation = await ctx.db.get(attempt.evaluationId);
    const questions = await questionsOf(ctx, attempt.evaluationId);
    const pending = attempt.questionShownAt !== undefined ? questions[attempt.stage] : undefined;
    return {
      evaluationId: attempt.evaluationId,
      title: evaluation?.title ?? "",
      level: classroom.level,
      number: attemptNumber(attempt),
      stage: attempt.stage,
      questionCount: questions.length,
      finished: attempt.finishedAt !== undefined,
      pendingQuestion: pending ? toPublicQuestion(pending, attempt.stage) : null,
    };
  },
});

/**
 * El alumno tocó "Ejecutar". El servidor simula el mismo programa, anota la
 * ejecución (llegue o no) y, si el robot llegó a la estrella, desbloquea la
 * pregunta de la etapa.
 */
export const submitRun = mutation({
  args: { token: v.string(), attemptId: v.id("attempts"), program: v.any() },
  handler: async (ctx, { token, attemptId, program }) => {
    const { classroom, attempt } = await requirePlayableAttempt(ctx, token, attemptId);
    if (attempt.finishedAt !== undefined) throw new ConvexError("Ya terminaste esta evaluación.");
    const questions = await questionsOf(ctx, attempt.evaluationId);
    const question = questions[attempt.stage];
    if (!question) throw new ConvexError("No hay más preguntas.");
    // Si la pregunta ya estaba abierta (por ejemplo, recargó la página), no se cuenta otra ejecución.
    if (attempt.questionShownAt !== undefined) {
      return { outcome: "GOAL" as const, question: toPublicQuestion(question, attempt.stage) };
    }

    const now = Date.now();
    const previous = await runsOf(ctx, attempt._id, attempt.stage);
    if (previous.filter((r) => now - r.createdAt < RUN_WINDOW_MS).length >= RUNS_PER_MINUTE) {
      throw new ConvexError("Tómate un respiro de un minuto y vuelve a intentarlo.");
    }

    const policy = policyFor(classroom.level);
    let result: ReturnType<typeof simulate>;
    let blocks: number;
    try {
      const parsed = parseProgram(program);
      if (!usesOnly(parsed, policy.palette)) throw new ConvexError("Usaste un bloque que no está disponible.");
      blocks = countBlocks(parsed);
      result = simulate(policy.mapFor(attempt.stage), compile(parsed));
    } catch (error) {
      if (error instanceof ProgramError) throw new ConvexError(error.message);
      throw error;
    }

    const { outcome } = result;
    await ctx.db.insert("runs", {
      attemptId: attempt._id,
      stage: attempt.stage,
      outcome: outcome.kind,
      ...(outcome.kind === "OFF_PATH" ? { failedStep: outcome.failedStep } : {}),
      blocks,
      createdAt: now,
    });
    if (outcome.kind !== "GOAL") return { outcome: outcome.kind, question: null };
    await ctx.db.patch(attempt._id, { questionShownAt: now });
    return { outcome: outcome.kind, question: toPublicQuestion(question, attempt.stage) };
  },
});

export const answer = mutation({
  args: {
    token: v.string(),
    attemptId: v.id("attempts"),
    chosenOption: v.number(),
    program: v.any(),
  },
  handler: async (ctx, args) => {
    const { attempt } = await requirePlayableAttempt(ctx, args.token, args.attemptId);
    if (attempt.finishedAt !== undefined) throw new ConvexError("Ya terminaste esta evaluación.");
    if (attempt.questionShownAt === undefined) throw new ConvexError("Primero lleva al robot a la estrella.");
    const questions = await questionsOf(ctx, attempt.evaluationId);
    const question = questions[attempt.stage];
    if (!question) throw new ConvexError("No hay más preguntas.");
    if (!Number.isInteger(args.chosenOption) || args.chosenOption < 0 || args.chosenOption >= question.options.length) {
      throw new ConvexError("Elige una de las alternativas.");
    }

    const now = Date.now();
    const graded = gradeAnswer(
      { questionId: question._id, correctOption: question.correctOption, points: question.points },
      { questionId: question._id, chosenOption: args.chosenOption, shownAt: attempt.questionShownAt, answeredAt: now },
    );
    // Las ejecuciones las cuenta el servidor; el navegador no puede cambiarlas.
    const runs = Math.max(1, (await runsOf(ctx, attempt._id, attempt.stage)).length);
    await ctx.db.insert("answers", {
      attemptId: attempt._id,
      questionId: question._id,
      stage: attempt.stage,
      chosenOption: args.chosenOption,
      isCorrect: graded.isCorrect,
      pointsAwarded: graded.pointsAwarded,
      shownAt: graded.shownAt,
      answeredAt: graded.answeredAt,
      blocksUsed: blocksIn(args.program),
      runs,
    });

    const nextStage = attempt.stage + 1;
    if (nextStage < questions.length) {
      await ctx.db.patch(attempt._id, { stage: nextStage, questionShownAt: undefined });
      return { isCorrect: graded.isCorrect, finished: false };
    }

    const answers = await ctx.db
      .query("answers")
      .withIndex("by_attempt", (q) => q.eq("attemptId", attempt._id))
      .collect();
    const result = gradeEvaluation(
      questions.map((q) => ({ questionId: q._id, correctOption: q.correctOption, points: q.points })),
      answers.map((a) => ({ questionId: a.questionId, chosenOption: a.chosenOption, shownAt: a.shownAt, answeredAt: a.answeredAt })),
      attempt.startedAt,
      now,
    );
    await ctx.db.patch(attempt._id, {
      stage: nextStage,
      questionShownAt: undefined,
      finishedAt: now,
      score: result.score,
      maxScore: result.maxScore,
      percent: result.percent,
      totalMs: result.totalMs,
      totalRuns: answers.reduce((sum, a) => sum + a.runs, 0),
    });
    await countFinishedAttempt(ctx, now, attempt.studentId);
    return { isCorrect: graded.isCorrect, finished: true };
  },
});

export const result = query({
  args: { token: v.string(), attemptId: v.id("attempts") },
  handler: async (ctx, { token, attemptId }) => {
    const { attempt } = await requireOwnAttempt(ctx, token, attemptId);
    if (attempt.finishedAt === undefined) return null;
    const answers = await ctx.db
      .query("answers")
      .withIndex("by_attempt", (q) => q.eq("attemptId", attempt._id))
      .collect();
    answers.sort((a, b) => a.stage - b.stage);
    return {
      evaluationId: attempt.evaluationId,
      number: attemptNumber(attempt),
      score: attempt.score ?? 0,
      maxScore: attempt.maxScore ?? 0,
      percent: attempt.percent ?? 0,
      totalMs: attempt.totalMs ?? 0,
      runs: attempt.totalRuns ?? answers.reduce((sum, a) => sum + a.runs, 0),
      answers: answers.map((a) => ({
        stage: a.stage,
        isCorrect: a.isCorrect,
        runs: a.runs,
        responseMs: a.answeredAt - a.shownAt,
      })),
    };
  },
});
