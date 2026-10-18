import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Incorpora las cabeceras locales una vez; las librerías de Arduino se conservan. */
export function bundleFirmware(entry) {
  const included = new Set();
  function expand(file) {
    const absolute = resolve(file);
    if (included.has(absolute)) return "";
    included.add(absolute);
    return readFileSync(absolute, "utf8").replace(/\r\n/g, "\n").split("\n").map((line) => {
      if (/^\s*#pragma\s+once\s*$/.test(line)) return "";
      const local = /^\s*#include\s+"([^"]+)"\s*(?:\/\/.*)?$/.exec(line);
      if (!local) return line;
      return `// ---- ${local[1]} integrado ----\n${expand(resolve(dirname(absolute), local[1]))}`;
    }).join("\n");
  }
  return "// RoboLab completo en un archivo: motores, ojos, luces, sonidos y Bluetooth Classic.\n" +
    "// Se puede copiar como robi/robi.ino. No necesita cabeceras locales.\n" +
    "// Exportado con npm run firmware:bundle desde firmware/robolab_bluetooth.\n\n" + expand(entry);
}

const script = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === script) {
  const root = resolve(dirname(script), "..");
  const output = resolve(root, "firmware/robi/robi.ino");
  const bundled = bundleFirmware(resolve(root, "firmware/robolab_bluetooth/robolab_bluetooth.ino"));
  if (process.argv.includes("--check")) {
    if (!existsSync(output) || readFileSync(output, "utf8") !== bundled) {
      throw new Error("El sketch completo está desactualizado. Ejecuta npm run firmware:bundle.");
    }
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, bundled);
    console.log("Sketch completo: firmware/robi/robi.ino");
  }
}
