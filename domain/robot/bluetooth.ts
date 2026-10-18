import { parseRobotReply, validateSequence, type RobotReply } from "./protocol";

/** SPP serial: el payload conserva las letras del protocolo del robot. */
export const BLUETOOTH_LINE_LIMIT = 200;
export const BLUETOOTH_HEARTBEAT_MS = 1000;
export const BLUETOOTH_LEASE_MS = 3500;
const ID = /^[A-Za-z0-9-]{1,36}$/;

export type BluetoothMessage =
  | { readonly kind: "hello"; readonly commands: string; readonly turns: "arc" | "pivot" }
  | { readonly kind: "pong" }
  | { readonly kind: "status"; readonly id: string; readonly reply: RobotReply };

/** Recibe una línea completa sin LF; no mezcla respuestas de distintos envíos. */
export function parseBluetoothLine(raw: string): BluetoothMessage | null {
  if (raw.length > BLUETOOTH_LINE_LIMIT) return null;
  const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (text === "PONG") return { kind: "pong" };
  const hello = /^ROBO\/1 ([ARDZ]{1,4}) (ARC|PIVOT)$/.exec(text);
  if (hello && new Set(hello[1]).size === hello[1]!.length) {
    return { kind: "hello", commands: hello[1]!, turns: hello[2] === "ARC" ? "arc" : "pivot" };
  }
  const status = /^STATUS ([A-Za-z0-9-]{1,36}) (OK|RUN|DONE|ERR:[A-Z_]{1,32})$/.exec(text);
  if (!status) return null;
  const reply = parseRobotReply(status[2]!);
  return reply ? { kind: "status", id: status[1]!, reply } : null;
}

export function bluetoothRunFrame(id: string, sequence: string): string {
  if (!ID.test(id)) throw new Error("El identificador del envío no es válido.");
  const check = validateSequence(sequence);
  if (!check.ok) throw new Error(check.error === "TOO_LONG" ? "El robot recibe hasta 128 pasos." : "El programa tiene movimientos no válidos.");
  return `RUN ${id} ${sequence}\n`;
}

/** La capacidad la anuncia el robot: no se simula un movimiento que su montaje no admite. */
export function bluetoothProgramProblem(sequence: string, commands: string): string | null {
  if (sequence.includes("R") && !commands.includes("R")) return "Este robot no puede retroceder. Quita los pasos de retroceso para enviarlo.";
  if ([...sequence].some((letter) => !commands.includes(letter))) return "Este robot no puede girar como pide el programa.";
  return null;
}
