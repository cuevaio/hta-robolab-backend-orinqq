/**
 * Datos para el gráfico de desarrollo del aprendizaje. Por cada evaluación de
 * la clase (en orden de fecha) y cada alumno se toma su mejor intento, con
 * cuatro medidas: logro, intentos de ejecutar por estrella, tiempo y veces
 * que rindió la evaluación hasta lograrlo. Si aprende, el logro sube y lo
 * demás baja.
 */
import { v } from "convex/values";
import { summarizeRetoProgress } from "../domain/classroom/retoProgress";
import { type Best, bestOf } from "../domain/evaluation/ranking";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { classroomLabel, requireOwnClassroom, requireTeacher } from "./lib/access";
import { finishedAttempts, groupByStudent } from "./lib/attempts";
import { assignmentsOf, classPlays, studentsOf } from "./lib/classwork";
import { resolveItem } from "./lib/items";

const round1 = (n: number) => Math.round(n * 10) / 10;
const average = (values: readonly number[]) =>
  values.length === 0 ? null : values.reduce((s, x) => s + x, 0) / values.length;

export const classProgress = query({
  args: { classroomId: v.id("classrooms") },
  handler: async (ctx, { classroomId }) => {
    const teacherId = await requireTeacher(ctx);
    const classroom = await requireOwnClassroom(ctx, teacherId, classroomId);
    const evaluations = await ctx.db
      .query("evaluations")
      .withIndex("by_classroom_date", (q) => q.eq("classroomId", classroomId))
      .collect();
    const students = await ctx.db
      .query("students")
      .withIndex("by_classroom", (q) => q.eq("classroomId", classroomId))
      .collect();

    const points = await Promise.all(
      evaluations.map(async (e) => {
        const questions = await ctx.db
          .query("questions")
          .withIndex("by_evaluation_order", (q) => q.eq("evaluationId", e._id))
          .collect();
        const stars = Math.max(1, questions.length);
        const attempts = await ctx.db
          .query("attempts")
          .withIndex("by_evaluation", (q) => q.eq("evaluationId", e._id))
          .collect();
        const byStudent = groupByStudent(attempts);
        const bests = new Map<string, Best>();
        for (const s of students) {
          const best = bestOf(await finishedAttempts(ctx, byStudent.get(s._id) ?? []));
          if (best) bests.set(s._id, best);
        }
        const all = [...bests.values()];
        const avg = (pick: (b: Best) => number) => {
          const value = average(all.map(pick));
          return value === null ? null : round1(value);
        };
        return {
          evaluationId: e._id,
          title: e.title,
          date: e.scheduledDate,
          stars,
          finishedCount: all.length,
          average: avg((b) => b.attempt.percent) === null ? null : Math.round(avg((b) => b.attempt.percent)!),
          averageRunsPerStar: avg((b) => b.attempt.runs / stars),
          averageMs: avg((b) => b.attempt.totalMs),
          averageTries: avg((b) => b.tries),
          bests,
        };
      }),
    );

    return {
      classroomLabel: classroomLabel(classroom),
      evaluations: points.map(({ bests: _omit, ...p }) => p),
      students: students
        .map((s) => ({
          studentId: s._id,
          displayName: s.displayName,
          series: points.map((p) => {
            const best = p.bests.get(s._id);
            return {
              evaluationId: p.evaluationId,
              percent: best?.attempt.percent ?? null,
              totalMs: best?.attempt.totalMs ?? null,
              runsPerStar: best ? round1(best.attempt.runs / p.stars) : null,
              tries: best?.tries ?? null,
            };
          }),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "es")),
    };
  },
});

/**
 * Progreso de la clase reto por reto (pestaña Progreso): una columna por reto
 * asignado, en el orden en que se asignó, y una fila por alumno con su resultado
 * en cada uno. No cuenta los borradores; los retos cerrados sí, porque ya son
 * parte de lo que la clase aprendió. `attention` solo lista lo observable
 * (retos seguidos sin lograr, retos sin empezar), sin diagnosticar.
 */
export const classRetosProgress = query({
  args: { classroomId: v.id("classrooms") },
  handler: async (ctx, { classroomId }) => {
    const teacherId = await requireTeacher(ctx);
    const classroom = await requireOwnClassroom(ctx, teacherId, classroomId);
    const students = await studentsOf(ctx, classroomId);
    const assignments = (await assignmentsOf(ctx, classroomId)).filter((a) => a.visibility !== "draft");
    const plays = await classPlays(ctx, classroomId);

    const refs = [];
    for (const a of assignments) {
      const item = await resolveItem(ctx, a.challengeId);
      if (item) refs.push({ assignmentId: a._id as string, challengeId: a.challengeId, title: item.title, createdAt: a.createdAt });
    }
    const closed = new Set(assignments.filter((a) => a.closedAt !== undefined).map((a) => a._id as string));
    const progress = summarizeRetoProgress(
      refs,
      students.map((s) => ({ studentId: s._id, displayName: s.displayName })),
      plays,
    );

    return {
      classroomLabel: classroomLabel(classroom),
      retos: progress.retos.map((r) => ({ ...r, assignmentId: r.assignmentId as Id<"assignments">, closed: closed.has(r.assignmentId) })),
      students: progress.students.map((s) => ({ ...s, studentId: s.studentId as Id<"students"> })),
      attention: progress.attention.map((a) => ({ ...a, studentId: a.studentId as Id<"students"> })),
    };
  },
});
