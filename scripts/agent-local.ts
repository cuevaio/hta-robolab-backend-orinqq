import { createLocalGenerationServer } from "../generation/local-server";
import { OllamaProvider } from "../generation/providers/ollama";

const origins = (process.env.AGENT_LOCAL_ORIGINS ?? "http://localhost:5173,http://localhost:5175,https://robolab-web.vercel.app,https://robolab-web-omega.vercel.app")
  .split(",").map(s => s.trim()).filter(Boolean);
if (!origins.length || origins.some(s => { try { const url = new URL(s); return !["http:", "https:"].includes(url.protocol) || url.origin !== s; } catch { return true; } })) {
  throw new Error("AGENT_LOCAL_ORIGINS debe contener orígenes HTTP/HTTPS exactos separados por comas.");
}
const endpoint = new URL(process.env.OLLAMA_URL ?? "http://127.0.0.1:11435");
if (endpoint.hostname !== "127.0.0.1" || endpoint.protocol !== "http:" || endpoint.username || endpoint.password || endpoint.pathname !== "/") {
  throw new Error("OLLAMA_URL debe apuntar a HTTP en 127.0.0.1; utiliza el túnel SSH para la Jetson.");
}
const port = Number(process.env.AGENT_LOCAL_PORT ?? 8765);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("AGENT_LOCAL_PORT debe estar entre 1024 y 65535.");
const provider = new OllamaProvider(endpoint.origin, process.env.OLLAMA_MODEL?.trim() || undefined);
const server = createLocalGenerationServer({ provider, allowedOrigins: origins, checkModel: () => provider.isAvailable(), onEvent: event => console.log(JSON.stringify({ agent: "local_generation", ...event })) });
server.listen(port, "127.0.0.1", () => {
  console.log(`Conector RoboLab: http://127.0.0.1:${port} · ${provider.model}`);
  console.log(`Orígenes permitidos: ${origins.join(", ")}`);
});
server.on("error", error => { console.error(`No se pudo iniciar el conector: ${error.message}`); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { server.close(); server.closeAllConnections(); });
}
