import { randomUUID } from "node:crypto";
import { JETSON_USB_DEVICE, JETSON_USB_LEASE_MS, JETSON_USB_REQUEST_LIMIT, JETSON_USB_RESPONSE_LIMIT, JETSON_USB_VERSION } from "../domain/generation/usbProtocol";
import { generateActivity } from "./orchestrator";
import { parseActivityRequest } from "./request";
import type { MissionProvider } from "./contracts";
import { missionFingerprint } from "./local-audit";
import type { LocalGenerationEvent } from "./local-audit";
import { LOCAL_TIMEOUT_MS, LOCAL_TOTAL_MS } from "./local-server";

/** Solo atiende el protocolo de generación: nunca interpreta shell, rutas ni URLs recibidas. */
export function createUsbSession(options: {
  provider: MissionProvider; send: (line: string) => void; checkModel: () => Promise<boolean>;
  onEvent?: (event: LocalGenerationEvent) => void; now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let closed = false, identified = false, checking = false, dropping = false;
  let buffer = "", lastSeen = now();
  let active: { id: string; controller: AbortController } | null = null;
  function close() { closed = true; active?.controller.abort(); buffer = ""; }
  function reply(id: string, result: unknown, error?: string) {
    if (closed) return;
    let line = JSON.stringify({ v: JETSON_USB_VERSION, id, ...(error ? { ok: false, error } : { ok: true, result }) }) + "\n";
    if (Buffer.byteLength(line) > JETSON_USB_RESPONSE_LIMIT) line = JSON.stringify({ v: 1, id, ok: false, error: "RESPONSE_TOO_LARGE" }) + "\n";
    try { options.send(line); } catch { close(); }
  }
  function log(event: LocalGenerationEvent) { try { options.onEvent?.(event); } catch { /* El registro no modifica la inferencia. */ } }
  async function generate(id: string, request: ReturnType<typeof parseActivityRequest>) {
    const controller = new AbortController(); active = { id, controller };
    const generationId = randomUUID(), started = now();
    const event = { generationId, provider: options.provider.name, model: options.provider.model };
    log({ ...event, phase: "started", at: new Date().toISOString() });
    try {
      const results = await generateActivity(request, options.provider, { timeoutMs: LOCAL_TIMEOUT_MS, totalMs: LOCAL_TOTAL_MS, signal: controller.signal });
      if (controller.signal.aborted) throw new Error("cancelled");
      const missions = results.filter(r => r.origin === "ai_generated").map(r => r.mission);
      const failed = results.filter(r => r.origin !== "ai_generated").map(r => ({ grade: r.mission.grade, code: r.errorCode ?? "PROVIDER_UNAVAILABLE" as const }));
      log({ ...event, phase: "completed", at: new Date().toISOString(), durationMs: now() - started,
        calls: results.reduce((n, r) => n + r.calls, 0), repairs: results.reduce((n, r) => n + r.repairs, 0),
        missions: missions.map(mission => ({ grade: mission.grade, sha256: missionFingerprint(mission) })), failed });
      reply(id, { generationId, missions, failed });
    } catch {
      log({ ...event, phase: controller.signal.aborted ? "cancelled" : "failed", at: new Date().toISOString(), durationMs: now() - started });
      reply(id, null, controller.signal.aborted ? "CANCELLED" : "UNAVAILABLE");
    } finally { if (active?.controller === controller) active = null; }
  }
  function handle(line: string) {
    let data: unknown;
    try { data = JSON.parse(line); } catch { return; }
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    const m = data as Record<string, unknown>;
    if (typeof m.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(m.id)) return;
    const id = m.id;
    if (m.v !== JETSON_USB_VERSION) { reply(id, null, "PROTOCOL_VERSION"); return; }
    lastSeen = now();
    if (m.method === "hello") {
      if (checking) { reply(id, null, "BUSY"); return; }
      checking = true;
      void options.checkModel().catch(() => false).then(ready => {
        identified = ready;
        reply(id, { device: JETSON_USB_DEVICE, protocol: JETSON_USB_VERSION, provider: options.provider.name, model: options.provider.model, ready, busy: !!active });
      }).finally(() => { checking = false; });
      return;
    }
    if (!identified) { reply(id, null, "NOT_READY"); return; }
    if (m.method === "ping") { reply(id, { alive: true }); return; }
    if (m.method === "cancel") {
      const params = m.params as { requestId?: unknown } | undefined;
      if (params?.requestId === active?.id) active?.controller.abort();
      reply(id, { cancelled: true }); return;
    }
    if (m.method !== "generate") { reply(id, null, "BAD_REQUEST"); return; }
    if (active) { reply(id, null, "BUSY"); return; }
    let request: ReturnType<typeof parseActivityRequest>;
    try { request = parseActivityRequest(m.params); } catch { reply(id, null, "BAD_REQUEST"); return; }
    void generate(id, request);
  }
  return {
    receive(chunk: string) {
      if (closed) return;
      for (const part of chunk.split(/(?<=\n)/)) {
        const end = part.endsWith("\n");
        if (!dropping) {
          buffer += part;
          if (Buffer.byteLength(buffer) > JETSON_USB_REQUEST_LIMIT) { dropping = true; buffer = ""; }
        }
        if (end) { if (!dropping && buffer.trim()) handle(buffer); buffer = ""; dropping = false; }
      }
    },
    tick() { if (active && now() - lastSeen > JETSON_USB_LEASE_MS) { active.controller.abort(); identified = false; } },
    close,
  };
}
