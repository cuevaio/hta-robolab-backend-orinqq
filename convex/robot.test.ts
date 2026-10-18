import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { move, repeat } from "../domain/game/program";
import { api, internal } from "./_generated/api";
import { PAIRING_TTL_MS, STALE_MS } from "./robot";
import schema from "./schema";
import { modules } from "./test.setup";

const F = move("FORWARD");
// Avanzar, avanzar, girar a la izquierda, girar a la derecha, repetir 2 avanzar.
const PROGRAM = [F, F, move("TURN_LEFT"), move("TURN_RIGHT"), repeat(2, [F])];

afterEach(() => {
  vi.useRealTimers();
});

async function withRobot() {
  const t = convexTest(schema, modules);
  const robot = await t.mutation(internal.robot.register, { name: "Robi" });
  const headers = { "X-Clave": robot.key };
  const next = (query = "") => t.fetch(`/robot/siguiente${query}`, { headers });
  const reply = (body: string) => t.fetch("/robot/estado", { method: "POST", headers, body });
  const status = () => t.query(api.robot.status, { code: robot.code });
  return { t, robot, headers, next, reply, status };
}

describe("robot por wifi: lo que pide el contrato", () => {
  it("se registra con un código de emparejamiento y una clave solo para el firmware", async () => {
    const { robot } = await withRobot();
    expect(robot.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(robot.key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("el equipo puede ver el código vigente de cada robot desde la consola, sin la clave", async () => {
    const { t, robot } = await withRobot();
    const list = await t.query(internal.robot.list, {});
    expect(list).toEqual([
      expect.objectContaining({ name: "Robi", code: robot.code, vigente: true, conectado: false }),
    ]);
    expect(JSON.stringify(list)).not.toContain(robot.key);
    expect(list[0]!.venceEn).toMatch(/^1[12] h/);
  });

  it("el equipo puede renombrar un robot desde la consola sin cambiar su clave ni su código", async () => {
    const t = convexTest(schema, modules);
    const robot = await t.mutation(internal.robot.register, { name: "Kusi" });
    expect(await t.mutation(internal.robot.rename, { from: "Kusi", to: " Robi " })).toEqual({ renamed: 1 });
    expect(await t.query(internal.robot.list, {})).toEqual([expect.objectContaining({ name: "Robi", code: robot.code })]);
    expect((await t.fetch("/robot/siguiente", { headers: { "X-Clave": robot.key } })).status).toBe(204); // la misma clave sigue entrando
    expect(await t.mutation(internal.robot.rename, { from: "Nadie", to: "Robi" })).toEqual({ renamed: 0 });
    await expect(t.mutation(internal.robot.rename, { from: "Robi", to: "   " })).rejects.toThrow(/nombre/);
  });

  it("el robot recibe AADZAA sin espacios ni saltos, y la web ve OK, RUN y DONE", async () => {
    const { t, robot, next, reply, status } = await withRobot();
    const sent = await t.mutation(api.robot.send, { code: robot.code.toLowerCase(), program: PROGRAM, requestId: "envio-1" });
    expect(sent).toMatchObject({ letters: "AADZAA", robotName: "Robi", duplicate: false });

    const res = await next();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("AADZAA");
    expect(res.headers.get("X-Id")).toBeTruthy();
    expect((await status())?.lastCommand?.status).toBe("sent");

    for (const [message, expected] of [
      ["OK", "received"],
      ["RUN", "running"],
      ["DONE\n", "done"],
    ] as const) {
      expect((await reply(message)).status).toBe(200);
      expect((await status())?.lastCommand?.status).toBe(expected);
    }
    expect((await next()).status).toBe(204);
  });

  it("también entrega el programa como arreglo o como JSON", async () => {
    const { t, robot, next } = await withRobot();
    await t.mutation(api.robot.send, { code: robot.code, program: PROGRAM });
    const res = await next("?formato=array");
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual(["A", "A", "D", "Z", "A", "A"]);
  });

  it("si hay un programa en curso, el segundo responde BUSY", async () => {
    const { t, robot, next, reply } = await withRobot();
    await t.mutation(api.robot.send, { code: robot.code, program: [F] });
    await expect(t.mutation(api.robot.send, { code: robot.code, program: PROGRAM })).rejects.toThrow(/haciendo otro programa/);
    await next();
    await reply("DONE");
    await expect(t.mutation(api.robot.send, { code: robot.code, program: PROGRAM })).resolves.toMatchObject({ letters: "AADZAA" });
  });

  it("reenviar el mismo envío (mismo id) no lo ejecuta dos veces, ni después de DONE", async () => {
    const { t, robot, next, reply } = await withRobot();
    await t.mutation(api.robot.send, { code: robot.code, program: PROGRAM, requestId: "play-7" });
    expect(await t.mutation(api.robot.send, { code: robot.code, program: PROGRAM, requestId: "play-7" })).toMatchObject({
      duplicate: true,
    });
    expect(await (await next()).text()).toBe("AADZAA");
    await reply("DONE");
    expect(await t.mutation(api.robot.send, { code: robot.code, program: PROGRAM, requestId: "play-7" })).toMatchObject({
      duplicate: true,
    });
    expect((await next()).status).toBe(204);
  });

  it("un robot que no responde deja de bloquear al rato", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { t, robot } = await withRobot();
    await t.mutation(api.robot.send, { code: robot.code, program: [F] });
    vi.setSystemTime(Date.now() + STALE_MS + 1000);
    await expect(t.mutation(api.robot.send, { code: robot.code, program: PROGRAM })).resolves.toMatchObject({ letters: "AADZAA" });
  });

  it("el código vence; el robot obtiene el nuevo y solo ese sirve", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { t, robot, headers } = await withRobot();
    const current = await t.fetch("/robot/codigo", { headers });
    expect(await current.text()).toBe(robot.code);
    expect(Number(current.headers.get("X-Vence-En"))).toBeGreaterThan(0);

    vi.setSystemTime(Date.now() + PAIRING_TTL_MS + 1000);
    await expect(t.mutation(api.robot.send, { code: robot.code, program: PROGRAM })).rejects.toThrow(/código del robot cambió/);
    const renewed = await (await t.fetch("/robot/codigo", { headers })).text();
    expect(renewed).not.toBe(robot.code);
    await expect(t.mutation(api.robot.send, { code: renewed, program: PROGRAM })).resolves.toMatchObject({ letters: "AADZAA" });
  });

  it("el robot puede avisar un error y la web lo ve", async () => {
    const { t, robot, next, reply, status } = await withRobot();
    await t.mutation(api.robot.send, { code: robot.code, program: PROGRAM });
    await next();
    expect((await reply("ERR:MOTOR")).status).toBe(200);
    expect((await status())?.lastCommand).toMatchObject({ status: "failed", error: "MOTOR" });
    expect((await reply("HOLA")).status).toBe(400);
  });

  it("sin la clave correcta el robot no recibe ni responde nada", async () => {
    const { t, robot, next } = await withRobot();
    await t.mutation(api.robot.send, { code: robot.code, program: PROGRAM });
    const wrong = { "X-Clave": "0".repeat(32) };
    expect((await t.fetch("/robot/siguiente", { headers: wrong })).status).toBe(401);
    expect((await t.fetch("/robot/estado", { method: "POST", headers: wrong, body: "DONE" })).status).toBe(401);
    expect((await t.fetch("/robot/codigo")).status).toBe(401);
    expect((await next()).status).toBe(200); // el programa sigue esperando a su robot
  });

  it("avisa si el código no existe o el programa no sirve para el robot", async () => {
    const { t, robot } = await withRobot();
    await expect(t.mutation(api.robot.send, { code: "ZZZZZZ", program: PROGRAM })).rejects.toThrow(/No encontramos/);
    await expect(t.mutation(api.robot.send, { code: robot.code, program: [] })).rejects.toThrow(/vacío/);
    await expect(t.mutation(api.robot.send, { code: robot.code, program: [repeat(9, [repeat(9, [F, F])])] })).rejects.toThrow(/128/);
    expect(await t.query(api.robot.status, { code: "ZZZZZZ" })).toBeNull();
  });
});

describe("robot por wifi: rutas para otras webs", () => {
  const origin = "http://localhost:5173";
  const post = (t: Awaited<ReturnType<typeof withRobot>>["t"], body: unknown, from = origin) =>
    t.fetch("/robot/web/enviar", { method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("valida la secuencia: AXA es BAD_CHAR y más de 128 letras es TOO_LONG", async () => {
    const { t, robot } = await withRobot();
    const bad = await post(t, { codigo: robot.code, secuencia: "AXA", id: "a" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ estado: "ERR:BAD_CHAR" });
    expect(await (await post(t, { codigo: robot.code, secuencia: "A".repeat(129), id: "b" })).json()).toEqual({ estado: "ERR:TOO_LONG" });
  });

  it("encola, responde BUSY al segundo y muestra el avance del robot", async () => {
    const { t, robot, next, reply } = await withRobot();
    const first = await post(t, { codigo: robot.code, secuencia: "AADZAA", id: "web-1" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ estado: "EN_COLA", id: "web-1" });
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe(origin);

    const second = await post(t, { codigo: robot.code, secuencia: "A", id: "web-2" });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ estado: "ERR:BUSY" });

    await next();
    await reply("OK");
    const state = await t.fetch(`/robot/web/estado?codigo=${robot.code}&id=web-1`, { headers: { Origin: origin } });
    expect(await state.json()).toMatchObject({ estado: "OK", conectado: true, secuencia: "AADZAA", robot: "Robi" });
  });

  it("responde la verificación previa de CORS solo a orígenes permitidos", async () => {
    const { t } = await withRobot();
    const ok = await t.fetch("/robot/web/enviar", { method: "OPTIONS", headers: { Origin: origin } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Methods")).toMatch(/POST/);
    const other = await t.fetch("/robot/web/enviar", { method: "OPTIONS", headers: { Origin: "https://otro-sitio.example" } });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
