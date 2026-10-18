import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "robolab-firmware-"));
const binary = join(directory, process.platform === "win32" ? "bluetooth.exe" : "bluetooth");
try {
  for (const [command, args] of [
    [process.env.CXX || "g++", ["-std=c++17", "-Wall", "-Wextra", "-Werror", "firmware/tests/bluetooth.cpp", "-o", binary]],
    [binary, []],
  ]) {
    const result = spawnSync(command, args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
    if (process.exitCode) break;
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
