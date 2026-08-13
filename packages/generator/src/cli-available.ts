// Is the `claude` CLI on PATH?
//
// Its own module, with no imports, because two very different places need the answer and neither
// should have to pull a model backend in to get it: the eval harness, which should refuse a run
// rather than fail on the first call, and the browser spec that drives a real generation, which
// should SKIP rather than sit through a five-and-a-half-minute timeout to discover the same thing.
// A machine without the CLI is the ordinary case — CI, a fresh checkout, this repo on Windows — and
// "no `claude` on PATH" is a sentence a test run should be able to print in the first second.

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export function claudeCliAvailable(bin = "claude"): boolean {
  if (bin.includes("/") || bin.includes("\\")) return existsSync(bin);
  // On Windows the executable is `claude.cmd` (or `.exe`); `""` is still tried, because a bare
  // extensionless shim on PATH is what a Git-Bash install leaves behind.
  const exts = process.platform === "win32" ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")] : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((ext) => existsSync(join(dir, bin + ext))));
}
