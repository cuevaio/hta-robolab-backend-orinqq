import { ConvexError, v } from "convex/values";
import { summarizeStudent } from "../domain/classroom/challengeStats";
import { parseStudentList } from "../domain/classroom/studentName";
import type { Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { classroomLabel, requireOwnClassroom, requireTeacher } from "./lib/access";
import { resolveItem } from "./lib/items";
import { classPlays, studentsOf, visibleAssignments } from "./lib/classwork";
import { removeLiveClassroom } from "./lib/liveCleanup";
import { uniqueAccessCode, uniqueJoinCode } from "./lib/codes";
import { LIMITS, cleanText } from "./lib/rules";
import { educationLevel } from "./schema";

const byName = (a: { displayName: string }, b: { displayName: string }) => a.displayName.localeCompare(b.displayName, "es");

export const create = mutation({
  args: { level: educationLevel, grade: v.string(), section: v.string() },
  // Devuelve solo el Id (otra web ya lo usa así); el código de la clase se consulta con `get` o `listMine`.
  handler: async (ctx, args): Promise<Id<"classrooms">> => {
    const teacherId = await requireTeacher(ctx);
    const grade = cleanText(args.grade, "Grado", 1, LIMITS.gradeMax);
    const section = cleanText(args.section, "Sección", 1, LIMITS.sectionMax).toUpperCase();
    const mine = await ctx.db
      .query("classrooms")
      .withIndex("by_teacher", (q) => q.eq("teacherId", teacherId))
      .collect();
    const duplicate = mine.some(
      (c) => c.level === args.level && c.grade.toLowerCase() === grade.toLowerCase() && c.section === section,
    );
    if (duplicate) throw new ConvexError("Ya tienes esa clase.");
    return await ctx.db.insert("classrooms", {
      teacherId,
      level: args.level,
      grade,
      section,
      joinCode: await uniqueJoinCode(ctx),
      createdAt: Date.now(),
    });
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const teacherId = await requireTeacher(ctx);
    const classrooms = await ctx.db
      .query("classrooms")
      .withIndex("by_teacher", (q) => q.eq("teacherId", teacherId))
      .collect();
    return await Promise.all(
      classrooms.map(async (c) => ({
        _id: c._id,
        level: c.level,
        grade: c.grade,
        section: c.section,
        label: classroomLabel(c),
        /** Null solo en clases creadas antes de los códigos, hasta que `ensureJoinCodes` les asigne uno. */
        joinCode: c.joinCode ?? null,
        studentCount: (await studentsOf(ctx, c._id)).length,
      })),
    );
  },
});

/**
 * Migración perezosa: a las clases creadas antes de los códigos se les asigna
 * uno aquí (las consultas no pueden escribir). La web lo llama cuando ve un
 * `joinCode` null. Devuelve cuántas recibieron código.
 */
export const ensureJoinCodes = mutation({
  args: {},
  handler: async (ctx): Promise<{ assigned: number }> => {
    const teacherId = await requireTeacher(ctx);
    const mine = await ctx.db
      .query("classrooms")
      .withIndex("by_teacher", (q) => q.eq("teacherId", teacherId))
      .collect();
    let assigned = 0;
    for (const c of mine) {
      if (c.joinCode) continue;
      await ctx.db.patch(c._id, { joinCode: await uniqueJoinCode(ctx) });
      assigned++;
    }
    return { assigned };
  },
});

export const get = query({
  args: { classroomId: v.id("classrooms") },
  handler: async (ctx, { classroomId }) => {
    const teacherId = await requireTeacher(ctx);
    const classroom = await requireOwnClassroom(ctx, teacherId, classroomId);
    const students = (await studentsOf(ctx, classroomId)).sort(byName);
    const assignedIds = (await visibleAssignments(ctx, classroomId)).map((a) => a.challengeId);
    const plays = await classPlays(ctx, classroomId);
    return {
      _id: classroom._id,
      level: classroom.level,
      grade: classroom.grade,
      section: classroom.section,
      label: classroomLabel(classroom),
      joinCode: classroom.joinCode ?? null,
      studentCount: students.length,
      retosTotal: assignedIds.length,
      students: await Promise.all(students.map(async (s) => {
        const progress = summarizeStudent(
          assignedIds,
          plays.filter((p) => p.studentId === s._id),
        );
        return {
          _id: s._id,
          displayName: s.displayName,
          /** Código personal: solo lo tienen los alumnos que agregó el docente; vacío en quien se unió con el código de la clase. */
          accessCode: s.accessCode ?? "",
          retosHechos: progress.retosHechos,
          retosTotal: progress.retosTotal,
          lastChallengeTitle: progress.lastChallengeId === null ? null : ((await resolveItem(ctx, progress.lastChallengeId))?.title ?? progress.lastChallengeId),
          status: progress.status,
        };
      })),
    };
  },
});

export const addStudents = mutation({
  args: { classroomId: v.id("classrooms"), names: v.array(v.string()) },
  handler: async (ctx, { classroomId, names }) => {
    const teacherId = await requireTeacher(ctx);
    await requireOwnClassroom(ctx, teacherId, classroomId);
    const existing = await studentsOf(ctx, classroomId);

    // Se valida toda la lista antes de guardar: si una línea falla, no se guarda ninguna.
    const parsed = parseStudentList(
      names.join("\n"),
      existing.map((s) => s.displayName),
    );
    const problem = parsed.entries.findIndex((e) => e.status !== "ok");
    const entry = parsed.entries[problem];
    if (entry && entry.status !== "ok") {
      throw new ConvexError(`Alumno ${problem + 1} («${entry.input}»): ${entry.reason}`);
    }
    if (parsed.names.length === 0) throw new ConvexError("Escribe al menos un nombre.");
    if (parsed.names.length > LIMITS.studentsPerBatch) {
      throw new ConvexError(`Agrega hasta ${LIMITS.studentsPerBatch} alumnos a la vez.`);
    }

    const created: { displayName: string; accessCode: string }[] = [];
    for (const displayName of parsed.names) {
      const accessCode = await uniqueAccessCode(ctx);
      await ctx.db.insert("students", { classroomId, displayName, accessCode, createdAt: Date.now() });
      created.push({ displayName, accessCode });
    }
    return created;
  },
});

async function deleteAll(ctx: MutationCtx, rows: readonly { _id: Id<"students" | "studentSessions" | "challengePlays" | "assignments" | "evaluations" | "questions" | "attempts" | "answers" | "runs"> }[]) {
  for (const row of rows) await ctx.db.delete(row._id);
}

/** Borra una evaluación con sus preguntas, intentos, respuestas y ejecuciones. */
async function removeEvaluation(ctx: MutationCtx, evaluationId: Id<"evaluations">) {
  await deleteAll(
    ctx,
    await ctx.db
      .query("questions")
      .withIndex("by_evaluation_order", (q) => q.eq("evaluationId", evaluationId))
      .collect(),
  );
  const attempts = await ctx.db
    .query("attempts")
    .withIndex("by_evaluation", (q) => q.eq("evaluationId", evaluationId))
    .collect();
  for (const attempt of attempts) {
    await deleteAll(
      ctx,
      await ctx.db
        .query("answers")
        .withIndex("by_attempt", (q) => q.eq("attemptId", attempt._id))
        .collect(),
    );
    await deleteAll(
      ctx,
      await ctx.db
        .query("runs")
        .withIndex("by_attempt_stage", (q) => q.eq("attemptId", attempt._id))
        .collect(),
    );
    await ctx.db.delete(attempt._id);
  }
  await ctx.db.delete(evaluationId);
}

/**
 * Elimina la clase y todo lo que cuelga de ella: alumnos, sesiones, partidas,
 * retos asignados, evaluaciones, preguntas, intentos, respuestas y ejecuciones.
 * Las cuentas del panel de impacto no se tocan: son cifras ya agregadas.
 */
export const remove = mutation({
  args: { classroomId: v.id("classrooms") },
  handler: async (ctx, { classroomId }) => {
    const teacherId = await requireTeacher(ctx);
    await requireOwnClassroom(ctx, teacherId, classroomId);

    await removeLiveClassroom(ctx, classroomId);
    for (const student of await studentsOf(ctx, classroomId)) {
      await deleteAll(
        ctx,
        await ctx.db
          .query("studentSessions")
          .withIndex("by_student", (q) => q.eq("studentId", student._id))
          .collect(),
      );
      await ctx.db.delete(student._id);
    }
    await deleteAll(
      ctx,
      await ctx.db
        .query("challengePlays")
        .withIndex("by_classroom_challenge", (q) => q.eq("classroomId", classroomId))
        .collect(),
    );
    await deleteAll(
      ctx,
      await ctx.db
        .query("assignments")
        .withIndex("by_classroom", (q) => q.eq("classroomId", classroomId))
        .collect(),
    );
    const evaluations = await ctx.db
      .query("evaluations")
      .withIndex("by_classroom_date", (q) => q.eq("classroomId", classroomId))
      .collect();
    for (const evaluation of evaluations) await removeEvaluation(ctx, evaluation._id);
    await ctx.db.delete(classroomId);
  },
});
