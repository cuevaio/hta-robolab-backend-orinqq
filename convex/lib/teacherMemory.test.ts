import { describe, expect, it, vi } from "vitest";
import {
  ingestReceipt,
  MEMORY_SOURCE,
  memoryConfig,
  MemoryUnavailable,
  readPreference,
  removePreference,
  savePreference,
  teacherSubject,
} from "./teacherMemory";

const CONFIG = { url: "https://api.atomicstrata.ai", apiKey: "amc_ficticia" };
const TEXT = "Mis grupos prefieren historias de animales y tableros pequeños.";
const SUBJECT = teacherSubject("docente1");

type Row = { user_id?: string; id: string; content: string; created_at: string; source_site: string };

/** Atomic Memory de mentira: guarda filas por sujeto y permite romper cada respuesta. */
function fakeMemory(overrides: { ingest?: () => Response; remove?: () => Response; list?: () => Response } = {}) {
  const rows: Row[] = [];
  let next = 1;
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    if (u.pathname === "/v1/memories/ingest/quick") {
      if (overrides.ingest) return overrides.ingest();
      const body = JSON.parse(String(init.body)) as { user_id: string; conversation: string };
      expect(body.user_id).toBe(SUBJECT);
      const id = `00000000-0000-4000-8000-00000000000${next++}`;
      rows.push({ id, content: body.conversation, created_at: new Date(Date.UTC(2026, 9, next)).toISOString(), source_site: MEMORY_SOURCE });
      return Response.json({ episode_id: "e", facts_extracted: 0, memories_stored: 1, memories_updated: 0, memories_deleted: 0, memories_skipped: 0, stored_memory_ids: [id], updated_memory_ids: [], links_created: 0, composites_created: 0 });
    }
    if (u.pathname === "/v1/memories/list") {
      if (overrides.list) return overrides.list();
      expect(u.searchParams.get("user_id")).toBe(SUBJECT);
      return Response.json({ memories: rows, count: rows.length });
    }
    if (init.method === "DELETE") {
      if (overrides.remove) return overrides.remove();
      const id = decodeURIComponent(u.pathname.split("/").pop()!);
      const at = rows.findIndex((r) => r.id === id);
      if (at < 0) return Response.json({ error: "not found" }, { status: 404 });
      rows.splice(at, 1);
      return Response.json({ success: true });
    }
    throw new Error(`ruta inesperada ${u.pathname}`);
  });
  return { rows, fetchImpl };
}

describe("configuración de Atomic Memory", () => {
  it("sin clave está apagado; solo https o localhost", () => {
    expect(memoryConfig({})).toBeNull();
    for (const url of ["https://user:secret@example.com", "https://example.com/path", "https://example.com?key=value", "https://example.com#fragment"]) {
      expect(memoryConfig({ ATOMICMEMORY_API_KEY: "amc_x", ATOMICMEMORY_API_URL: url })).toBeNull();
    }
    expect(memoryConfig({ ATOMICMEMORY_API_KEY: "amc_x" })).toEqual({ url: "https://api.atomicstrata.ai", apiKey: "amc_x" });
    expect(memoryConfig({ ATOMICMEMORY_API_KEY: "amc_x", ATOMICMEMORY_API_URL: "http://otro.host" })).toBeNull();
    expect(memoryConfig({ ATOMICMEMORY_API_KEY: "amc_x", ATOMICMEMORY_API_URL: "http://127.0.0.1:17350" })).toMatchObject({ url: "http://127.0.0.1:17350" });
  });
});

describe("nota de preferencias del docente", () => {
  it("guarda, lee de vuelta y reemplaza la versión anterior", async () => {
    const memory = fakeMemory();
    await savePreference(CONFIG, "docente1", "Primera nota del docente", memory.fetchImpl);
    const saved = await savePreference(CONFIG, "docente1", TEXT, memory.fetchImpl);
    expect(saved.text).toBe(TEXT);
    expect(memory.rows.map((r) => r.content)).toEqual([TEXT]);
    expect(await readPreference(CONFIG, "docente1", 1000, memory.fetchImpl)).toMatchObject({ text: TEXT });
  });

  it("la clave va solo en Authorization y nunca se siguen redirecciones", async () => {
    const memory = fakeMemory();
    await savePreference(CONFIG, "docente1", TEXT, memory.fetchImpl);
    for (const [url, init] of memory.fetchImpl.mock.calls) {
      expect(url).not.toContain("amc_ficticia");
      expect(init.redirect).toBe("error");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer amc_ficticia");
    }
  });

  it("un 2xx sin recibo útil no cuenta como guardado", async () => {
    for (const body of [{}, { stored_memory_ids: [], updated_memory_ids: [] }, { stored_memory_ids: [1], updated_memory_ids: [] }]) {
      const memory = fakeMemory({ ingest: () => Response.json(body) });
      await expect(savePreference(CONFIG, "docente1", TEXT, memory.fetchImpl)).rejects.toBeInstanceOf(MemoryUnavailable);
    }
    const notJson = fakeMemory({ ingest: () => new Response("ok") });
    await expect(savePreference(CONFIG, "docente1", TEXT, notJson.fetchImpl)).rejects.toBeInstanceOf(MemoryUnavailable);
  });

  it("si el id del recibo no aparece al leer de vuelta, no está guardada", async () => {
    const memory = fakeMemory({
      ingest: () => Response.json({ stored_memory_ids: ["00000000-0000-4000-8000-0000000000ff"], updated_memory_ids: [], memories_skipped: 0 }),
    });
    memory.rows.push({ id: "otro", content: TEXT, created_at: "2026-10-01T00:00:00Z", source_site: MEMORY_SOURCE });
    await expect(savePreference(CONFIG, "docente1", TEXT, memory.fetchImpl)).rejects.toBeInstanceOf(MemoryUnavailable);
  });

  it("acepta una nota omitida por repetida si se lee igual", () => {
    expect(ingestReceipt({ stored_memory_ids: [], updated_memory_ids: [], memories_skipped: 1 })).toEqual({ ids: [], skipped: true });
  });

  it("olvidar exige success:true; 404 ya está olvidada", async () => {
    const memory = fakeMemory();
    await savePreference(CONFIG, "docente1", TEXT, memory.fetchImpl);
    const malformed = fakeMemory({ remove: () => Response.json({}) });
    malformed.rows.push(...memory.rows);
    await expect(removePreference(CONFIG, "docente1", malformed.fetchImpl)).rejects.toBeInstanceOf(MemoryUnavailable);

    // Otra pestaña la borró entre la lista y el borrado: el 404 no es un error.
    const gone = fakeMemory({
      remove: () => {
        gone.rows.splice(0);
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    gone.rows.push({ id: "b", content: TEXT, created_at: "2026-10-01T00:00:00Z", source_site: MEMORY_SOURCE });
    await expect(removePreference(CONFIG, "docente1", gone.fetchImpl)).resolves.toBeUndefined();

    await removePreference(CONFIG, "docente1", memory.fetchImpl);
    expect(memory.rows).toEqual([]);
  });

  it("olvidar no confía en el borrado si la nota sigue en la lista", async () => {
    const memory = fakeMemory({ remove: () => Response.json({ success: true }) });
    memory.rows.push({ id: "a", content: TEXT, created_at: "2026-10-01T00:00:00Z", source_site: MEMORY_SOURCE });
    await expect(removePreference(CONFIG, "docente1", memory.fetchImpl)).rejects.toBeInstanceOf(MemoryUnavailable);
  });

  it("errores, redirecciones y listas malformadas son «no disponible», sin filtrar la clave", async () => {
    const failing = [
      () => new Response("caído amc_ficticia", { status: 500 }),
      () => Response.json({ nada: true }),
      () => {
        throw new TypeError("redirect");
      },
    ];
    for (const list of failing) {
      const memory = fakeMemory({ list });
      const error = await readPreference(CONFIG, "docente1", 1000, memory.fetchImpl).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MemoryUnavailable);
      expect(String((error as Error).message)).not.toContain("amc_");
    }
  });

  it("una fila propia malformada no confirma que la memoria esté vacía", async () => {
    for (const row of [null, {}, { id: "own", content: TEXT, source_site: null }, { id: "own", content: TEXT, user_id: 12 }, { user_id: SUBJECT, id: "own", content: 12, source_site: MEMORY_SOURCE }]) {
      const memory = fakeMemory({ list: () => Response.json({ memories: [row] }) });
      await expect(removePreference(CONFIG, "docente1", memory.fetchImpl)).rejects.toBeInstanceOf(MemoryUnavailable);
      expect(memory.fetchImpl.mock.calls.some(([, init]) => init.method === "DELETE")).toBe(false);
    }
  });

  it("descarta filas de otro docente aunque el proveedor ignore el filtro", async () => {
    const memory = fakeMemory();
    memory.rows.push({ user_id: teacherSubject("otro-docente"), id: "other", content: "nota privada", created_at: "2026-10-01T00:00:00Z", source_site: MEMORY_SOURCE });
    expect(await readPreference(CONFIG, "docente1", 1000, memory.fetchImpl)).toBeNull();
    await removePreference(CONFIG, "docente1", memory.fetchImpl);
    expect(memory.rows).toHaveLength(1);
    expect(memory.fetchImpl.mock.calls.some(([, init]) => init.method === "DELETE")).toBe(false);
  });

  it("descarta filas de otra fuente", async () => {
    const memory = fakeMemory();
    memory.rows.push({ id: "x", content: "nota ajena", created_at: "2026-10-01T00:00:00Z", source_site: "otra-app" });
    expect(await readPreference(CONFIG, "docente1", 1000, memory.fetchImpl)).toBeNull();
  });
});
