/**
 * La ficha de un reto por su id, sea del catálogo del dominio o una misión que el
 * docente guardó con el asistente (`ia:<id>`). Sin ficha, el reto no existe.
 */
import { type CatalogItem, catalogItem } from "../../domain/classroom/catalog";
import { agentCatalogItem, agentIdOf } from "../../domain/classroom/agentItem";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** La misión guardada detrás de un id `ia:…`, o null si no es de una o ya no existe. */
export async function agentMissionOf(ctx: QueryCtx, challengeId: string): Promise<Doc<"agentMissions"> | null> {
  const raw = agentIdOf(challengeId);
  if (raw === null) return null;
  const id = ctx.db.normalizeId("agentMissions", raw);
  return id ? await ctx.db.get(id) : null;
}

export async function resolveItem(ctx: QueryCtx, challengeId: string): Promise<CatalogItem | undefined> {
  if (agentIdOf(challengeId) === null) return catalogItem(challengeId);
  const doc = await agentMissionOf(ctx, challengeId);
  return doc ? agentCatalogItem(challengeId, { title: doc.title, objective: doc.objective, grade: doc.grade as 2 | 3 | 4 }) : undefined;
}

/** Como `resolveItem`, pero para el docente: una misión del asistente solo cuenta si es suya. */
export async function resolveOwnItem(ctx: QueryCtx, teacherId: Id<"users">, challengeId: string): Promise<CatalogItem | undefined> {
  const doc = await agentMissionOf(ctx, challengeId);
  if (agentIdOf(challengeId) !== null && doc?.teacherId !== teacherId) return undefined;
  return resolveItem(ctx, challengeId);
}
