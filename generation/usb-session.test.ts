import { describe, expect, it, vi } from "vitest";
import { createUsbSession } from "./usb-session";
import { missionFixtures } from "../domain/mission/fixtures";
import type { MissionProvider } from "./contracts";

const request = { objective: "Comparar sumas de los costos del recorrido", grades: [2], difficulty: "balanced" };
const frame = (id: string, method: string, params?: unknown) => JSON.stringify({ v: 1, id, method, params }) + "\n";
const provider: MissionProvider = { name: "ollama", model: "qwen", propose: async () => missionFixtures.find(m => m.grade === 2)! };
function setup(p = provider) {
  const messages: Record<string, unknown>[] = []; const logs: unknown[] = []; let now = 0;
  const session = createUsbSession({ provider: p, send: line => messages.push(JSON.parse(line)), checkModel: async () => true, onEvent: event => logs.push(event), now: () => now });
  return { session, messages, logs, advance: (ms: number) => { now += ms; session.tick(); } };
}
async function hello(s: ReturnType<typeof setup>) {
  s.session.receive(frame("hello", "hello"));
  await vi.waitFor(() => expect(s.messages).toContainEqual(expect.objectContaining({ id: "hello", ok: true })));
}
describe("sesión USB de generación", () => {
  it("tolera repetir la identificación mientras comprueba el modelo", async () => {
    const s = setup(); s.session.receive(frame("hello", "hello") + frame("hello", "hello"));
    await vi.waitFor(() => expect(s.messages).toContainEqual(expect.objectContaining({ id: "hello", ok: true })));
    expect(s.messages.some(m => m.ok === false)).toBe(false); s.session.close();
  });
  it("identifica la Jetson antes de aceptar solicitudes y ensambla fragmentos", async () => {
    const s = setup();
    s.session.receive(frame("early", "generate", request));
    expect(s.messages[0]).toMatchObject({ id: "early", ok: false, error: "NOT_READY" });
    const bytes = frame("hello", "hello"); s.session.receive(bytes.slice(0, 12)); s.session.receive(bytes.slice(12));
    await vi.waitFor(() => expect(s.messages[1]).toMatchObject({ v: 1, id: "hello", ok: true, result: { device: "robolab-jetson", protocol: 1, provider: "ollama", model: "qwen", ready: true } }));
    s.session.close();
  });
  it("devuelve solo misiones del modelo verificadas y audita sin contenido libre", async () => {
    const s = setup({ ...provider, propose: async () => ({ ...missionFixtures.find(m => m.grade === 2)!, id: request.objective }) });
    await hello(s); s.session.receive(frame("generation", "generate", request));
    await vi.waitFor(() => expect(s.messages.at(-1)).toMatchObject({ id: "generation", ok: true, result: { missions: [{ grade: 2 }], failed: [] } }));
    expect(s.logs).toHaveLength(2); expect(JSON.stringify(s.logs)).not.toContain(request.objective);
    s.session.close();
  });
  it("limita tramas, recupera la siguiente línea y no ejecuta entradas inválidas", async () => {
    const propose = vi.fn(provider.propose); const s = setup({ ...provider, propose });
    s.session.receive("x".repeat(20000) + "\n"); await hello(s);
    s.session.receive(frame("bad", "generate", { ...request, objective: "x" }));
    s.session.receive(frame("version", "hello").replace('"v":1', '"v":2'));
    expect(s.messages).toContainEqual(expect.objectContaining({ id: "bad", error: "BAD_REQUEST" }));
    expect(s.messages).toContainEqual(expect.objectContaining({ id: "version", error: "PROTOCOL_VERSION" }));
    expect(propose).not.toHaveBeenCalled(); s.session.close();
  });
  it.each(["cancel", "close", "lease"])("cancela la inferencia por %s y rechaza otra concurrente", async kind => {
    let signal: AbortSignal | undefined;
    const s = setup({ ...provider, propose: input => { signal = input.signal; return new Promise(() => {}); } });
    await hello(s); s.session.receive(frame("one", "generate", request));
    await vi.waitFor(() => expect(signal).toBeTruthy());
    s.session.receive(frame("two", "generate", request));
    expect(s.messages.at(-1)).toMatchObject({ id: "two", error: "BUSY" });
    if (kind === "cancel") s.session.receive(frame("stop", "cancel", { requestId: "one" }));
    else if (kind === "close") s.session.close();
    else { s.advance(14000); s.session.receive(frame("ping", "ping")); s.advance(14000); expect(signal?.aborted).toBe(false); s.advance(2000); }
    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(s.logs).toHaveLength(2));
    expect(s.logs[1]).toMatchObject({ phase: "cancelled" });
    s.session.close();
  });
});
