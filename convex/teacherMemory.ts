/**
 * La nota de preferencias del docente para el asistente (ver lib/teacherMemory.ts).
 * Cada función saca al docente de la sesión: nadie puede leer ni borrar la nota
 * de otro. Si Atomic Memory no está configurado responde «off»; si no responde,
 * «unavailable», y la web indica que no pudo confirmar el cambio o leerla.
 */
import { ConvexError, v } from "convex/values";
import { cleanTeacherPreference } from "../domain/teacher/preferences";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, query } from "./_generated/server";
import { requireTeacher } from "./lib/access";
import { deploymentEnv } from "./lib/env";
import { memoryConfig, MemoryUnavailable, readPreference, removePreference, type SavedPreference, savePreference } from "./lib/teacherMemory";

/** `owner` dice de quién es la respuesta: la web la descarta si ya cambió de cuenta. */
export type PreferenceResult = { readonly owner: Id<"users"> } & (
  | { readonly status: "off" }
  | { readonly status: "unavailable" }
  | { readonly status: "ok"; readonly preference: SavedPreference | null }
);

async function guarded(owner: Id<"users">, run: () => Promise<SavedPreference | null>): Promise<PreferenceResult> {
  try {
    return { owner, status: "ok", preference: await run() };
  } catch (error) {
    if (error instanceof MemoryUnavailable) return { owner, status: "unavailable" };
    throw error;
  }
}

/**
 * `owner` es el docente de la sesión: la web lo usa como llave de su estado para que
 * un cambio de cuenta no muestre la nota del docente anterior ni respuestas viejas.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const teacherId = await requireTeacher(ctx);
    return { enabled: memoryConfig(deploymentEnv()) !== null, owner: teacherId };
  },
});

export const get = action({
  args: {},
  handler: async (ctx): Promise<PreferenceResult> => {
    const teacherId = await ctx.runQuery(internal.agent.teacher, {});
    const config = memoryConfig(deploymentEnv());
    if (!config) return { owner: teacherId, status: "off" };
    return guarded(teacherId, () => readPreference(config, teacherId));
  },
});

/** Guarda o corrige la nota. Solo devuelve «ok» si se leyó de vuelta. */
export const save = action({
  args: { text: v.string() },
  handler: async (ctx, { text }): Promise<PreferenceResult> => {
    const teacherId = await ctx.runQuery(internal.agent.teacher, {});
    const checked = cleanTeacherPreference(text);
    if (!checked.ok) throw new ConvexError(checked.reason);
    const config = memoryConfig(deploymentEnv());
    if (!config) return { owner: teacherId, status: "off" };
    return guarded(teacherId, () => savePreference(config, teacherId, checked.text));
  },
});

export const remove = action({
  args: {},
  handler: async (ctx): Promise<PreferenceResult> => {
    const teacherId = await ctx.runQuery(internal.agent.teacher, {});
    const config = memoryConfig(deploymentEnv());
    if (!config) return { owner: teacherId, status: "off" };
    return guarded(teacherId, async () => {
      await removePreference(config, teacherId);
      return null;
    });
  },
});
