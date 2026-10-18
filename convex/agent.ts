/**
 * Asistente para proponer misiones (Gemini o Anthropic). El docente describe el aprendizaje;
 * el servidor le pide propuestas al modelo, las valida y las resuelve (nada llega
 * sin pasar por `validate_mission`), y solo se ofrecen las que pasan. Guardar vuelve
 * a validar. El navegador nunca ve la clave ni habla con el proveedor.
 *
 * Variables del despliegue: GEMINI_API_KEY o ANTHROPIC_API_KEY (sin ninguna el
 * asistente queda «no activado»), y opcionales AGENT_PROVIDER, GEMINI_MODEL y
 * ANTHROPIC_MODEL (ver generation/providers/select.ts).
 */
import { ConvexError, v } from "convex/values";
import { ContractError } from "../domain/mission/validation";
import { parseCustomMission } from "../domain/mission/custom";
import type { Mission } from "../domain/mission/contracts";
import { type GenerationErrorCode } from "../generation/contracts";
import { generateActivity } from "../generation/orchestrator";
import { chooseProvider } from "../generation/providers/select";
import { parseActivityRequest } from "../generation/request";
import { evaluate_difficulty, validate_mission } from "../generation/tools";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireTeacher } from "./lib/access";
import { deploymentEnv } from "./lib/env";

/** Cada petición puede costar hasta 9 llamadas al modelo (3 grados × 3 intentos): se acota por docente. */
export const AGENT_MAX_PER_HOUR = 5;
export const AGENT_MAX_PER_DAY = 20;
/** Misiones guardadas por docente: evita que la tabla crezca sin tope. */
export const MAX_SAVED_MISSIONS = 100;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireTeacher(ctx);
    return { configured: chooseProvider(deploymentEnv()) !== null };
  },
});

export const teacher = internalQuery({
  args: {},
  handler: async (ctx) => requireTeacher(ctx),
});

/** Apunta una petición y corta si el docente ya hizo demasiadas. Solo el servidor la llama. */
export const reserve = internalMutation({
  args: { teacherId: v.id("users") },
  handler: async (ctx, { teacherId }) => {
    const now = Date.now();
    const recent = await ctx.db
      .query("agentUsage")
      .withIndex("by_teacher_time", (q) => q.eq("teacherId", teacherId).gt("createdAt", now - DAY_MS))
      .collect();
    if (recent.length >= AGENT_MAX_PER_DAY) throw new ConvexError("Llegaste al límite de solicitudes de hoy. Mañana puedes seguir.");
    if (recent.filter((u) => u.createdAt > now - HOUR_MS).length >= AGENT_MAX_PER_HOUR) {
      throw new ConvexError("Hiciste muchas solicitudes seguidas. Espera un rato e inténtalo de nuevo.");
    }
    await ctx.db.insert("agentUsage", { teacherId, createdAt: now });
    return null;
  },
});

export type Proposal = {
  readonly grade: 2 | 3 | 4;
  readonly mission: Mission;
  readonly metrics: ReturnType<typeof evaluate_difficulty>;
};
export type GenerateResult =
  | { readonly status: "not_configured" }
  | {
      readonly status: "ok";
      readonly proposals: readonly Proposal[];
      /** Grados que no lograron una misión verificada; el código dice por qué (no hay texto del proveedor). */
      readonly failed: readonly { readonly grade: 2 | 3 | 4; readonly code: GenerationErrorCode }[];
    };

export const generate = action({
  args: {
    objective: v.string(),
    grades: v.array(v.number()),
    difficulty: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<GenerateResult> => {
    const teacherId = await ctx.runQuery(internal.agent.teacher, {});
    const provider = chooseProvider(deploymentEnv());
    if (!provider) return { status: "not_configured" };
    // La solicitud se revisa antes de apuntarla: un texto inválido no gasta intentos ni llama al proveedor.
    let request;
    try {
      request = parseActivityRequest({ objective: args.objective, grades: args.grades, difficulty: args.difficulty });
    } catch (error) {
      if (error instanceof ContractError) throw new ConvexError(error.issues[0]?.message ?? "La solicitud no es válida.");
      throw error;
    }
    await ctx.runMutation(internal.agent.reserve, { teacherId });
    const results = await generateActivity(request, provider);
    // Solo metadatos (nunca el objetivo ni la propuesta): sirven para ver costo y fallos en los logs.
    console.log(JSON.stringify({ agent: "generate", events: results.flatMap((r) => r.events) }));
    return {
      status: "ok",
      // Una plantilla de respaldo no es una propuesta del asistente: no se ofrece.
      proposals: results.filter((r) => r.origin === "ai_generated").map((r) => ({ grade: r.mission.grade, mission: r.mission, metrics: r.metrics })),
      failed: results
        .filter((r) => r.origin !== "ai_generated")
        .map((r) => ({ grade: r.mission.grade, code: r.errorCode ?? ("PROVIDER_UNAVAILABLE" as const) })),
    };
  },
});

/** Guarda como borrador una misión que el docente eligió. Vuelve a validar: el navegador no es de fiar. */
export const save = mutation({
  args: { mission: v.any() },
  handler: async (ctx, { mission: input }) => {
    const teacherId = await requireTeacher(ctx);
    let mission: Mission;
    try {
      mission = parseCustomMission(input);
    } catch (error) {
      if (error instanceof ContractError) throw new ConvexError(error.issues[0]?.message ?? "La misión no es válida.");
      throw new ConvexError("La misión no es válida.");
    }
    const checked = validate_mission(mission);
    if (!checked.ok) throw new ConvexError(checked.issues[0]?.message ?? "La misión no se puede resolver.");
    const mine = await ctx.db.query("agentMissions").withIndex("by_teacher", (q) => q.eq("teacherId", teacherId)).collect();
    if (mine.length >= MAX_SAVED_MISSIONS) throw new ConvexError("Ya guardaste muchas misiones. Borra algunas para seguir.");
    return ctx.db.insert("agentMissions", {
      teacherId,
      grade: mission.grade,
      title: mission.title,
      objective: mission.objective,
      mission,
      metrics: evaluate_difficulty(mission),
      createdAt: Date.now(),
    });
  },
});

/** Una misión guardada del docente (para probarla); la de otro docente no existe. */
export const get = query({
  args: { id: v.id("agentMissions") },
  handler: async (ctx, { id }) => {
    const teacherId = await requireTeacher(ctx);
    const doc = await ctx.db.get(id);
    return doc && doc.teacherId === teacherId ? doc : null;
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const teacherId = await requireTeacher(ctx);
    const rows = await ctx.db.query("agentMissions").withIndex("by_teacher", (q) => q.eq("teacherId", teacherId)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});
