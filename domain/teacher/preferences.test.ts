import { describe, expect, it } from "vitest";
import { cleanTeacherPreference, PREFERENCE_MAX } from "./preferences";

describe("preferencias del docente", () => {
  it("limpia espacios y caracteres invisibles", () => {
    expect(cleanTeacherPreference("  Historias de​ animales\n y tableros   pequeños ")).toEqual({
      ok: true,
      text: "Historias de animales y tableros pequeños",
    });
  });

  it("pide un largo razonable", () => {
    expect(cleanTeacherPreference("corto")).toMatchObject({ ok: false });
    expect(cleanTeacherPreference("a".repeat(PREFERENCE_MAX + 1))).toMatchObject({ ok: false, reason: /máximo 300/ });
    expect(cleanTeacherPreference("á".repeat(PREFERENCE_MAX))).toMatchObject({ ok: true });
  });

  it("rechaza correos, teléfonos y documentos", () => {
    for (const text of ["Escríbeme a rosa@colegio.pe", "Llamar al 987 654 321 antes", "Usa el DNI de cada alumno"]) {
      expect(cleanTeacherPreference(text)).toMatchObject({ ok: false, reason: /sin correos/ });
    }
  });
});
