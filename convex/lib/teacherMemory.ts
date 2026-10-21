/**
 * Preferencias del docente en Atomic Memory (opcional). El docente escribe una
 * nota corta sobre sus clases; el asistente la recuerda al proponer misiones.
 *
 * Variables del despliegue:
 * - ATOMICMEMORY_API_KEY: clave `amc_…` de un proyecto Cloud. Sin ella, todo
 *   queda apagado y el asistente funciona igual que antes.
 * - ATOMICMEMORY_API_URL (opcional): por defecto https://api.atomicstrata.ai.
 *   Solo https, salvo 127.0.0.1/localhost para pruebas locales.
 *
 * El sujeto de memoria sale de la sesión del docente (`robolab-docente:<id>`),
 * nunca del navegador. Se usa solo `user_id`: en Cloud un `session_id` reemplaza
 * al sujeto y `namespace` solo filtra búsquedas, así que no aíslan a nadie.
 * La clave nunca sale del servidor ni aparece en errores o registros.
 */
import type { Env } from "./env";

export const MEMORY_SOURCE = "robolab-asistente";
/** Una sola nota por docente: volver a guardarla con el mismo id la reemplaza. */
export const PREFERENCE_EXTERNAL_ID = "robolab-preferencias-docente";
/** Leer al generar no puede demorar la propuesta: si tarda, se genera sin ella. */
export const RECALL_TIMEOUT_MS = 2500;
export const MANAGE_TIMEOUT_MS = 5000;
const DEFAULT_URL = "https://api.atomicstrata.ai";
const LIST_LIMIT = 10;

export type MemoryConfig = { readonly url: string; readonly apiKey: string };
export type SavedPreference = { readonly text: string; readonly savedAt: number | null };
type StoredPreference = SavedPreference & { readonly id: string };
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Atomic Memory no respondió, respondió con error o no se pudo confirmar el cambio. */
export class MemoryUnavailable extends Error {
  constructor() {
    super("Atomic Memory no está disponible.");
    this.name = "MemoryUnavailable";
  }
}

export function memoryConfig(env: Env): MemoryConfig | null {
  const apiKey = env.ATOMICMEMORY_API_KEY?.trim();
  if (!apiKey) return null;
  let url: URL;
  try {
    url = new URL(env.ATOMICMEMORY_API_URL?.trim() || DEFAULT_URL);
  } catch {
    return null;
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
  return { url: url.origin, apiKey };
}

export const teacherSubject = (teacherId: string): string => `robolab-docente:${teacherId}`;

async function call(config: MemoryConfig, path: string, init: RequestInit, timeoutMs: number, fetchImpl: Fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${config.url}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      // Una redirección podría llevar la clave a otro host: se trata como falla.
      redirect: "error",
    });
    if (!response.ok && response.status !== 404) {
      await response.body?.cancel();
      throw new MemoryUnavailable();
    }
    // El cuerpo se lee dentro del mismo plazo: un cuerpo lento tampoco demora la propuesta.
    const body = response.status === 204 || response.status === 205 ? null : await response.text();
    return new Response(body, { status: response.status });
  } catch (error) {
    if (error instanceof MemoryUnavailable) throw error;
    throw new MemoryUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new MemoryUnavailable();
  }
}

const isIdList = (value: unknown): value is string[] => Array.isArray(value) && value.every((id) => typeof id === "string" && id !== "");

/**
 * Recibo de ingest/quick: un 2xx sin ids ni «omitida» no prueba que se guardó.
 * Devuelve los ids que el proveedor dice haber creado o actualizado.
 */
export function ingestReceipt(body: unknown): { readonly ids: readonly string[]; readonly skipped: boolean } {
  if (!body || typeof body !== "object") throw new MemoryUnavailable();
  const r = body as Record<string, unknown>;
  if (!isIdList(r.stored_memory_ids) || !isIdList(r.updated_memory_ids)) throw new MemoryUnavailable();
  const ids = [...r.stored_memory_ids, ...r.updated_memory_ids];
  const skipped = typeof r.memories_skipped === "number" && r.memories_skipped > 0;
  if (ids.length === 0 && !skipped) throw new MemoryUnavailable();
  return { ids, skipped };
}

/** Borrado: 404 ya está borrado; un 2xx debe decir `success: true`. */
async function deleteReceipt(response: Response): Promise<void> {
  if (response.status === 404) {
    await response.body?.cancel();
    return;
  }
  const body = await json(response);
  if (!body || typeof body !== "object" || (body as { success?: unknown }).success !== true) throw new MemoryUnavailable();
}

function toStored(raw: unknown, subject: string): StoredPreference | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MemoryUnavailable();
  const m = raw as Record<string, unknown>;
  if (m.user_id !== undefined && typeof m.user_id !== "string") throw new MemoryUnavailable();
  if (m.user_id !== undefined && m.user_id !== subject) return null;
  // Explicitly foreign rows are excluded; malformed own rows cannot prove absence.
  if (m.source_site !== undefined && typeof m.source_site !== "string") throw new MemoryUnavailable();
  if (m.source_site !== undefined && m.source_site !== MEMORY_SOURCE) return null;
  if (typeof m.id !== "string" || m.id === "" || typeof m.content !== "string" || m.content === "") throw new MemoryUnavailable();
  const savedAt = typeof m.created_at === "string" ? Date.parse(m.created_at) : NaN;
  return { id: m.id, text: m.content, savedAt: Number.isFinite(savedAt) ? savedAt : null };
}

async function listStored(config: MemoryConfig, teacherId: string, timeoutMs: number, fetchImpl: Fetch): Promise<StoredPreference[]> {
  const params = new URLSearchParams({ user_id: teacherSubject(teacherId), source_site: MEMORY_SOURCE, limit: String(LIST_LIMIT) });
  const response = await call(config, `/v1/memories/list?${params}`, { method: "GET" }, timeoutMs, fetchImpl);
  if (response.status === 404) return [];
  const body = await json(response);
  const memories = body && typeof body === "object" ? (body as { memories?: unknown }).memories : undefined;
  if (!Array.isArray(memories)) throw new MemoryUnavailable();
  return memories.map((raw) => toStored(raw, teacherSubject(teacherId))).filter((m): m is StoredPreference => m !== null).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

const publicView = ({ text, savedAt }: StoredPreference): SavedPreference => ({ text, savedAt });

/** La nota vigente del docente, o null si no guardó ninguna. */
export async function readPreference(
  config: MemoryConfig,
  teacherId: string,
  timeoutMs: number = MANAGE_TIMEOUT_MS,
  fetchImpl: Fetch = fetch,
): Promise<SavedPreference | null> {
  const [latest] = await listStored(config, teacherId, timeoutMs, fetchImpl);
  return latest ? publicView(latest) : null;
}

async function deleteStored(config: MemoryConfig, teacherId: string, ids: readonly string[], fetchImpl: Fetch): Promise<void> {
  const user = encodeURIComponent(teacherSubject(teacherId));
  for (const id of ids) {
    await deleteReceipt(await call(config, `/v1/memories/${encodeURIComponent(id)}?user_id=${user}`, { method: "DELETE" }, MANAGE_TIMEOUT_MS, fetchImpl));
  }
}

/**
 * Guarda (o corrige) la nota tal cual, sin extracción. Solo responde «guardada»
 * después de leerla de vuelta; las versiones anteriores se borran.
 */
export async function savePreference(config: MemoryConfig, teacherId: string, text: string, fetchImpl: Fetch = fetch): Promise<SavedPreference> {
  const response = await call(
    config,
    "/v1/memories/ingest/quick",
    {
      method: "POST",
      body: JSON.stringify({
        user_id: teacherSubject(teacherId),
        conversation: text,
        source_site: MEMORY_SOURCE,
        skip_extraction: true,
        content_class: "summary",
        metadata: { externalId: PREFERENCE_EXTERNAL_ID },
      }),
    },
    MANAGE_TIMEOUT_MS,
    fetchImpl,
  );
  if (response.status === 404) throw new MemoryUnavailable();
  const receipt = ingestReceipt(await json(response));
  const stored = await listStored(config, teacherId, MANAGE_TIMEOUT_MS, fetchImpl);
  // Lo leído debe ser el registro del recibo; si el proveedor solo la omitió (ya existía igual), basta el mismo texto.
  const current = stored.find((m) => m.text === text && (receipt.ids.includes(m.id) || (receipt.ids.length === 0 && receipt.skipped)));
  if (!current) throw new MemoryUnavailable();
  await deleteStored(config, teacherId, stored.filter((m) => m.id !== current.id).map((m) => m.id), fetchImpl);
  return publicView(current);
}

/** Borra la nota del docente y comprueba que ya no está. */
export async function removePreference(config: MemoryConfig, teacherId: string, fetchImpl: Fetch = fetch): Promise<void> {
  const stored = await listStored(config, teacherId, MANAGE_TIMEOUT_MS, fetchImpl);
  await deleteStored(config, teacherId, stored.map((m) => m.id), fetchImpl);
  if ((await listStored(config, teacherId, MANAGE_TIMEOUT_MS, fetchImpl)).length > 0) throw new MemoryUnavailable();
}
