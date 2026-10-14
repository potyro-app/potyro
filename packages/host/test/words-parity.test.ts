// `ctx.locale`, `ctx.t` and `ctx.format` read the same at both provenances (#302, docs/20 §2.3).
//
// ONE app source — plain ES2020, so it runs unchanged in the sealed box — is run directly (as the
// person's own app) and in the QuickJS isolate (as a shared one). Every row of the table is a
// computed; the two runners must give the same string for every row, in two languages. A row that
// should fail must fail in both, with the same words.

import { describe, expect, it } from "vitest";
import { newAsyncContext } from "quickjs-emscripten";
import { defineApp, type AppInput, type Ctx } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, FORMAT_LIMITS, hostPure, PURE_OK, type LoadedApp, type MakeCtxBase, type UiBridge } from "../src/index.js";
import { createIsolateLoader, type QuickJSAsyncContextLike } from "../src/isolate/index.js";

const NOW = new Date("2026-10-13T10:00:00Z");

/** label → the body of `(r, ctx) => …`. Kept to ES2020: the same text runs in the box. */
const TABLE: Record<string, string> = {
  locale: "ctx.locale",
  formatLocale: "ctx.format.locale",
  tMap: 'ctx.t({ en: "Due now", pl: "Do podlania" })',
  tPlain: 'ctx.t("Same everywhere")',
  tMissing: 'ctx.t({ en: "Only English" })',
  tPlural1: 'ctx.t({ en: "{n, plural, one {# plant} other {# plants}}", pl: "{n, plural, one {# roślina} few {# rośliny} many {# roślin} other {# rośliny}}" }, { n: 1 })',
  tPlural2: 'ctx.t({ en: "{n, plural, one {# plant} other {# plants}}", pl: "{n, plural, one {# roślina} few {# rośliny} many {# roślin} other {# rośliny}}" }, { n: 2 })',
  tPlural5: 'ctx.t({ en: "{n, plural, one {# plant} other {# plants}}", pl: "{n, plural, one {# roślina} few {# rośliny} many {# roślin} other {# rośliny}}" }, { n: 5 })',
  tVar: 'ctx.t({ en: "Water {name}", pl: "Podlej: {name}" }, { name: r.name })',
  tDateVar: 'ctx.t({ en: "On {d, date, long}", pl: "Dnia {d, date, long}" }, { d: new Date("2026-03-01T12:00:00Z") })',
  date: 'ctx.format.date(new Date("2026-10-13T10:00:00Z"))',
  dateLong: 'ctx.format.date("2026-10-13T10:00:00Z", { dateStyle: "long" })',
  dateParts: 'ctx.format.date(Date.UTC(2026, 9, 13, 10), { weekday: "long", day: "numeric", month: "long" })',
  dateTimeZoneIgnored: 'ctx.format.date("2026-10-13T10:00:00Z", { dateStyle: "long", timeZone: "Pacific/Kiritimati" })',
  number: "ctx.format.number(1234.5)",
  percent: 'ctx.format.number(0.256, { style: "percent", maximumFractionDigits: 1 })',
  unit: 'ctx.format.number(3, { style: "unit", unit: "kilogram" })',
  sign: 'ctx.format.number(2, { signDisplay: "always" })',
  money: 'ctx.format.money(4200, "EUR")',
  moneyYen: 'ctx.format.money(500, "JPY")',
  moneyDefault: "ctx.format.money(199)",
  relDays: 'ctx.format.relative(new Date(ctx.now().getTime() + 3 * 86400000))',
  relHoursAgo: 'ctx.format.relative(new Date(ctx.now().getTime() - 2 * 3600000))',
  relTomorrow: 'ctx.format.relative(new Date(ctx.now().getTime() + 86400000), { unit: "day" })',
  relAlways: 'ctx.format.relative(new Date(ctx.now().getTime() + 86400000), { unit: "day", numeric: "always" })',
  list: 'ctx.format.list(["milk", "eggs", "bread"])',
  listOr: 'ctx.format.list(["tea", "coffee"], { type: "disjunction" })',
  // These must fail, the same way, at both provenances.
  badDateOption: 'ctx.format.date(ctx.now(), { dateStyle: "huge" })',
  notADate: 'ctx.format.date("yesterday-ish")',
  badMessage: 'ctx.t({ en: "{n, plural, one {x}", pl: "{n, plural, one {x}" }, { n: 1 })',
  hugeList: `ctx.format.list(new Array(${FORMAT_LIMITS.listItems + 1}).fill("x"))`,
};

const computed = Object.entries(TABLE)
  .map(([key, body]) => `${key}: function(r, ctx){ return ${body}; }`)
  .join(",\n");

const APP = `({
  id: "words", name: { en: "Plants", pl: "Rośliny" }, version: "1.0.0", schemaVersion: 1,
  language: "en", languages: ["en", "pl"],
  entities: { plant: { label: { en: "Plant", pl: "Roślina" }, fields: { name: { type: "text" } }, computed: { ${computed} },
    actions: { hello: async function(r, ctx){ ctx.ui.toast({ en: "Watered " + r.name, pl: "Podlano: " + r.name }); } } } },
  pages: [{ id: "all", title: { en: "All", pl: "Wszystkie" }, view: { type: "list", entity: "plant" } }]
})`;

function newContext(): Promise<QuickJSAsyncContextLike> {
  return newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike>;
}

interface Runner {
  loaded: LoadedApp;
  ctx: Ctx;
  toasts: string[];
}

async function run(kind: "direct" | "isolate", language: string, formatLocale: string): Promise<Runner> {
  const store = new MemoryStore();
  await store.open("words");
  const toasts: string[] = [];
  const ui: UiBridge = { toast: (m) => void toasts.push(m), confirm: async () => true, prompt: async () => null, pick: async () => null };
  const host = createHost({ loadIsolated: createIsolateLoader({ store, newContext }) });
  const loaded =
    kind === "direct"
      ? await host.load({ kind: "module", app: defineApp(new Function(`return ${APP};`)() as AppInput) })
      : await host.load({ kind: "bundle", code: `globalThis.__potyroApp = ${APP};`, provenance: "untrusted" });
  const base: MakeCtxBase = { store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} }, now: NOW, language, formatLocale };
  return { loaded, ctx: host.makeCtx(loaded, base), toasts };
}

const RECORD = { id: "p1", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), name: "Monstera" };

async function table(r: Runner): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(TABLE)) {
    try {
      out[key] = String(await r.loaded.callComputed("plant", key, RECORD, r.ctx));
    } catch (e) {
      // The isolate prefixes its errors; the words after it are what must match.
      out[key] = `ERROR ${String(e instanceof Error ? e.message : e).replace(/^isolate app error: /, "")}`;
    }
  }
  return out;
}

describe("ctx.t and ctx.format — DirectHost and IsolateHost agree (docs/20 §2.3)", () => {
  for (const [language, formatLocale] of [["pl", "pl-PL"], ["en", "en-GB"]] as const) {
    it(`gives the same answer for every row, in ${language} (${formatLocale})`, async () => {
      const direct = await run("direct", language, formatLocale);
      const boxed = await run("isolate", language, formatLocale);
      const [a, b] = [await table(direct), await table(boxed)];
      expect(b).toEqual(a);
      boxed.loaded.dispose();

      // And the answers are the right ones, not merely the same.
      expect(a.locale).toBe(language);
      expect(a.formatLocale).toBe(formatLocale);
      expect(a.tMissing).toBe("Only English");
      expect(a.dateTimeZoneIgnored).toBe(a.dateLong); // options outside the allow-list do nothing
      expect(a.badDateOption).toMatch(/^ERROR ctx\.format\.date: dateStyle must be one of/);
      expect(a.notADate).toBe("ERROR ctx.format: not a date");
      expect(a.badMessage).toMatch(/^ERROR ctx\.t: .* is not a message I can read/);
      expect(a.hugeList).toMatch(/more than 1000 items/);
      if (language === "pl") {
        expect([a.tMap, a.tPlural1, a.tPlural2, a.tPlural5, a.tVar]).toEqual(["Do podlania", "1 roślina", "2 rośliny", "5 roślin", "Podlej: Monstera"]);
        expect(a.dateLong).toBe("13 października 2026");
        expect(a.money).toBe("42,00\u00a0€");
        expect(a.relDays).toBe("za 3 dni");
        expect(a.relTomorrow).toBe("jutro");
        expect(a.list).toBe("milk, eggs i bread");
      } else {
        expect([a.tMap, a.tPlural1, a.tPlural2, a.tVar]).toEqual(["Due now", "1 plant", "2 plants", "Water Monstera"]);
        expect(a.dateLong).toBe("13 October 2026"); // en-GB, the person's own region
        expect(a.money).toBe("€42.00");
        expect(a.moneyYen).toBe("JP¥500");
        expect(a.relDays).toBe("in 3 days");
        expect(a.relHoursAgo).toBe("2 hours ago");
        expect(a.relAlways).toBe("in 1 day");
        expect(a.listOr).toBe("tea or coffee");
      }
    });
  }

  it("resolves a map handed to ctx.ui.toast, in both runners", async () => {
    for (const kind of ["direct", "isolate"] as const) {
      const r = await run(kind, "pl", "pl-PL");
      await r.loaded.callAction("plant", "hello", RECORD, r.ctx);
      expect(r.toasts).toEqual(["Podlano: Monstera"]);
      r.loaded.dispose();
    }
  });

  it("the sealed box still has no Intl of its own — the words come from the host", async () => {
    const r = await run("isolate", "pl", "pl-PL");
    const code = `({ id: "x", name: "X", version: "1.0.0", schemaVersion: 1, entities: { a: { fields: {}, computed: { intl: function(){ return typeof Intl; } } } }, pages: [] })`;
    const host = createHost({ loadIsolated: createIsolateLoader({ store: new MemoryStore(), newContext }) });
    const probe = await host.load({ kind: "bundle", code: `globalThis.__potyroApp = ${code};`, provenance: "untrusted" });
    expect(await probe.callComputed("a", "intl", RECORD, r.ctx)).toBe("undefined");
    probe.dispose();
    r.loaded.dispose();
  });
});

describe("hostPure — what the box may ask (docs/20 §2.3)", () => {
  const ctx = (() => {
    let c: Ctx | null = null;
    return async () => (c ??= (await run("direct", "en", "en-GB")).ctx);
  })();
  const ask = async (req: unknown): Promise<{ ok: boolean; value?: string; error?: string }> => {
    const out = hostPure(JSON.stringify(req), await ctx());
    return out.startsWith(PURE_OK) ? { ok: true, value: out.slice(1) } : { ok: false, error: out.slice(1) };
  };

  it("answers only its six operations", async () => {
    expect(await ask({ op: "date", value: NOW.toISOString(), opts: { dateStyle: "short" } })).toEqual({ ok: true, value: "13/10/2026" });
    expect(await ask({ op: "fetch", value: "https://example.com" })).toEqual({ ok: false, error: 'unknown request "fetch"' });
    expect(await ask({ op: "data.all", entity: "plant" })).toMatchObject({ ok: false });
  });

  it("refuses requests over the size caps", async () => {
    expect((await ask({ op: "list", value: new Array(1001).fill("a") })).error).toMatch(/more than 1000 items/);
    expect((await ask({ op: "t", words: "x".repeat(10_001), vars: {} })).error).toMatch(/longer than 10000 characters/);
    expect((await ask({ op: "t", words: "{a}", vars: { a: "y".repeat(10_001) } })).error).toMatch(/longer than 10000 characters/);
    expect((await ask({ op: "number", value: "12" })).error).toBe("ctx.format.number takes a number");
  });

  it("never takes a locale from the request — the host's is used", async () => {
    expect(await ask({ op: "number", value: 1234.5, locale: "de-DE" })).toEqual({ ok: true, value: "1,234.5" });
  });
});
