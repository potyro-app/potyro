// Where is the `claude` CLI, if anywhere?
//
// Its own module, with no imports, because two very different places need the answer and neither
// should have to pull a model backend in to get it: the eval harness, which should refuse a run
// rather than fail on the first call, and the browser spec that drives a real generation, which
// should SKIP rather than sit through a five-and-a-half-minute timeout to discover the same thing.
// A machine without the CLI is the ordinary case — CI, a fresh checkout, this repo on Windows — and
// "no `claude` on PATH" is a sentence a test run should be able to print in the first second.
//
// It resolves the PATH rather than answering yes/no because on Windows the two are not the same
// question. The shim there is `claude.cmd`, and knowing that is what stops the backend spawning it
// in a way Node refuses — see `spawnCli` in `cli-backend.ts`.

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** The path the CLI would actually run from, or null when nothing on PATH matches. */
export function resolveCli(bin = "claude"): string | null {
  if (bin.includes("/") || bin.includes("\\")) return existsSync(bin) ? bin : null;
  // On Windows the executable is `claude.cmd` (or `.exe`); `""` is still tried, because a bare
  // extensionless shim on PATH is what a Git-Bash install leaves behind.
  const exts = process.platform === "win32" ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function claudeCliAvailable(bin = "claude"): boolean {
  return resolveCli(bin) !== null;
}
