import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { missionFixtures } from "../domain/mission/fixtures";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const NOTA = "Mis grupos prefieren historias de animales y tableros pequeños.";
const OBJETIVO = "Comparar sumas de costos y elegir un recorrido con presupuesto limitado.";
const toolReply = () =>
  Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "propose_mission", input: missionFixtures.find((m) => m.grade === 2)! }] });

type Row = { id: string; user_id: string; content: string; created_at: string; source_site: string };
let rows: Row[];
let memoryDown: boolean;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

/** Atomic Memory de mentira por sujeto, más Anthropic para generar. */
async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname === "api.anthropic.com") return toolReply();
  if (memoryDown) return new Response("caído", { status: 503 });
  if (url.pathname === "/v1/memories/ingest/quick") {
    const body = JSON.parse(String(init!.body)) as { user_id: string; conversation: string; source_site: string };
    const id = `id-${rows.length + 1}-${body.user_id}`;
    rows.push({ id, user_id: body.user_id, content: body.conversation, created_at: new Date().toISOString(), source_site: body.source_site });
    return Response.json({ stored_memory_ids: [id], updated_memory_ids: [], memories_skipped: 0 });
  }
  if (url.pathname === "/v1/memories/list") {
    const user = url.searchParams.get("user_id");
    return Response.json({ memories: rows.filter((r) => r.user_id === user) });
  }
  if (init?.method === "DELETE") {
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    const user = url.searchParams.get("user_id");
    const before = rows.length;
    rows = rows.filter((r) => !(r.id === id && r.user_id === user));
    return rows.length < before ? Response.json({ success: true }) : Response.json({ error: "not found" }, { status: 404 });
  }
  throw new Error(`ruta inesperada ${url}`);
}

beforeEach(() => {
  rows = [];
  memoryDown = false;
  vi.stubEnv("ANTHROPIC_API_KEY", "clave-ficticia");
  vi.stubEnv("ATOMICMEMORY_API_KEY", "amc_ficticia");
  fetchMock = vi.fn<typeof fetch>().mockImplementation(fakeFetch);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function withTeachers() {
  const t = convexTest(schema, modules);
  const rosaId = await t.run((ctx) => ctx.db.insert("users", { name: "Rosa", email: "rosa@colegio.pe" }));
  const luisId = await t.run((ctx) => ctx.db.insert("users", { name: "Luis", email: "luis@colegio.pe" }));
  return { t, rosaId, rosa: t.withIdentity({ subject: `${rosaId}|s1` }), luis: t.withIdentity({ subject: `${luisId}|s2` }) };
}

describe("nota de preferencias: Atomic Memory", () => {
  it("sin clave queda apagado y no llama a nadie", async () => {
    vi.stubEnv("ATOMICMEMORY_API_KEY", "");
    const { rosa, rosaId } = await withTeachers();
    expect(await rosa.query(api.teacherMemory.status, {})).toEqual({ enabled: false, owner: rosaId });
    expect(await rosa.action(api.teacherMemory.save, { text: NOTA })).toEqual({ owner: rosaId, status: "off" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("solo docentes con sesión", async () => {
    const { t } = await withTeachers();
    await expect(t.action(api.teacherMemory.get, {})).rejects.toThrow(/Inicia sesión/);
    await expect(t.action(api.teacherMemory.save, { text: NOTA })).rejects.toThrow(/Inicia sesión/);
  });

  it("guarda con el sujeto de la sesión, la lee y la olvida", async () => {
    const { rosa, rosaId } = await withTeachers();
    expect(await rosa.action(api.teacherMemory.save, { text: `  ${NOTA} ` })).toMatchObject({ status: "ok", preference: { text: NOTA } });
    expect(rows).toEqual([expect.objectContaining({ user_id: `robolab-docente:${rosaId}`, content: NOTA })]);
    expect(await rosa.action(api.teacherMemory.get, {})).toMatchObject({ status: "ok", preference: { text: NOTA } });
    expect(await rosa.action(api.teacherMemory.remove, {})).toEqual({ owner: rosaId, status: "ok", preference: null });
    expect(rows).toEqual([]);
  });

  it("un docente no ve ni borra la nota de otro", async () => {
    const { rosa, luis } = await withTeachers();
    await rosa.action(api.teacherMemory.save, { text: NOTA });
    expect(await luis.action(api.teacherMemory.get, {})).toMatchObject({ status: "ok", preference: null });
    await luis.action(api.teacherMemory.remove, {});
    expect(rows).toHaveLength(1);
  });

  it("rechaza datos personales antes de llamar al proveedor", async () => {
    const { rosa } = await withTeachers();
    await expect(rosa.action(api.teacherMemory.save, { text: "Escríbeme a rosa@colegio.pe siempre" })).rejects.toThrow(/sin correos/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si Atomic Memory falla, el cambio queda sin confirmar", async () => {
    const { rosa } = await withTeachers();
    memoryDown = true;
    expect(await rosa.action(api.teacherMemory.save, { text: NOTA })).toMatchObject({ status: "unavailable" });
  });
});

describe("el asistente usa la nota del docente", () => {
  it("la nota llega al prompt como dato y se avisa que se usó", async () => {
    const { rosa } = await withTeachers();
    await rosa.action(api.teacherMemory.save, { text: NOTA });
    const result = await rosa.action(api.agent.generate, { objective: OBJETIVO, grades: [2] });
    expect(result).toMatchObject({ status: "ok", preference: "used" });
    const anthropic = fetchMock.mock.calls.find(([url]) => String(url).includes("anthropic"))!;
    const prompt = String(anthropic[1]!.body);
    expect(prompt).toContain("teacherPreferences");
    expect(prompt).toContain(NOTA);
  });

  it("sin nota o con Atomic Memory caído, genera igual y lo dice", async () => {
    const { rosa, luis } = await withTeachers();
    await rosa.action(api.teacherMemory.save, { text: NOTA });
    const none = await luis.action(api.agent.generate, { objective: OBJETIVO, grades: [2] });
    expect(none).toMatchObject({ status: "ok", preference: "none" });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("anthropic")).every(([, init]) => !String(init!.body).includes(NOTA))).toBe(true);

    memoryDown = true;
    const down = await rosa.action(api.agent.generate, { objective: OBJETIVO, grades: [2] });
    expect(down).toMatchObject({ status: "ok", preference: "unavailable" });
    if (down.status === "ok") expect(down.proposals).toHaveLength(1);
  });
});
