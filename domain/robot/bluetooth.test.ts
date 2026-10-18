import { describe, expect, it } from "vitest";
import { bluetoothProgramProblem, bluetoothRunFrame, parseBluetoothLine } from "./bluetooth";

describe("contrato Bluetooth Classic", () => {
  it("identifica el firmware y sus capacidades sin asumir retroceso ni giros sobre el centro", () => {
    expect(parseBluetoothLine("ROBO/1 ADZ ARC\r")).toEqual({ kind: "hello", commands: "ADZ", turns: "arc" });
    expect(parseBluetoothLine("ROBO/1 ARDZ PIVOT")).toEqual({ kind: "hello", commands: "ARDZ", turns: "pivot" });
    for (const line of ["ROBO/2 ADZ ARC", "ROBO/1 AX ARC", "ROBO/1 ADZ UNKNOWN", "ROBO/1 AA ARC", "HOLA"]) {
      expect(parseBluetoothLine(line)).toBeNull();
    }
  });

  it("correlaciona respuestas y no acepta líneas parciales ni ruido", () => {
    expect(parseBluetoothLine("STATUS abc-12 RUN")).toEqual({ kind: "status", id: "abc-12", reply: { kind: "RUN" } });
    expect(parseBluetoothLine("STATUS abc-12 ERR:REVERSE_UNSUPPORTED")).toEqual({
      kind: "status", id: "abc-12", reply: { kind: "ERR", code: "REVERSE_UNSUPPORTED" },
    });
    expect(parseBluetoothLine("PONG")).toEqual({ kind: "pong" });
    for (const line of ["STATUS abc-12", "STATUS x DONE extra", "STATUS x\nDONE", "STATUS ! RUN"]) {
      expect(parseBluetoothLine(line)).toBeNull();
    }
  });

  it("genera una sola trama validada por envío, sin permitir inyección ni exceso de pasos", () => {
    expect(bluetoothRunFrame("abc-12", "AADZ")).toBe("RUN abc-12 AADZ\n");
    for (const [id, text] of [["x\nSTOP", "A"], ["x", "A\nRUN"], ["", "A"], ["x", ""], ["x", "A".repeat(129)]]) {
      expect(() => bluetoothRunFrame(id!, text!)).toThrow();
    }
  });

  it("rechaza todo el programa si requiere un movimiento que el robot no puede realizar", () => {
    expect(bluetoothProgramProblem("ADRZ", "ADZ")).toMatch(/retroceder/);
    expect(bluetoothProgramProblem("AADZ", "ADZ")).toBeNull();
    expect(bluetoothProgramProblem("Z", "A")).toMatch(/girar/);
  });
});
