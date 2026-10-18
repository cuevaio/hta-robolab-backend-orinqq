/**
 * Retos asignados a una clase. El reto en sí vive en el dominio (catálogo);
 * aquí se guarda qué docente lo eligió, para qué clase y si los alumnos ya lo
 * ven. Los resultados salen de las partidas que el servidor verificó.
 */
import { ConvexError, v } from "convex/values";
import { catalog } from "../domain/classroom/catalog";
import { type PlayRow, type StudentRef, summarizeChallenge } from "../domain/classroom/challengeStats";
import { missionById } from "../domain/lab/mission";
import { resolveItem, resolveOwnItem, agentMissionOf } from "./lib/items";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, mutation, query } from "./_generated/server";
import { classroomLabel, requireOwnClassroom, requireTeacher } from "./lib/access";
import { assignmentsOf, classPlays, studentsOf } from "./lib/classwork";

export const visibility = v.union(v.literal("public"), v.literal("class"), v.literal("draft"));

async function requireOwnAssignment(ctx: QueryCtx, teacherId: Id<"users">, assignmentId: Id<"assignments">): Promise<Doc<"assignments">> {
  const assignment = await ctx.db.get(assignmentId);
  if (!assignment || assignment.teacherId !== teacherId) throw new ConvexError("No encontramos ese reto.");
  return assignment;
}

async function requireCatalogItem(ctx: QueryCtx, challengeId: string, teacherId?: Id<"users">) {
  const item = teacherId ? await resolveOwnItem(ctx, teacherId, challengeId) : await resolveItem(ctx, challengeId);
  if (!item) throw new ConvexError("Ese reto no existe.");
  return item;
}

async function requireNotAssigned(ctx: QueryCtx, classroomId: Id<"classrooms">, challengeId: string) {
  if ((await assignmentsOf(ctx, classroomId)).some((a) => a.challengeId === challengeId)) {
    throw new ConvexError("Ese reto ya está en la clase.");
  }
}

async function studentRefs(ctx: QueryCtx, classroomId: Id<"classrooms">) {
  return (await studentsOf(ctx, classroomId))
    .map((s) => ({ studentId: s._id, displayName: s.displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
}

/** Elige un reto del catálogo; con `classroomId` queda asignado a esa clase, sin ella queda suelto hasta `assign`. */
export const create = mutation({
  args: { challengeId: v.string(), visibility, classroomId: v.optional(v.id("classrooms")) },
  handler: async (ctx, args): Promise<Id<"assignments">> => {
    const teacherId = await requireTeacher(ctx);
    const item = await requireCatalogItem(ctx, args.challengeId, teacherId);
    if (args.classroomId) {
      await requireOwnClassroom(ctx, teacherId, args.classroomId);
      await requireNotAssigned(ctx, args.classroomId, item.challengeId);
    }
    return await ctx.db.insert("assignments", {
      ...(args.classroomId ? { classroomId: args.classroomId } : {}),
      challengeId: item.challengeId,
      visibility: args.visibility,
      teacherId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Asigna un reto ya creado a una clase (T7 "Asignar a una clase"). Si estaba
 * suelto, se queda con la clase; si ya era de otra clase, se copia para la
 * nueva. Al asignarlo deja de ser borrador: los alumnos lo ven. Devuelve el
 * reto que quedó en esa clase.
 */
export const assign = mutation({
  args: { assignmentId: v.id("assignments"), classroomId: v.id("classrooms") },
  handler: async (ctx, { assignmentId, classroomId }): Promise<Id<"assignments">> => {
    const teacherId = await requireTeacher(ctx);
    const assignment = await requireOwnAssignment(ctx, teacherId, assignmentId);
    await requireOwnClassroom(ctx, teacherId, classroomId);
    if (assignment.classroomId === classroomId) return assignmentId;
    await requireNotAssigned(ctx, classroomId, assignment.challengeId);
    const visibility = assignment.visibility === "draft" ? "class" : assignment.visibility;
    if (assignment.classroomId === undefined) {
      await ctx.db.patch(assignmentId, { classroomId, visibility });
      return assignmentId;
    }
    return await ctx.db.insert("assignments", {
      classroomId,
      challengeId: assignment.challengeId,
      visibility,
      teacherId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Ficha del reto (título, tópico, nivel, tipo, consigna, mapa) y la clase a la
 * que pertenece. En una misión de Primaria `map` es null y `mission` trae el
 * tablero 6 × 6 completo.
 */
export const get = query({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }) => {
    const teacherId = await requireTeacher(ctx);
    const assignment = await requireOwnAssignment(ctx, teacherId, assignmentId);
    const item = await requireCatalogItem(ctx, assignment.challengeId);
    const agent = await agentMissionOf(ctx, assignment.challengeId);
    const classroom = assignment.classroomId ? await ctx.db.get(assignment.classroomId) : null;
    return {
      assignmentId,
      ...item,
      mission: missionById(item.challengeId) ?? null,
      /** El tablero de una misión del asistente (formato Mission v1), para que el docente la pruebe. */
      agentMission: agent?.mission ?? null,
      visibility: assignment.visibility,
      classroomId: assignment.classroomId ?? null,
      classroomLabel: classroom ? classroomLabel(classroom) : null,
      createdAt: assignment.createdAt,
    };
  },
});

/** Los retos de una clase con cuántos alumnos los lograron (pestaña Retos, T8b). */
export const listForClassroom = query({
  args: { classroomId: v.id("classrooms") },
  handler: async (ctx, { classroomId }) => {
    const teacherId = await requireTeacher(ctx);
    await requireOwnClassroom(ctx, teacherId, classroomId);
    const students = await studentRefs(ctx, classroomId);
    const plays = await classPlays(ctx, classroomId);
    const rows = [];
    for (const a of await assignmentsOf(ctx, classroomId)) {
      const item = await resolveItem(ctx, a.challengeId);
      if (!item) continue;
      const summary = summarizeChallenge(students, plays, a.challengeId);
      rows.push({
        assignmentId: a._id,
        challengeId: a.challengeId,
        title: item.title,
        topic: item.topic,
        level: item.level,
        kind: item.kind,
        visibility: a.visibility,
        solvedPercent: summary.solvedPercent,
        studentsSolved: summary.studentsSolved,
        studentCount: summary.studentCount,
      });
    }
    return rows;
  },
});

/** Resultados del reto en su clase (T9): promedios, fila por alumno y lo observado. */
export const results = query({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }) => {
    const teacherId = await requireTeacher(ctx);
    const assignment = await requireOwnAssignment(ctx, teacherId, assignmentId);
    if (!assignment.classroomId) throw new ConvexError("Ese reto no está asignado a una clase.");
    const classroom = await requireOwnClassroom(ctx, teacherId, assignment.classroomId);
    const item = await requireCatalogItem(ctx, assignment.challengeId);
    const students = await studentRefs(ctx, classroom._id);
    const summary = summarizeChallenge(students, await classPlays(ctx, classroom._id), assignment.challengeId);
    return {
      assignmentId,
      challengeId: assignment.challengeId,
      title: item.title,
      topic: item.topic,
      topicName: item.topicName,
      level: item.level,
      kind: item.kind,
      classroomId: classroom._id,
      classroomLabel: classroomLabel(classroom),
      studentCount: summary.studentCount,
      studentsSolved: summary.studentsSolved,
      solvedPercent: summary.solvedPercent,
      avgTries: summary.avgTries,
      avgHints: summary.avgHints,
      avgMs: summary.avgMs,
      rows: summary.rows.map((r) => ({ ...r, studentId: r.studentId as Id<"students"> })),
      observed: summary.observed,
    };
  },
});

/** Todo lo que un docente puede asignar (T2 "Retos disponibles", T4). */
export const available = query({
  args: {},
  handler: async (ctx) => {
    await requireTeacher(ctx);
    return catalog().map(({ challengeId, title, topic, topicName, level, kind, kindLabel, difficulty, emoji }) => ({
      challengeId,
      title,
      topic,
      topicName,
      level,
      kind,
      kindLabel,
      difficulty,
      emoji,
    }));
  },
});

/**
 * Todos los retos del docente en una sola lista (pestaña Retos): los de todas sus
 * clases y los que aún no asignó, el más nuevo primero. Cada uno trae cuántos de
 * su clase lo lograron; si no tiene clase (o la clase no tiene alumnos) las cifras
 * son 0, no un dato inventado.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const teacherId = await requireTeacher(ctx);
    const mine = await ctx.db
      .query("assignments")
      .withIndex("by_teacher", (q) => q.eq("teacherId", teacherId))
      .collect();
    mine.sort((a, b) => b.createdAt - a.createdAt);

    type ClassFacts = { label: string; students: StudentRef[]; plays: PlayRow[] };
    const classes = new Map<Id<"classrooms">, ClassFacts | null>();
    const factsOf = async (classroomId: Id<"classrooms">): Promise<ClassFacts | null> => {
      if (!classes.has(classroomId)) {
        const classroom = await ctx.db.get(classroomId);
        classes.set(
          classroomId,
          classroom ? { label: classroomLabel(classroom), students: await studentRefs(ctx, classroomId), plays: await classPlays(ctx, classroomId) } : null,
        );
      }
      return classes.get(classroomId)!;
    };

    const rows = [];
    for (const a of mine) {
      const item = await resolveItem(ctx, a.challengeId);
      if (!item) continue;
      const facts = a.classroomId ? await factsOf(a.classroomId) : null;
      const summary = facts ? summarizeChallenge(facts.students, facts.plays, a.challengeId) : null;
      rows.push({
        assignmentId: a._id,
        challengeId: a.challengeId,
        title: item.title,
        topic: item.topic,
        topicName: item.topicName,
        level: item.level,
        kind: item.kind,
        emoji: item.emoji,
        visibility: a.visibility,
        classroomId: facts ? (a.classroomId ?? null) : null,
        classroomLabel: facts?.label ?? null,
        closed: a.closedAt !== undefined,
        studentCount: summary?.studentCount ?? 0,
        studentsSolved: summary?.studentsSolved ?? 0,
        solvedPercent: summary?.solvedPercent ?? 0,
        createdAt: a.createdAt,
      });
    }
    return rows;
  },
});

/** Cierra un reto: los alumnos dejan de verlo; sus resultados se conservan. Cerrar uno ya cerrado no hace nada. */
export const close = mutation({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }): Promise<void> => {
    const teacherId = await requireTeacher(ctx);
    const assignment = await requireOwnAssignment(ctx, teacherId, assignmentId);
    if (assignment.closedAt === undefined) await ctx.db.patch(assignmentId, { closedAt: Date.now() });
  },
});

/** Vuelve a abrir un reto cerrado. Abrir uno ya abierto no hace nada. */
export const reopen = mutation({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }): Promise<void> => {
    const teacherId = await requireTeacher(ctx);
    const assignment = await requireOwnAssignment(ctx, teacherId, assignmentId);
    if (assignment.closedAt !== undefined) await ctx.db.patch(assignmentId, { closedAt: undefined });
  },
});
