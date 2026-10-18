import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { MissionProvider } from "./contracts";
import { generateActivity } from "./orchestrator";
import { parseActivityRequest } from "./request";
import { ContractError } from "../domain/mission/validation";

const MAX_REQUEST_BYTES = 16 * 1024;
export const LOCAL_TIMEOUT_MS = 180_000;
export const LOCAL_TOTAL_MS = 540_000;
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers["content-length"]) > MAX_REQUEST_BYTES) throw new HttpError(413, "La solicitud es demasiado grande.");
  const body = await new Promise<string>((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const cleanup = () => { req.off("data", data); req.off("end", end); req.off("error", error); };
    const error = () => { cleanup(); reject(new HttpError(400, "No llegó la solicitud completa.")); };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks).toString("utf8")); };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) { cleanup(); req.resume(); reject(new HttpError(413, "La solicitud es demasiado grande.")); }
      else chunks.push(chunk);
    };
    req.on("data", data); req.on("end", end); req.on("error", error);
  });
  try { return JSON.parse(body); } catch { throw new HttpError(400, "Envía una solicitud JSON válida."); }
}
/** Solo escucha en loopback desde el CLI. Los orígenes se fijan al arrancar, no desde la web. */
export function createLocalGenerationServer(options: {
  provider: MissionProvider; allowedOrigins: readonly string[]; timeoutMs?: number; totalMs?: number; checkModel?: () => Promise<boolean>;
}) {
  let busy = false;
  return createServer(async (req, res) => {
    req.on("error", () => undefined);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status: number, body?: unknown) => { res.statusCode = status; res.end(body === undefined ? undefined : JSON.stringify(body)); };
    const expectedHost = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== expectedHost) { send(403, { error: "Host no permitido." }); return; }
    const origin = req.headers.origin;
    if (!origin || !options.allowedOrigins.includes(origin)) { send(403, { error: "Este origen no está autorizado en el acompañante local." }); return; }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (req.method === "OPTIONS") { send(204); return; }
    if (req.url === "/health" && req.method === "GET") {
      const ready = options.checkModel ? await options.checkModel().catch(() => false) : true;
      send(200, { status: "ok", provider: options.provider.name, model: options.provider.model, busy, ready }); return;
    }
    if (req.url !== "/generate" || req.method !== "POST") { send(404, { error: "Ruta no encontrada." }); return; }
    if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") { send(415, { error: "Usa application/json." }); return; }
    if (busy) { send(409, { error: "La Jetson está generando otra misión. Espera a que termine." }); return; }
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", cancel);
    try {
      const request = parseActivityRequest(await readJson(req));
      // Se comprueba también tras leer: otra petición puede haber reservado el equipo.
      if (busy) throw new HttpError(409, "La Jetson está generando otra misión. Espera a que termine.");
      busy = true;
      try {
        const results = await generateActivity(request, options.provider, {
          timeoutMs: options.timeoutMs ?? LOCAL_TIMEOUT_MS, totalMs: options.totalMs ?? LOCAL_TOTAL_MS,
          signal: controller.signal,
        });
        send(200, {
          missions: results.filter(r => r.origin === "ai_generated").map(r => r.mission),
          failed: results.filter(r => r.origin !== "ai_generated").map(r => ({ grade: r.mission.grade, code: r.errorCode ?? "PROVIDER_UNAVAILABLE" })),
        });
      } finally { busy = false; }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof ContractError) send(400, { error: error.issues[0]?.message ?? "Revisa la solicitud." });
        else if (error instanceof HttpError) send(error.status, { error: error.message });
        else send(503, { error: "No pudimos generar con la Jetson. Revisa la conexión USB y el modelo." });
      }
    } finally { res.off("close", cancel); }
  });
}
