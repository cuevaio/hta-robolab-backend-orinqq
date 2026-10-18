/**
 * Relé del robot por wifi (contrato robot-protocol.md, sección 5).
 *
 * Una página HTTPS no puede hablarle a un aparato de la red local por HTTP,
 * así que el programa pasa por aquí: la web lo deja y el robot (ESP32) lo
 * recoge cada medio segundo con su clave; luego responde OK / RUN / DONE /
 * ERR:<código> y la web ve el estado.
 *
 *   Web ──enviar(código, secuencia, id)──▶ Convex ◀──GET /robot/siguiente── ESP32
 *   Web ◀──estado (OK/RUN/DONE/ERR)─────── Convex ◀──POST /robot/estado──── ESP32
 *
 * - Emparejamiento: código de 6 caracteres que vence a las 12 h; el robot
 *   consulta el vigente en GET /robot/codigo (y lo muestra).
 * - Autorización: solo quien conoce el código vigente puede enviar.
 * - Un programa a la vez: si hay uno en curso responde BUSY.
 * - Idempotencia: el mismo id de envío nunca se ejecuta dos veces.
 *
 * Registrar un robot (una vez, desde la consola del equipo):
 *   npx convex run robot:register '{"name":"Robi"}'
 * Devuelve el código (para la web) y la clave (solo para el firmware).
 */
import { ConvexError, v } from "convex/values";
import { generateAccessCode, generateSessionToken } from "../domain/evaluation/accessCode";
import { ProgramError } from "../domain/game/program";
import { isValidRobotCode, normalizeRobotCode, parseRobotReply, toRobotText, validateSequence } from "../domain/robot/protocol";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const PAIRING_TTL_MS = 12 * 60 * 60 * 1000;
/** Un programa en curso sin noticias del robot en este tiempo ya no bloquea (robot apagado). */
export const STALE_MS = 30_000;
/** Cada cuánto se anota que el robot sigue conectado (evita escribir en cada consulta). */
const SEEN_EVERY_MS = 3_000;
const ONLINE_MS = 10_000;

const ACTIVE = new Set(["pending", "sent", "received", "running"]);

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Búsquedas ----------

async function robotByCode(ctx: QueryCtx, raw: string): Promise<Doc<"robots"> | null> {
  const code = normalizeRobotCode(raw);
  if (!isValidRobotCode(code)) return null;
  return await ctx.db
    .query("robots")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
}

const codeExpired = (robot: Doc<"robots">, now: number) => (robot.codeExpiresAt ?? 0) <= now;

/** El robot que conoce el código vigente; si venció, lo dice. */
async function pairedRobot(ctx: QueryCtx, raw: string, now: number) {
  const robot = await robotByCode(ctx, raw);
  if (!robot) return { error: "NO_ROBOT" as const };
  if (codeExpired(robot, now)) return { error: "CODE_EXPIRED" as const };
  return { robot };
}

async function latestCommand(ctx: QueryCtx, robotId: Id<"robots">) {
  return await ctx.db
    .query("robotCommands")
    .withIndex("by_robot", (q) => q.eq("robotId", robotId))
    .order("desc")
    .first();
}

async function newCode(ctx: QueryCtx): Promise<string> {
  let code = generateAccessCode();
  while (await robotByCode(ctx, code)) code = generateAccessCode();
  return code;
}

// ---------- Cola de programas ----------

type Enqueued =
  | { readonly result: "queued" | "duplicate"; readonly command: Doc<"robotCommands"> }
  | { readonly result: "busy" };

async function enqueue(ctx: MutationCtx, robot: Doc<"robots">, letters: string, requestId: string | undefined, now: number): Promise<Enqueued> {
  if (requestId) {
    const same = await ctx.db
      .query("robotCommands")
      .withIndex("by_robot_request", (q) => q.eq("robotId", robot._id).eq("requestId", requestId))
      .first();
    if (same) return { result: "duplicate", command: same };
  }
  const last = await latestCommand(ctx, robot._id);
  if (last && ACTIVE.has(last.status) && now - (last.updatedAt ?? last.createdAt) < STALE_MS) return { result: "busy" };
  if (last && ACTIVE.has(last.status)) await ctx.db.patch(last._id, { status: "expired", updatedAt: now });
  const id = await ctx.db.insert("robotCommands", {
    robotId: robot._id,
    letters,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    ...(requestId ? { requestId } : {}),
  });
  return { result: "queued", command: (await ctx.db.get(id))! };
}

const ERROR_TEXT = {
  NO_ROBOT: "No encontramos ese robot. Revisa el código que muestra el robot.",
  CODE_EXPIRED: "El código del robot cambió. Pide el nuevo código que muestra el robot.",
  BUSY: "El robot está haciendo otro programa. Espera a que termine.",
} as const;

// ---------- Para el equipo (consola) ----------

export const register = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const key = generateSessionToken().slice(0, 32);
    const code = await newCode(ctx);
    const now = Date.now();
    await ctx.db.insert("robots", {
      name: name.trim() || "Robot",
      code,
      codeExpiresAt: now + PAIRING_TTL_MS,
      keyHash: await sha256(key),
      createdAt: now,
    });
    return { code, key };
  },
});

/**
 * Código vigente de cada robot, para dictárselo a quien usa la web:
 *   npx convex run robot:list
 * Nunca muestra la clave. Si un código venció, el robot recibe uno nuevo la
 * próxima vez que consulte /robot/codigo (al encender o cada 10 minutos).
 */
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const robots = await ctx.db.query("robots").collect();
    return robots.map((r) => {
      const left = Math.max(0, (r.codeExpiresAt ?? 0) - now);
      return {
        name: r.name,
        code: r.code,
        vigente: left > 0,
        venceEn: `${Math.floor(left / 3_600_000)} h ${Math.floor((left % 3_600_000) / 60_000)} min`,
        conectado: r.lastSeenAt !== undefined && now - r.lastSeenAt < ONLINE_MS,
      };
    });
  },
});

// ---------- Para nuestra web (funciones de Convex) ----------

/** La app envía un programa de bloques. Mismas reglas que la ruta HTTP para otras webs. */
export const send = mutation({
  args: { code: v.string(), program: v.any(), requestId: v.optional(v.string()) },
  handler: async (ctx, { code, program, requestId }) => {
    const now = Date.now();
    const paired = await pairedRobot(ctx, code, now);
    if (paired.error) throw new ConvexError(ERROR_TEXT[paired.error]);
    let letters: string;
    try {
      letters = toRobotText(program);
    } catch (error) {
      if (error instanceof ProgramError) throw new ConvexError(error.message);
      throw error;
    }
    const queued = await enqueue(ctx, paired.robot, letters, requestId?.slice(0, 64), now);
    if (queued.result === "busy") throw new ConvexError(ERROR_TEXT.BUSY);
    return { letters: queued.command.letters, robotName: paired.robot.name, duplicate: queued.result === "duplicate" };
  },
});

/** Estado para la app: conexión, vencimiento del código y el último programa. */
export const status = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const robot = await robotByCode(ctx, code);
    if (!robot) return null;
    const last = await latestCommand(ctx, robot._id);
    return {
      name: robot.name,
      lastSeenAt: robot.lastSeenAt ?? null,
      codeExpiresAt: robot.codeExpiresAt ?? 0,
      lastCommand: last ? { letters: last.letters, status: last.status, error: last.error ?? null, createdAt: last.createdAt } : null,
    };
  },
});

// ---------- Para el robot (rutas HTTP, autenticadas con su clave) ----------

/** Cambia el nombre que la web muestra de un robot (la clave y el código no cambian). */
export const rename = internalMutation({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const name = to.trim();
    if (!name) throw new Error("El nuevo nombre no puede estar vacío.");
    const robots = (await ctx.db.query("robots").collect()).filter((r) => r.name === from.trim());
    for (const robot of robots) await ctx.db.patch(robot._id, { name });
    return { renamed: robots.length };
  },
});

export const takeNext = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const robot = await findByKey(ctx, key);
    if (!robot) return { ok: false as const };
    const now = Date.now();
    if (!robot.lastSeenAt || now - robot.lastSeenAt > SEEN_EVERY_MS) await ctx.db.patch(robot._id, { lastSeenAt: now });
    const next = await ctx.db
      .query("robotCommands")
      .withIndex("by_robot_status", (q) => q.eq("robotId", robot._id).eq("status", "pending"))
      .first();
    if (!next) return { ok: true as const, letters: null, id: null };
    await ctx.db.patch(next._id, { status: "sent", sentAt: now, updatedAt: now });
    return { ok: true as const, letters: next.letters, id: next._id };
  },
});

export const report = internalMutation({
  args: { key: v.string(), reply: v.string() },
  handler: async (ctx, { key, reply }) => {
    const robot = await findByKey(ctx, key);
    if (!robot) return { ok: false as const, reason: "unauthorized" as const };
    const parsed = parseRobotReply(reply);
    if (!parsed) return { ok: false as const, reason: "bad_reply" as const };
    const last = await latestCommand(ctx, robot._id);
    const now = Date.now();
    await ctx.db.patch(robot._id, { lastSeenAt: now });
    if (!last || !ACTIVE.has(last.status)) return { ok: true as const };
    const status = { OK: "received", RUN: "running", DONE: "done", ERR: "failed" } as const;
    await ctx.db.patch(last._id, {
      status: status[parsed.kind],
      updatedAt: now,
      ...(parsed.kind === "ERR" ? { error: parsed.code } : {}),
    });
    return { ok: true as const };
  },
});

/** El robot pregunta su código vigente (y lo muestra). Si venció, se crea uno nuevo. */
export const currentCode = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const robot = await findByKey(ctx, key);
    if (!robot) return { ok: false as const };
    const now = Date.now();
    if (!codeExpired(robot, now)) return { ok: true as const, code: robot.code, expiresAt: robot.codeExpiresAt! };
    const code = await newCode(ctx);
    const expiresAt = now + PAIRING_TTL_MS;
    await ctx.db.patch(robot._id, { code, codeExpiresAt: expiresAt, lastSeenAt: now });
    return { ok: true as const, code, expiresAt };
  },
});

// ---------- Para otras webs (rutas HTTP con CORS) ----------

/** Nombres del contrato para cada estado. */
const WEB_STATE: Record<Doc<"robotCommands">["status"], string> = {
  pending: "EN_COLA",
  sent: "ENTREGADO",
  received: "OK",
  running: "RUN",
  done: "DONE",
  failed: "ERR",
  replaced: "REEMPLAZADO",
  expired: "VENCIDO",
};

const webState = (command: Doc<"robotCommands">) =>
  command.status === "failed" ? `ERR:${command.error ?? "MOTOR"}` : WEB_STATE[command.status];

export const webSend = internalMutation({
  args: { code: v.string(), sequence: v.string(), requestId: v.optional(v.string()) },
  handler: async (ctx, { code, sequence, requestId }) => {
    const check = validateSequence(sequence);
    if (!check.ok) return { status: 400, estado: `ERR:${check.error}` };
    const now = Date.now();
    const paired = await pairedRobot(ctx, code, now);
    if (paired.error) return { status: paired.error === "NO_ROBOT" ? 404 : 403, estado: `ERR:${paired.error}` };
    const queued = await enqueue(ctx, paired.robot, sequence, requestId?.slice(0, 64), now);
    if (queued.result === "busy") return { status: 409, estado: "ERR:BUSY" };
    return { status: 200, estado: webState(queued.command), id: queued.command.requestId ?? queued.command._id };
  },
});

export const webStatus = internalQuery({
  args: { code: v.string(), requestId: v.optional(v.string()) },
  handler: async (ctx, { code, requestId }) => {
    const now = Date.now();
    const paired = await pairedRobot(ctx, code, now);
    if (paired.error) return { status: paired.error === "NO_ROBOT" ? 404 : 403, estado: `ERR:${paired.error}` };
    const robot = paired.robot;
    const command = requestId
      ? await ctx.db
          .query("robotCommands")
          .withIndex("by_robot_request", (q) => q.eq("robotId", robot._id).eq("requestId", requestId))
          .first()
      : await latestCommand(ctx, robot._id);
    return {
      status: 200,
      robot: robot.name,
      conectado: robot.lastSeenAt !== undefined && now - robot.lastSeenAt < ONLINE_MS,
      estado: command ? webState(command) : null,
      secuencia: command?.letters ?? null,
    };
  },
});

async function findByKey(ctx: QueryCtx, key: string): Promise<Doc<"robots"> | null> {
  if (!/^[0-9a-f]{32}$/.test(key)) return null;
  const keyHash = await sha256(key);
  return await ctx.db
    .query("robots")
    .withIndex("by_key_hash", (q) => q.eq("keyHash", keyHash))
    .unique();
}
