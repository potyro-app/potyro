import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REFERENCE_FILES, buildReference } from "../src/reference.js";
import { SCHEMA_REFERENCE } from "../src/reference.generated.js";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_COMPACT } from "../src/prompt.js";
import { FIELD_TYPES, VIEW_FIELDS } from "karta";

// The model's reference is the schema's own type declarations, generated from
// `packages/schema/src/types`. The hand-written catalogue it replaces drifted from the schema (issue
// #130: `MapView.camera` existed and was validated, and the prompt said the map had no such option,
// so the model refused a request it could have met). These tests are the no-drift guarantee.

const schemaTypesDir = fileURLToPath(new URL("../../schema/src/types/", import.meta.url));

function readSources(): Record<string, string> {
  return Object.fromEntries(REFERENCE_FILES.map((f) => [f, readFileSync(schemaTypesDir + f, "utf8")]));
}

describe("buildReference", () => {
  it("drops import lines and keeps the declarations with their doc comments", () => {
    const out = buildReference({
      "a.ts": ['import type { X } from "./x.js";', "", "/** The camera. */", "export type Camera = X;"].join("\n"),
    });
    expect(out).not.toContain("import type");
    expect(out).toContain("/** The camera. */");
    expect(out).toContain("export type Camera = X;");
  });

  it("labels each file so a declaration can be cited by where it lives", () => {
    const out = buildReference({ "core.ts": "export type Id = string;", "app.ts": "export type A = 1;" });
    expect(out.indexOf("// ===== core.ts")).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("// ===== core.ts")).toBeLessThan(out.indexOf("// ===== app.ts"));
  });
});

describe("SCHEMA_REFERENCE", () => {
  it("is up to date with packages/schema/src/types (run `pnpm --filter @karta/generator gen:reference`)", () => {
    expect(SCHEMA_REFERENCE).toBe(buildReference(readSources()));
  });

  it("covers the declarations the model needs", () => {
    for (const name of ["interface AppDefinition", "interface MapView", "type MapCamera", "interface FilterChip", "interface Ctx", "type Field ="]) {
      expect(SCHEMA_REFERENCE).toContain(name);
    }
  });
});

describe("SYSTEM_PROMPT", () => {
  it("carries the generated reference rather than a hand-written catalogue", () => {
    expect(SYSTEM_PROMPT).toContain(SCHEMA_REFERENCE);
    // The old catalogue's signature line. If it is back, the reference is not the source of truth.
    expect(SYSTEM_PROMPT).not.toContain("EACH VIEW TYPE HAS REQUIRED OPTIONS");
  });

  it("stays within a cloud model's system-prompt budget", () => {
    // ~4 chars per token. Cached by every cloud backend, so the cost is paid once per prompt version.
    expect(SYSTEM_PROMPT.length).toBeLessThan(60_000);
  });

  it("tells the model the exact things the catalogue got wrong (#130)", () => {
    // The map can be positioned.
    expect(SYSTEM_PROMPT).toContain("camera?: Dynamic<MapCamera>");
    // Filter chips can draw their options from an entity's records, not only from an enum.
    expect(SYSTEM_PROMPT).toMatch(/from.*name.*entity/i);
    // Params are per page, so one selection cannot filter every page.
    expect(SYSTEM_PROMPT).toMatch(/params[^.]*per page/i);
  });
});

describe("SYSTEM_PROMPT_COMPACT (on-device models)", () => {
  it("lists every view option the validator knows, so it cannot drift either", () => {
    for (const [type, fields] of Object.entries(VIEW_FIELDS)) {
      expect(SYSTEM_PROMPT_COMPACT).toContain(`\`${type}\`  { ${fields.join(", ")} }`);
    }
    for (const t of FIELD_TYPES) expect(SYSTEM_PROMPT_COMPACT).toContain(t);
    expect(SYSTEM_PROMPT_COMPACT).toContain("camera?");
  });

  it("fits a 4k-context model alongside the request and the reply", () => {
    expect(SYSTEM_PROMPT_COMPACT).not.toContain(SCHEMA_REFERENCE);
    expect(SYSTEM_PROMPT_COMPACT.length).toBeLessThan(SYSTEM_PROMPT.length / 2);
  });

  it("keeps every judgement rule the full prompt has", () => {
    for (const rule of ["RESOLVED", "ctx.increment", "SIZE BUDGET", "CHANGING AN APP THAT ALREADY HAS DATA", "EXAMPLE 1"]) {
      expect(SYSTEM_PROMPT_COMPACT).toContain(rule);
    }
  });
});
