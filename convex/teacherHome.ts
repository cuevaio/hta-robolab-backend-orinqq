/**
 * Portada del docente (T2): saludo, cifras de arriba, sus clases con código y
 * las evaluaciones de hoy. Todo en una consulta para que la pantalla cargue de
 * una vez.
 */
import { catalog } from "../domain/classroom/catalog";
import { summarizeChallenge } from "../domain/classroom/challengeStats";
import { limaCalendarDate } from "../domain/evaluation/calendar";
import { query } from "./_generated/server";
import { summarize } from "./evaluations";
import { classroomLabel, requireTeacher } from "./lib/access";
import { resolveItem } from "./lib/items";
import { classPlays, studentsOf } from "./lib/classwork";

/** Cuántos retos activos muestra el inicio del docente. */
const ACTIVE_RETOS_SHOWN = 4;

export const home = query({
  args: {},
  handler: async (ctx) => {
    const teacherId = await requireTeacher(ctx);
    const user = await ctx.db.get(teacherId);
    const name = (user?.name ?? "").trim();

    const classrooms = await ctx.db
      .query("classrooms")
      .withIndex("by_teacher", (q) => q.eq("teacherId", teacherId))
      .collect();
    classrooms.sort((a, b) => a.createdAt - b.createdAt);
    const classes = await Promise.all(
      classrooms.map(async (c) => {
        const students = await ctx.db
          .query("students")
          .withIndex("by_classroom", (q) => q.eq("classroomId", c._id))
          .collect();
        return { _id: c._id, label: classroomLabel(c), joinCode: c.joinCode ?? null, studentCount: students.length, level: c.level };
      }),
    );

    const today = limaCalendarDate();
    const evaluations = await ctx.db
      .query("evaluations")
      .withIndex("by_teacher_date", (q) => q.eq("teacherId", teacherId).eq("scheduledDate", today))
      .collect();

    // Retos activos: los abiertos de sus clases (sin borradores ni cerrados), el más nuevo primero.
    const open = (
      await ctx.db
        .query("assignments")
        .withIndex("by_teacher", (q) => q.eq("teacherId", teacherId))
        .collect()
    )
      .filter((a) => a.classroomId !== undefined && a.visibility !== "draft" && a.closedAt === undefined)
      .sort((a, b) => b.createdAt - a.createdAt);
    const activeRetos = [];
    for (const a of open) {
      const item = await resolveItem(ctx, a.challengeId);
      const classroom = classrooms.find((c) => c._id === a.classroomId);
      if (!item || !classroom) continue;
      const summary = summarizeChallenge(
        (await studentsOf(ctx, classroom._id)).map((s) => ({ studentId: s._id, displayName: s.displayName })),
        await classPlays(ctx, classroom._id),
        a.challengeId,
      );
      activeRetos.push({
        assignmentId: a._id,
        challengeId: a.challengeId,
        title: item.title,
        classroomId: classroom._id,
        classroomLabel: classroomLabel(classroom),
        studentCount: summary.studentCount,
        studentsSolved: summary.studentsSolved,
        solvedPercent: summary.solvedPercent,
      });
      if (activeRetos.length === ACTIVE_RETOS_SHOWN) break;
    }

    return {
      name,
      firstName: name.split(/\s+/)[0] ?? "",
      activeClasses: classes.length,
      students: classes.reduce((sum, c) => sum + c.studentCount, 0),
      availableChallenges: catalog().length,
      classes,
      today,
      todays: await Promise.all(evaluations.map((e) => summarize(ctx, e))),
      activeRetos,
    };
  },
});
