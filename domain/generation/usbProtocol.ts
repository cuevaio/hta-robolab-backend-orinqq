/** Contrato de transporte, independiente del navegador, Node y las reglas de las misiones. */
export const JETSON_USB_VERSION = 1;
export const JETSON_USB_DEVICE = "robolab-jetson";
export const JETSON_USB_REQUEST_LIMIT = 16 * 1024;
export const JETSON_USB_RESPONSE_LIMIT = 512 * 1024;
export const JETSON_USB_HEARTBEAT_MS = 4000;
export const JETSON_USB_LEASE_MS = 15000;
export type JetsonUsbRequest = { v: 1; id: string; method: "hello" | "generate" | "ping" | "cancel"; params?: unknown };
export type JetsonUsbResponse = { v: 1; id: string } & ({ ok: true; result: unknown } | { ok: false; error: string });
