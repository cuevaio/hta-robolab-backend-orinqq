import { missionFingerprint } from "./local-audit";
import type { LocalGenerationEvent } from "./local-audit";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { MissionProvider } from "./contracts";
import { missionFixtures } from "../domain/mission/fixtures";
import { createLocalGenerationServer } from "./local-server";
const servers: Server[] = [];
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(resolve => s.close(() => resolve())); } });
const origin = "https://robolab-web-omega.vercel.app";
const provider: MissionProvider = { name: "ollama", model: "qwen", propose: async ({request}) => missionFixtures.find(m => m.grade === request.grade)! };
async function start(p = provider, onEvent?: (event: LocalGenerationEvent) => void) {
  const server = createLocalGenerationServer({ provider: p, allowedOrigins: [origin], onEvent, timeoutMs: 1000, totalMs: 2000 });
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("sin puerto");
  return `http://127.0.0.1:${address.port}`;
}
const request = { objective: "Comparar sumas de los costos del recorrido", grades: [2], difficulty: "balanced" };
const post = (url: string, body: unknown = request, headers: Record<string, string> = { Origin: origin, "Content-Type": "application/json" }) => fetch(`${url}/generate`, { method: "POST", headers, body: JSON.stringify(body) });
describe("acompañante de la Jetson", () => {
  it("genera misiones verificadas mediante el orquestador compartido", async () => {
    const url = await start(); const res = await post(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(await res.json()).toMatchObject({ missions: [{ grade: 2, objective: request.objective }], failed: [] });
  });
  it("rechaza orígenes ajenos, solicitudes sin origen, formularios y DNS rebinding", async () => {
    const url = await start();
    expect((await post(url, request, { Origin: "https://ajeno.example", "Content-Type": "application/json" })).status).toBe(403);
    expect((await post(url, request, { "Content-Type": "application/json" })).status).toBe(403);
    expect((await post(url, request, { Origin: origin, "Content-Type": "text/plain" })).status).toBe(415);
    expect((await fetch(`${url}/health`, { headers: { Host: "ajeno.example" } })).status).toBe(403);
  });
  it("permite preflight solo al origen configurado", async () => {
    const url = await start();
    const res = await fetch(`${url}/generate`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect((await fetch(`${url}/generate`, { method: "OPTIONS", headers: { Origin: "https://ajeno.example" } })).status).toBe(403);
  });
  it("no invoca el modelo con entradas inválidas o grandes", async () => {
    let calls = 0;
    const url = await start({ ...provider, propose: async () => { calls++; return {}; } });
    expect((await post(url, { ...request, objective: "corto" })).status).toBe(400);
    expect((await post(url, { ...request, objective: "x".repeat(20000) })).status).toBe(413);
    expect(calls).toBe(0);
  });
  it("rechaza concurrencia y cancela el modelo si el navegador se desconecta", async () => {
    let began!: () => void; const started = new Promise<void>(r => { began = r; });
    let stopped!: () => void; const aborted = new Promise<void>(r => { stopped = r; });
    const url = await start({ ...provider, propose: ({signal}) => new Promise((_resolve, reject) => {
      began(); signal.addEventListener("abort", () => { stopped(); reject(new Error("cancelado")); }, { once: true });
    }) });
    const controller = new AbortController();
    const pending = fetch(`${url}/generate`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(request), signal: controller.signal }).catch(() => null);
    await started;
    expect((await post(url)).status).toBe(409);
    controller.abort(); await pending; await aborted;
  });
});


it("relaciona cada respuesta con modelo, solicitud y huella sin registrar el aprendizaje", async () => {
  const events: LocalGenerationEvent[] = [];
  const url = await start(provider, event => events.push(event));
  const response = await post(url); const body = await response.json();
  expect(body.generationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({ phase: "started", generationId: body.generationId, provider: "ollama", model: "qwen" });
  expect(events[1]).toMatchObject({ phase: "completed", generationId: body.generationId, calls: 1, repairs: 0, missions: [{ grade: 2, sha256: missionFingerprint(body.missions[0]) }], failed: [] });
  expect(JSON.stringify(events)).not.toContain(request.objective);
});
it("un fallo del registro no impide generar una misión válida", async () => {
  const url = await start(provider, () => { throw new Error("logger no disponible"); });
  expect((await post(url)).status).toBe(200);
});

it("no registra identificadores libres del modelo que pueden contener el aprendizaje", async () => {
  const events: LocalGenerationEvent[] = [];
  const url = await start({ ...provider, propose: async () => ({ ...missionFixtures.find(m => m.grade === 2)!, id: request.objective }) }, event => events.push(event));
  const response = await post(url); const body = await response.json();
  expect(body.missions[0].id).toBe(request.objective);
  expect(events[1]).toMatchObject({ phase: "completed", missions: [{ grade: 2, sha256: missionFingerprint(body.missions[0]) }] });
  expect(JSON.stringify(events)).not.toContain(request.objective);
});
