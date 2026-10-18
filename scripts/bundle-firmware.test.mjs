import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { bundleFirmware } from "./bundle-firmware.mjs";

test("el sketch copiado solo compila y ejecuta las funciones de sus cabeceras sin archivos vecinos", () => {
  const directory = mkdtempSync(join(tmpdir(), "robolab-bundle-"));
  try {
    const source = join(directory, "source");
    const copied = join(directory, "copied");
    mkdirSync(source); mkdirSync(copied);
    writeFileSync(join(source, "Config.h"), "#pragma once\nconstexpr int motorPin = 22;\n");
    writeFileSync(join(source, "Motor.h"), '#pragma once\n#include "Config.h"\nint avanzar() { return motorPin; }\n');
    writeFileSync(join(source, "robot.ino"), '#include "Config.h"\n#include "Motor.h"\n#include <cassert>\nint main() { assert(avanzar() == 22); }\n');
    const standalone = join(copied, "robot.cpp");
    writeFileSync(standalone, bundleFirmware(join(source, "robot.ino")));
    // El original ya no está disponible: el compilador no puede encontrar
    // accidentalmente Config.h o Motor.h en su directorio inicial.
    rmSync(source, { recursive: true });
    const binary = join(copied, process.platform === "win32" ? "robot.exe" : "robot");
    const compile = spawnSync(process.env.CXX || "g++", ["-std=c++17", "-Wall", "-Wextra", "-Werror", standalone, "-o", binary], { encoding: "utf8" });
    assert.equal(compile.status, 0, compile.error?.message ?? compile.stderr);
    const run = spawnSync(binary, [], { encoding: "utf8" });
    assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("una cabecera ausente falla al exportar, antes de entregar un sketch incompleto", () => {
  const directory = mkdtempSync(join(tmpdir(), "robolab-missing-header-"));
  try {
    const source = join(directory, "robot.ino");
    writeFileSync(source, '#include "Config.h"\n');
    assert.throws(() => bundleFirmware(source), /Config\.h/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
