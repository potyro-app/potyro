import { describe, expect, it } from "vitest";
import { CAPABILITIES, buildReference, capabilityNotes, declarations, memberLine, splitReference } from "../src/reference.js";
import { readReferenceSources } from "../src/reference-files.js";
import { CAPABILITY_REFERENCE, SCHEMA_REFERENCE } from "../src/reference.generated.js";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_COMPACT, buildModifyMessage, buildUserMessage } from "../src/prompt.js";
import { LOOKUP_REFERENCE, lookupReference } from "../src/agent/discovery-tools.js";
import { FIELD_TYPES, VIEW_FIELDS } from "potyro";

// The model's reference is the schema's own type declarations, generated from
// `packages/schema/src/types`. The hand-written catalogue it replaces drifted from the schema (issue
// #130: `MapView.camera` existed and was validated, and the prompt said the map had no such option,
// so the model refused a request it could have met). These tests are the no-drift guarantee.

const sources = readReferenceSources();

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
    const split = splitReference(sources.core, sources.lookupOnly);
    expect(SCHEMA_REFERENCE).toBe(split.core);
    expect(CAPABILITY_REFERENCE).toEqual(split.capabilities);
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

  it("keeps the CORE within its budget — capabilities are read on demand (#341)", () => {
    // ~4 chars per token. Cached by every cloud backend, so the cost is paid once per prompt version.
    // NOT a model limit — current context windows are an order of magnitude larger. It is a cost and
    // attention guard: this prompt goes out with every generation, and everything in it is something
    // the model reads before it starts.
    //
    // Since #341 this guards the CORE only: defineApp, entities, fields, views, pages, the `ctx` every
    // app uses, the rules and the edit contract. It was 83,588 characters with every capability's
    // declarations in it, and had been raised five times in a week, once per capability. Now a
    // capability (ctx.caps.*, ctx.files, ctx.media, ctx.ui.share, ctx.views, ctx.format, ctx.space,
    // the languages detail) is one line of the CAPABILITIES index here, and its declarations come
    // through `lookup` and the passages beside a request that names it (src/reference.ts).
    //
    // So a NEW CAPABILITY DOES NOT RAISE THIS NUMBER: add it to `CAPABILITIES` (an index line, its
    // declarations, its cues) — the next test fails until it is reachable. Only a change to the
    // core itself (a field type, a view, a rule every app needs) may raise it, with a note here.
    // 75.6k at the split; the ceiling leaves ~1k for that.
    expect(SYSTEM_PROMPT.length).toBeLessThan(76_600);
  });

  it("is smaller than the full reference by what moved out, and the index names every capability", () => {
    expect(SYSTEM_PROMPT).toContain("CAPABILITIES —");
    for (const c of CAPABILITIES) expect(SYSTEM_PROMPT).toContain(`- \`${c.key}\` — `);
    for (const c of CAPABILITIES) expect(SYSTEM_PROMPT).toContain(`lookup("${c.key}")`);
    // What moved is not in the core: its declarations live in CAPABILITY_REFERENCE only.
    const core = new Set(declarations(SCHEMA_REFERENCE).map((d) => d.name));
    for (const c of CAPABILITIES) for (const d of c.declarations) expect(core.has(d), `${d} is still in the core`).toBe(false);
    expect(SCHEMA_REFERENCE).not.toMatch(memberLine("share"));
  });

  // History of the budget before #341, kept for the reasoning:
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
  // Raised 82.5k -> 83.6k on 2026-10-15 (docs/25) for `ctx.caps.camera.live`, the live camera a camera
  // toy draws from: `LiveCamera`, its options, stop and failure types, one comment each (~1k
  // characters). The last raise for a capability: #341 moves capability docs out of the prompt.


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

// #341: a capability left the prompt — it must still be one lookup (or one passage) away, and a new
// one can never silently vanish from the model's view.
describe("capabilities outside the core", () => {
  /** Every `ctx` path the schema declares: each member of Ctx, and the members of the interfaces those name, three deep. */
  function ctxPaths(): string[] {
    const decls = declarations(LOOKUP_REFERENCE);
    const members = (name: string): Array<{ name: string; line: string }> =>
      decls
        .filter((d) => d.name === name && /^export interface/m.test(d.text))
        .flatMap((d) => d.text.split("\n").slice(1))
        .map((line) => ({ line, m: /^ {2}(?:readonly\s+)?(\w+)\??\s*[:(<]/.exec(line) }))
        .filter((x): x is { line: string; m: RegExpExecArray } => x.m !== null)
        .map((x) => ({ name: x.m[1]!, line: x.line }));
    const out: string[] = [];
    const walk = (iface: string, prefix: string, depth: number): void => {
      for (const m of members(iface)) {
        const path = `${prefix}.${m.name}`;
        out.push(path);
        if (depth >= 3) continue;
        const next = [...m.line.replace(/^[^:(<]*/, "").matchAll(/\b([A-Z]\w+)\b/g)].map((x) => x[1]!).find((n) => /^(Ctx|Caps|.*Capability|CtxUi|Space)/.test(n) && decls.some((d) => d.name === n));
        if (next && !["Ctx"].includes(next)) walk(next, path, depth + 1);
      }
    };
    walk("Ctx", "ctx", 1);
    return [...new Set(out)];
  }

  it("finds the ctx members to check (sanity: the walk reaches the capabilities)", () => {
    const paths = ctxPaths();
    for (const p of ["ctx.query", "ctx.caps.camera", "ctx.caps.camera.live", "ctx.caps.ai.extract", "ctx.files.import", "ctx.ui.share", "ctx.ui.toast", "ctx.views.map", "ctx.format.date"]) expect(paths).toContain(p);
  });

  it("every ctx member is in the core, or indexed in the prompt AND resolved by lookup to its declaration", () => {
    const unreachable: string[] = [];
    for (const path of ctxPaths()) {
      const name = path.split(".").pop()!;
      const parent = path.split(".").slice(0, -1).join(".");
      const inCore = SCHEMA_REFERENCE.split("\n").some((l) => memberLine(name).test(l)) && !CAPABILITIES.some((c) => path === c.key || path.startsWith(`${c.key}.`) || parent === c.key);
      if (inCore) continue;
      // A container (`ctx.caps`) does not stand in for its members: `ctx.caps.nfc` needs its own line.
      const covers = (c: (typeof CAPABILITIES)[number]): boolean => path === c.key || (!c.container && path.startsWith(`${c.key}.`));
      const indexed = CAPABILITIES.some((c) => covers(c) && SYSTEM_PROMPT.includes(`lookup("${c.key}")`));
      // Its declaration: the member's own line, or — for a capability's index name — the whole capability.
      const answer = lookupReference(LOOKUP_REFERENCE, path);
      const key = CAPABILITIES.find((c) => c.key === path)?.key;
      const found = answer.split("\n").some((l) => memberLine(name).test(l)) || (key !== undefined && answer.includes(CAPABILITY_REFERENCE[key]!.trim()));
      if (!indexed || !found) unreachable.push(`${path} (indexed: ${indexed}, lookup: ${found})`);
    }
    expect(unreachable).toEqual([]);
  });

  it("lists only declarations the schema has, and claims every lookup-only declaration", () => {
    // splitReference throws on a name no type file declares — a rename must not leave an empty capability.
    expect(() => splitReference(sources.core, sources.lookupOnly)).not.toThrow();
    const claimed = new Set(CAPABILITIES.flatMap((c) => c.declarations));
    for (const d of declarations(buildReference(sources.lookupOnly))) expect(claimed.has(d.name), `${d.name} belongs to no capability`).toBe(true);
    for (const c of CAPABILITIES) if (c.declarations.length || c.members?.length) expect(CAPABILITY_REFERENCE[c.key]!.length).toBeGreaterThan(0);
  });

  it.each([
    ["ctx.caps.camera.live", ["live?(opts?: LiveCameraOptions): Promise<LiveCamera>", "export type LiveCameraOptions", "export interface LiveCamera"]],
    ["LiveCamera", ["export interface LiveCamera", "onFrame("]],
    ["Face", ["export interface Face {", "expressions: FaceExpressions"]],
    ["FaceExpressions", ["smile: number"]],
    ["AiShape", ["export type AiShape"]],
    ["ctx.caps.ai", ["export interface AiCapability", "extract<const S extends AiShape>", "Send only what the task needs"]],
    ["ctx.caps.ai.extract", ["export interface AiCapability", "export interface AiExtractRequest"]],
    ["ctx.files.import", ["export interface CtxFiles", "import(opts?:", "export interface FileInfo"]],
    ["ctx.files", ["export interface CtxFiles", "export interface FileInfo"]],
    ["ctx.ui.share", ["share(opts: { text?: Words; url?: string; title?: Words; app?: ShareAppLink }): Promise<boolean>;", "export interface ShareAppLink", "export interface PageLink"]],
    ["share", ["share(opts:"]],
    ["ctx.caps.network.socket", ["export interface Socket {", "onMessage(cb: (data: SocketData) => void): () => void;", "export interface Room extends Socket", "export type SocketFailure", "never reconnects by itself"]],
    ["ctx.caps.network.room", ["room(id?: string, opts?: RoomOptions): Promise<Room>;"]],
    ["ctx.caps.speech", ["export interface SpeechSession", "onText(cb: (text: string, final: boolean) => void): () => void;", "export type SpeechFailure", "listen(opts?: SpeechOptions): Promise<SpeechSession>;"]],
    ["SpeechSession", ["readonly result: Promise<string>;"]],
    ["Room", ["export interface Room extends Socket", "onPresence("]],
    ["ctx.caps.network", ["socket(url: string, opts?: SocketOptions): Promise<Socket>;"]],
    ["ctx.caps.geo", ["current(): Promise<{ lat: number; lng: number }>"]],
    ["ctx.caps.notifications.schedule", ["schedule(n: { id: string; at: Date; title: string; body?: string }): Promise<void>;"]],
    ["ctx.caps", ["export interface Caps", "ai?: AiCapability;"]],
    ["ctx.media", ["put(bytes: Blob): Promise<MediaRef>;"]],
    ["ctx.views", ["export interface CtxViews", "flyTo("]],
    ["ctx.format.date", ["export interface CtxFormat", "export interface FormatDateOptions"]],
    ["ctx.space", ["export interface Space", "invite(): Promise<string>;"]],
    ["languages", ["labels:", "ctx.t("]],
  ])("lookup(%j) answers with the real declaration and its doc comment", (query, expected) => {
    const out = lookupReference(LOOKUP_REFERENCE, query);
    expect(out).not.toMatch(/^Nothing in the potyro module/);
    for (const e of expected) expect(out).toContain(e);
  });

  it("every moved declaration is found by its own name, doc comment included", () => {
    for (const c of CAPABILITIES) {
      for (const name of c.declarations) {
        const out = lookupReference(LOOKUP_REFERENCE, name);
        expect(out, name).toMatch(new RegExp(`export (?:interface|type) ${name}\\b`));
        const own = declarations(CAPABILITY_REFERENCE[c.key]!).find((d) => d.name === name)!;
        expect(out, name).toContain(own.text.trim());
      }
    }
  });
});

describe("capabilityNotes: the passages beside a request (every engine, tools or not)", () => {
  it("brings the declarations of what a request names, with the ctx.caps guard rule", () => {
    const out = capabilityNotes(CAPABILITY_REFERENCE, "Scan my shop receipts and keep the items and prices");
    expect(out).toContain("export interface AiCapability");
    expect(out).toContain("export interface CameraCapability");
    expect(out).toContain("export interface Caps");
  });

  it("brings the live-connection declarations for a request for something live", () => {
    for (const ask of ["a live bitcoin price ticker", "a multiplayer drawing game with friends", "show my Home Assistant sensors in real time", "um placar ao vivo"]) {
      const out = capabilityNotes(CAPABILITY_REFERENCE, ask);
      expect(out, ask).toContain("export interface Socket {");
      expect(out, ask).toContain("export interface Caps");
    }
  });

  it("brings the voice declarations for a request to speak, in several languages", () => {
    for (const ask of ["a shopping list I can dictate to", "add items by voice", "speak a note and save it", "lista de compras por voz", "notatki głosowe", "Einkaufsliste per Sprache", "una lista que puedo dictar", "appunti a voce"]) {
      const out = capabilityNotes(CAPABILITY_REFERENCE, ask);
      expect(out, ask).toContain("export interface SpeechSession");
      expect(out, ask).toContain("export interface Caps");
    }
  });

  it("matches the app being changed by its code, not by its words", () => {
    expect(capabilityNotes(CAPABILITY_REFERENCE, "add a due date", "const r = await ctx.caps.ai.extract({ schema })")).toContain("export interface AiCapability");
    // A label that says "share" is not a use of ctx.ui.share.
    expect(capabilityNotes(CAPABILITY_REFERENCE, "add a due date", 'label: "Share of rent"')).toBe("");
  });

  it("says nothing for a request that needs no capability", () => {
    expect(capabilityNotes(CAPABILITY_REFERENCE, "a todo list with due dates")).toBe("");
    expect(buildUserMessage({ id: "t", description: "a todo list with due dates" })).not.toContain("The declarations of the capabilities");
  });

  it("reaches the one-shot turns, and not the on-device ones", () => {
    expect(buildUserMessage({ id: "t", description: "a selfie mirror that finds my face" })).toContain("export interface Face {");
    expect(buildUserMessage({ id: "t", description: "a selfie mirror that finds my face" }, { capabilities: false })).not.toContain("export interface Face {");
    expect(buildModifyMessage("let me share the list", undefined, {})).toContain("share(opts:");
    expect(buildModifyMessage("add a field", undefined, { source: "await ctx.files.text(n.doc)" })).toContain("export interface CtxFiles");
  });
});
