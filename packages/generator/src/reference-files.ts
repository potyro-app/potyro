// The reference's sources, read from the repository (Node only — the build script and the staleness
// test). Which files count is decided in reference.ts; this only reads them.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOOKUP_ONLY_FILES, REFERENCE_FILES } from "./reference.js";

const TYPES_DIR = fileURLToPath(new URL("../../schema/src/types/", import.meta.url));

const read = (files: readonly string[]): Record<string, string> => Object.fromEntries(files.map((f) => [f, readFileSync(TYPES_DIR + f, "utf8")]));

export function readReferenceSources(): { core: Record<string, string>; lookupOnly: Record<string, string> } {
  return { core: read(REFERENCE_FILES), lookupOnly: read(LOOKUP_ONLY_FILES) };
}
