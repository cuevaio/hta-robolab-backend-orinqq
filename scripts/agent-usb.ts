import { createUsbSession } from "../generation/usb-session";
import { OllamaProvider } from "../generation/providers/ollama";

// La API del modelo vive en esta misma Jetson. El puerto USB nunca selecciona una URL.
const provider = new OllamaProvider("http://127.0.0.1:11434");
const session = createUsbSession({
  provider, checkModel: () => provider.isAvailable(),
  send: line => {
    if (process.stdout.writableLength > 512 * 1024) throw new Error("USB bloqueado");
    process.stdout.write(line);
  },
  onEvent: event => console.error(JSON.stringify({ agent: "jetson_generation", transport: "usb_serial", ...event })),
});
const timer = setInterval(() => session.tick(), 1000);
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  session.close(); clearInterval(timer); process.stdin.destroy();
  setTimeout(() => process.exit(0), 200).unref();
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => session.receive(String(chunk)));
process.stdin.on("end", stop); process.stdin.on("error", stop); process.stdout.on("error", stop);
process.on("SIGTERM", stop); process.on("SIGINT", stop);
console.error(JSON.stringify({ event: "usb_service_ready", model: provider.model, protocol: 1 }));
