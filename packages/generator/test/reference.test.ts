import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REFERENCE_FILES, buildReference } from "../src/reference.js";
import { SCHEMA_REFERENCE } from "../src/reference.generated.js";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_COMPACT } from "../src/prompt.js";
import { FIELD_TYPES, VIEW_FIELDS } from "potyro";

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
  it("is up to date with packages/schema/src/types (run `pnpm --filter @potyro/generator gen:reference`)", () => {
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
    // NOT a model limit — current context windows are an order of magnitude larger. It is a cost and
    // attention guard: this prompt goes out with every generation, and everything in it is something
    // the model reads before it starts.
    //
    // Raised 60k -> 65k with the board, stats and timeline views (#107, #109, #110): the reference is
    // generated from the types, and each view the model can build is text it has to read. Cutting
    // what it reads about existing features instead would trade a cached ~1k tokens for worse apps.
    //
    // Raised 65k -> 70k on 2026-09-16 (#66). The money field landed with ~400 characters of headroom
    // left, so the next field type would have been decided by the budget rather than by whether apps
    // need it. Trimming had already been taken as far as it should go: the `money`, `editableBy` and
    // `permissions.sync` comments are one line plus a pointer to docs/03 and docs/07, which is where
    // the reasoning belongs anyway. The next raise should come with the same kind of note — and if
    // the prompt ever approaches 100k, the answer is not a bigger number but splitting the reference
    // so a generation reads the views it is actually using.
    //
    // Raised 70k -> 72k on 2026-09-20 (#216), for three things the model could not do at all before:
    // a page's own buttons (`Page.actions`), reaching a view that is on screen (`ctx.views`), and
    // chips that take a typed value — which is how an app gets SEARCH. Trimming instead was tried
    // first and is what the budget was buying: the cuts landed on the examples that show the model
    // how to USE these, which is the documentation that decides whether a capability gets reached
    // for at all. ~500 cached tokens against apps that can be searched.
    //
    // Raised 72k -> 75k on 2026-10-11 (#252) for the app's own folder: `ctx.files`, `FileInfo`,
    // `FileRef` and the `file` field, without which the model cannot build an app that keeps
    // documents, ships a data file or imports anything. Their comments were cut to one line each
    // first (from ~3.9k to ~2.3k characters); what is left is the API itself. ~600 cached tokens.
    //
    // Raised 75k -> 80k on 2026-10-13 (#302) for an app's words in several languages: `Words` at every
    // slot that shows text, `language`/`languages`, option `labels`, `ctx.locale`/`t`/`format`, and
    // the LANGUAGES rules (write in the person's language; add one only when asked, with `translate`;
    // a translation never moves `schemaVersion`). Trimmed first: every new comment is one line, and
    // `Localized` (what views read) left the reference. ~1.2k cached tokens.
    //
    // Raised 80k -> 81k on 2026-10-14 (#254) for how an app USES its folder: a `file` field is a
    // pointer read with `ctx.files.text`, `null` means not on this device yet, starting data is a
    // shipped JSON. The API is in the reference already (#252); these ~450 characters are the rules
    // the reference cannot say, cut to three lines first. ~120 cached tokens.
    //
    // Raised 81k -> 82.5k on 2026-10-15 (#213, docs/23) for `ctx.caps.ai`: the shape an app reads a photo
    // into, the picture types and the two calls, plus one example line, which is what makes a receipt
    // or a poster app buildable at all. Trimmed first: every comment is one line, and the answer's
    // inferred type (`AiValue`) lives in infer.ts, outside the reference. ~400 cached tokens.
    expect(SYSTEM_PROMPT.length).toBeLessThan(82_500);
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
