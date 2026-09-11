// The model's reference is the schema, verbatim.
//
// A hand-written summary of what an app can declare drifts from the schema the moment someone adds
// an option and forgets the prompt — and every gap is a refusal that only a prompt edit can fix
// (#130: `MapView.camera` was validated for weeks while the prompt said the map could not be
// positioned). So the reference is GENERATED from `packages/schema/src/types`: the declarations
// with their doc comments, minus the import lines, which mean nothing to a reader without a
// module graph. `scripts/build-reference.ts` writes `reference.generated.ts`; a test regenerates
// and compares, so a schema change without a regeneration fails CI instead of quietly narrowing
// what the model believes is possible.

/** The type files, in reading order: primitives, then fields, then `ctx`, then the app shape. */
export const REFERENCE_FILES = ["core.ts", "fields.ts", "ctx.ts", "app.ts", "runtime.ts"] as const;

const IMPORT_LINE = /^import\s.*$/gm;

/** Join the type sources into one reference text, file by file, imports removed. */
export function buildReference(sources: Readonly<Record<string, string>>): string {
  const parts: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const body = text.replace(IMPORT_LINE, "").replace(/\n{3,}/g, "\n\n").trim();
    parts.push(`// ===== ${file} =====\n${body}`);
  }
  return parts.join("\n\n");
}
