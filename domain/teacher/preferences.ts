/**
 * Preferencias que el docente guarda para el asistente de misiones, por ejemplo
 * «mis grupos prefieren historias de animales y tableros pequeños». Son del
 * docente sobre sus clases, nunca datos de un alumno. El formulario y el
 * servidor usan esta misma revisión.
 */

export const PREFERENCE_MIN = 10;
export const PREFERENCE_MAX = 300;

export type PreferenceCheck = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

/** Bloqueo básico de identificadores evidentes (correo, teléfono, documento), no un detector completo de datos personales. */
export function hasPersonalIdentifiers(text: string): boolean {
  return /\S+@\S+\.\S+|\d[\d\s-]{6,}\d|\b(?:DNI|pasaporte)\b/i.test(text);
}

export function cleanTeacherPreference(raw: string): PreferenceCheck {
  const text = raw
    .normalize("NFC")
    .replace(/[\p{Cf}\p{Cc}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const length = [...text].length;
  if (length < PREFERENCE_MIN) return { ok: false, reason: `Escribe al menos ${PREFERENCE_MIN} letras.` };
  if (length > PREFERENCE_MAX) return { ok: false, reason: `Muy largo: máximo ${PREFERENCE_MAX} letras.` };
  if (hasPersonalIdentifiers(text)) {
    return { ok: false, reason: "Escribe solo cómo te gusta trabajar, sin correos, teléfonos ni documentos." };
  }
  return { ok: true, text };
}
