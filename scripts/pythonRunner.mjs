import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const bundledPython = path.join(
  os.homedir(),
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "bin",
  "python3"
);

export function runPython(args, options = {}) {
  const python = fs.existsSync(bundledPython) ? bundledPython : "python3";
  const result = spawnSync(python, args, {
    encoding: "utf-8",
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `Python exited with ${result.status}`);
  }

  return result.stdout;
}
