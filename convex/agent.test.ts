import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { missionFixtures } from "../domain/mission/fixtures";
import { realEnergyMission } from "../domain/mission/realEnergyFixture";
import { findSimpleAlternative } from "../domain/mission/alternative";
import { api } from "./_generated/api";
import { AGENT_MAX_PER_DAY, AGENT_MAX_PER_HOUR } from "./agent";
import schema from "./schema";
import { modules } from "./test.setup";

const FIXTURE = (grade: 2 | 3 | 4) => missionFixtures.find((m) => m.grade === grade)!;
const OBJETIVO = "Comparar sumas de costos y elegir un recorrido con presupuesto limitado.";

const toolReply = (mission: unknown) =>
  Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "propose_mission", input: mission }] });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 18, 15, 0));
  vi.stubEnv("ANTHROPIC_API_KEY", "clave-ficticia");
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => toolReply(FIXTURE(2)));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function withTeacher() {
  const t = convexTest(schema, modules);
  const teacherId = await t.run((ctx) => ctx.db.insert("users", { name: "Rosa", email: "rosa@colegio.pe" }));
  const otherId = await t.run((ctx) => ctx.db.insert("users", { name: "Luis", email: "luis@colegio.pe" }));
  return { t, teacher: t.withIdentity({ subject: `${teacherId}|s1` }), other: t.withIdentity({ subject: `${otherId}|s2` }) };
}

describe("asistente: estado", () => {
  it("dice si está activado sin revelar la clave", async () => {
    const { teacher } = await withTeacher();
    expect(await teacher.query(api.agent.status, {})).toEqual({ configured: true });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await teacher.query(api.agent.status, {})).toEqual({ configured: false });
  });

  it("con la clave de Gemini también está activado", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "clave-gemini");
    const { teacher } = await withTeacher();
    expect(await teacher.query(api.agent.status, {})).toEqual({ configured: true });
  });

  it("solo para docentes con sesión", async () => {
    const { t } = await withTeacher();
    await expect(t.query(api.agent.status, {})).rejects.toThrow(/Inicia sesión/);
    await expect(t.action(api.agent.generate, { objective: OBJETIVO, grades: [2] })).rejects.toThrow(/Inicia sesión/);
  });
});

describe("asistente: proponer misiones", () => {
  it("devuelve la misión verificada por el servidor, con su energía mínima y sin llamar a otra cosa que Anthropic", async () => {
    const { teacher } = await withTeacher();
    const result = await teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [2], difficulty: "balanced" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.failed).toEqual([]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      grade: 2,
      mission: { grade: 2, objective: OBJETIVO },
      metrics: { solutionStatus: "SOLVED" },
    });
    expect(result.proposals[0]!.metrics.minimumEnergy).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.anthropic.com/v1/messages");
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("clave-ficticia");
  });

  it("cada propuesta trae alternativeCost: lo que cuesta otra ruta simple que excede el presupuesto, o null", async () => {
    const { teacher } = await withTeacher();
    // Caso real A1: existe una ruta simple más cara que el presupuesto.
    fetchMock.mockImplementation(async () => toolReply(realEnergyMission));
    const found = await teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [3] });
    if (found.status !== "ok") throw new Error("se esperaba ok");
    const alternative = findSimpleAlternative(realEnergyMission);
    expect(alternative.status).toBe("FOUND");
    if (alternative.status !== "FOUND") return;
    expect(found.proposals[0]!.alternativeCost).toBe(alternative.cost);
    expect(found.proposals[0]!.alternativeCost).toBeGreaterThan(realEnergyMission.energyBudget);
    // Sin ruta alternativa (o con límite agotado) el campo existe y es null, y el resto del contrato no cambia.
    fetchMock.mockImplementation(async () => toolReply(FIXTURE(2)));
    const none = await teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [2] });
    if (none.status !== "ok") throw new Error("se esperaba ok");
    expect(none.proposals[0]).toHaveProperty("alternativeCost");
    const expected = findSimpleAlternative(FIXTURE(2));
    expect(none.proposals[0]!.alternativeCost).toBe(expected.status === "FOUND" ? expected.cost : null);
    expect(none.proposals[0]).toMatchObject({ grade: 2, metrics: { solutionStatus: "SOLVED" } });
  });

  it("con la clave de Gemini llama a Gemini (clave en cabecera, no en la URL) y devuelve la misma forma de propuesta", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "clave-gemini");
    fetchMock.mockImplementation(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(FIXTURE(2)) }] } }] }));
    const { teacher } = await withTeacher();
    const result = await teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [2] });
    expect(result).toMatchObject({ status: "ok", failed: [], proposals: [{ grade: 2, metrics: { solutionStatus: "SOLVED" } }] });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.1-flash-lite:generateContent$/);
    expect(String(url)).not.toContain("clave-gemini");
    expect((options!.headers as Record<string, string>)["x-goog-api-key"]).toBe("clave-gemini");
  });

  it("lo que no pasa la revisión no se ofrece (nada de plantillas de respaldo) y se avisa por grado", async () => {
    const { teacher } = await withTeacher();
    // El proveedor siempre devuelve la misión de 2.º: para 3.º no cumple el grado, aun tras reparar.
    const result = await teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [2, 3] });
    if (result.status !== "ok") throw new Error("se esperaba ok");
    expect(result.proposals.map((p) => p.grade)).toEqual([2]);
    expect(result.failed).toEqual([{ grade: 3, code: "SCHEMA_INVALID" }]);
    // 1 llamada para 2.º + (1 + 2 reparaciones) para 3.º.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("sin clave en el servidor avisa que el asistente no está activado y no llama a nadie", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { teacher } = await withTeacher();
    expect(await teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [2] })).toEqual({ status: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["con correo", "Practicar sumas, avísame a profe@colegio.pe cuando termine."],
    ["con teléfono", "Practicar sumas, llámame al 987 654 321 para coordinar."],
    ["demasiado corto", "sumas"],
  ])("rechaza una solicitud inválida (%s) sin gastar un intento ni llamar al proveedor", async (_name, objective) => {
    const { teacher, t } = await withTeacher();
    await expect(teacher.action(api.agent.generate, { objective, grades: [2] })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("agentUsage").collect())).toHaveLength(0);
  });

  it("un error del proveedor se devuelve como código (no como texto del proveedor) y no inventa propuestas", async () => {
    fetchMock.mockResolvedValue(new Response("cuerpo-secreto", { status: 429 }));
    const { teacher } = await withTeacher();
    const result = await teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [2] });
    expect(result).toEqual({ status: "ok", preference: "off", proposals: [], failed: [{ grade: 2, code: "PROVIDER_RATE_LIMIT" }] });
    expect(JSON.stringify(result)).not.toContain("secreto");
  });

  it("limita cuántas veces por hora puede pedir un docente, para acotar el gasto", async () => {
    const { teacher, other } = await withTeacher();
    for (let i = 0; i < AGENT_MAX_PER_HOUR; i++) await teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [2] });
    await expect(teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [2] })).rejects.toThrow(/muchas solicitudes/i);
    expect(fetchMock).toHaveBeenCalledTimes(AGENT_MAX_PER_HOUR);
    // Otro docente no se ve afectado.
    expect((await other.action(api.agent.generate, { objective: OBJETIVO, grades: [2] })).status).toBe("ok");
    // Pasada la hora puede volver a pedir.
    vi.setSystemTime(Date.UTC(2026, 9, 18, 16, 1));
    expect((await teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [2] })).status).toBe("ok");
  });

  it("también hay un tope por día", async () => {
    const { teacher } = await withTeacher();
    for (let hour = 0; hour * AGENT_MAX_PER_HOUR < AGENT_MAX_PER_DAY; hour++) {
      vi.setSystemTime(Date.UTC(2026, 9, 18, 8 + hour, 0));
      for (let i = 0; i < AGENT_MAX_PER_HOUR && hour * AGENT_MAX_PER_HOUR + i < AGENT_MAX_PER_DAY; i++) {
        await teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [2] });
      }
    }
    vi.setSystemTime(Date.UTC(2026, 9, 18, 8 + Math.ceil(AGENT_MAX_PER_DAY / AGENT_MAX_PER_HOUR), 0));
    await expect(teacher.action(api.agent.generate, { objective: OBJETIVO, grades: [2] })).rejects.toThrow(/hoy/i);
  });
});

describe("asistente: guardar lo que el docente eligió", () => {
  it("guarda una misión certificada como borrador del docente y la lista solo a su dueño", async () => {
    const { teacher, other } = await withTeacher();
    const id = await teacher.mutation(api.agent.save, { mission: FIXTURE(3) });
    const mine = await teacher.query(api.agent.listMine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ _id: id, grade: 3, title: FIXTURE(3).title, metrics: { solutionStatus: "SOLVED" } });
    expect(await other.query(api.agent.listMine, {})).toEqual([]);
  });

  it("el servidor vuelve a revisar: una misión sin solución o fuera de reglas no se guarda, aunque el navegador diga que es válida", async () => {
    const { teacher } = await withTeacher();
    await expect(teacher.mutation(api.agent.save, { mission: { ...FIXTURE(2), energyBudget: 1 } })).rejects.toThrow();
    await expect(teacher.mutation(api.agent.save, { mission: { ...FIXTURE(2), start: { row: 99, col: 0 } } })).rejects.toThrow();
    await expect(teacher.mutation(api.agent.save, { mission: "no es una misión" })).rejects.toThrow();
    expect(await teacher.query(api.agent.listMine, {})).toEqual([]);
  });

  it("solo para docentes con sesión", async () => {
    const { t } = await withTeacher();
    await expect(t.mutation(api.agent.save, { mission: FIXTURE(2) })).rejects.toThrow(/Inicia sesión/);
  });
});

describe("asistente: propuestas de la Jetson", () => {
  it("requiere docente y vuelve a certificar sin llamar a un proveedor cloud", async () => {
    const { t, teacher } = await withTeacher();
    const args = { objective: OBJETIVO, grades: [2, 3], missions: [FIXTURE(2), FIXTURE(3)] };
    await expect(t.action(api.agent.reviewLocal, args)).rejects.toThrow(/Inicia sesión/);
    const result = await teacher.action(api.agent.reviewLocal, args);
    expect(result).toMatchObject({ status: "ok", failed: [], proposals: [
      { grade: 2, mission: { objective: OBJETIVO }, metrics: { solutionStatus: "SOLVED" } },
      { grade: 3, metrics: { solutionStatus: "SOLVED" } },
    ] });
    expect(fetchMock).not.toHaveBeenCalled();
    if (result.status !== "ok") throw new Error("se esperaba ok");
    const id = await teacher.mutation(api.agent.save, { mission: result.proposals[0]!.mission });
    expect(await teacher.query(api.agent.get, { id })).toMatchObject({ grade: 2 });
  });
  it("descarta respuestas falsas, imposibles, duplicadas y grados no pedidos", async () => {
    const { teacher } = await withTeacher();
    const bad = { ...FIXTURE(2), energyBudget: 1 };
    expect(await teacher.action(api.agent.reviewLocal, { objective: OBJETIVO, grades: [2, 3], missions: [bad, { forged: true }, FIXTURE(4)] })).toMatchObject({ proposals: [], failed: [{ grade: 2 }, { grade: 3 }] });
    const duplicated = await teacher.action(api.agent.reviewLocal, { objective: OBJETIVO, grades: [2], missions: [FIXTURE(2), FIXTURE(2)] });
    expect(duplicated.proposals).toEqual([]);
    expect(duplicated.failed).toEqual([{ grade: 2, code: "SCHEMA_INVALID" }]);
  });
  it("acota el número de propuestas y valida la solicitud antes de resolver", async () => {
    const { teacher } = await withTeacher();
    await expect(teacher.action(api.agent.reviewLocal, { objective: OBJETIVO, grades: [2], missions: Array(4).fill(FIXTURE(2)) })).rejects.toThrow(/tres/);
    await expect(teacher.action(api.agent.reviewLocal, { objective: "corto", grades: [2], missions: [] })).rejects.toThrow(/objetivo/i);
  });
});
