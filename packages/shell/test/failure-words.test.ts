// @vitest-environment happy-dom
// What a person reads when an app's button fails (#76).
//
// The report: an app's action stored what an AI had read off a label under a field that lists other
// choices, and the person got a toast beginning "realm app error:" followed by the validator's
// English. Here the same action runs through the shell's own composition, as the person's own app
// and sealed, and the toast is read: the app's labels, the person's language, what the field takes
// — and nothing about how the app is run.

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { actionFailure, HostFault, type AppFailure } from "@potyro/host";
import { setLocale } from "@potyro/i18n";
import { compose } from "../src/compose.js";
import { createSandboxLoader } from "../src/isolate-bridge.js";
import { failureWords } from "../src/failure-words.js";

/** The app as a bundle sets it; `defineApp` of the same object is the person's own copy. */
const SOURCE = `
globalThis.__potyroApp = {
  id: "cellar", name: "Cellar", version: "1.0.0", schemaVersion: 1,
  language: "en", languages: ["en", "it"],
  entities: {
    wine: {
      label: { en: "Wine", it: "Vino" },
      fields: {
        name: { type: "text" },
        grape: { type: "enum", label: { en: "Grape", it: "Vitigno" }, options: ["malbec", "merlot", "syrah"], labels: { malbec: "Malbec", merlot: "Merlot", syrah: "Syrah" } },
        year: { type: "number", label: "Year", integer: true, min: 1900 },
        price: { type: "money", label: "Price", currency: "EUR", max: 50000 },
        tastings: { type: "list", label: "Tastings", of: { score: { type: "number", label: "Score", max: 100 } } },
        region: { type: "enum", options: ["a","b","c","d","e","f","g","h","i","j"] }
      },
      actions: {
        identify: async function(r, ctx){ await ctx.patch("wine", r.id, { grape: "Cabernet Sauvignon" }); },
        refuse: async function(){ throw new Error("Pick a bottle first"); },
        bug: async function(r){ return r.cellar.shelf; }
      }
    }
  },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "wine", display: { primary: "name" } } }]
};
`;

function definition() {
  const scope: { __potyroApp?: Parameters<typeof defineApp>[0] } = {};
  new Function("globalThis", SOURCE)(scope);
  return scope.__potyroApp!;
}

async function open(how: "yours" | "sealed", languages: string[] = ["en"]) {
  const store = new MemoryStore();
  await store.open("cellar");
  const row = await store.insert("wine", { name: "Bottle" });
  const toasts: string[] = [];
  const ui = { toast: (m: string) => void toasts.push(m), confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav = { navigate: () => {} };
  const base = { store, caps: new FakeCapabilities(), ui, nav, languages };
  const { runtime } =
    how === "yours"
      ? await compose({ ...base, provenance: "trusted", app: defineApp(definition()) })
      : await compose({ ...base, provenance: "untrusted", bundleCode: SOURCE, loadIsolated: await createSandboxLoader(store) });
  const heard: AppFailure[] = [];
  runtime.onFailure((f) => heard.push(f));
  return { runtime, toasts, heard, id: String(row.id) };
}

const INTERNAL = /realm|isolate|sandbox|sealed|app error|Error|must be one of/i;

afterEach(async () => {
  vi.restoreAllMocks();
  await setLocale("en");
});

describe.each(["yours", "sealed"] as const)("an action's refused write, in an app that runs as: %s", (how) => {
  it("says the field, the kind of thing and what it takes — the same either way", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, toasts, heard, id } = await open(how);
    await runtime.runAction("wine", "identify", id);
    expect(toasts).toEqual(["Not saved: Grape (Wine) takes Malbec, Merlot, or Syrah."]);
    expect(toasts[0]).not.toMatch(INTERNAL);
    // The developer's line is kept: the console has the error, the listeners its sentence.
    expect(heard).toEqual([{ app: "cellar", what: "action wine.identify", message: "FieldValueError: Grape must be one of: malbec, merlot, syrah.", shown: toasts[0] }]);
    expect(warn.mock.calls[0]![0]).toBe("[potyro] action wine.identify failed:");
    expect(String((warn.mock.calls[0]![1] as Error).message)).toBe("Grape must be one of: malbec, merlot, syrah.");
  });

  it("in the person's language, with the app's labels in the app's", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await setLocale("it");
    const { runtime, toasts, id } = await open(how, ["it"]);
    await runtime.runAction("wine", "identify", id);
    expect(toasts).toEqual(["Non salvato: Vitigno (Vino) accetta Malbec, Merlot o Syrah."]);
  });

  it("the app's own words stay its words, and a bug is one plain sentence", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, toasts, heard, id } = await open(how);
    await runtime.runAction("wine", "refuse", id);
    await runtime.runAction("wine", "bug", id);
    expect(toasts).toEqual(["Pick a bottle first", "That did not work"]);
    expect(heard[1]!.message).toMatch(/^TypeError: /);
  });
});

describe("a call Potyro ended", () => {
  const def = defineApp(definition());
  const say = (e: unknown): string => failureWords(actionFailure(e), def as never);

  it("says what happened, without the numbers or how the app is run", async () => {
    // What the realm's watchdog and the QuickJS interrupt reject with (packages/host/test/app-error.test.ts).
    const slow = say(new HostFault("stopped: a action call did not finish within 1000 ms", "slow"));
    expect(slow).toBe("This took too long, so it was stopped.");
    expect(say(new HostFault("isolate call timed out after 1000 ms", "slow"))).toBe(slow);
    expect(say(new HostFault("stopped: it sent more than 500 messages in 250 ms", "stopped"))).toBe("The app was stopped before this finished.");
    expect(say(new HostFault("this app was closed", "closed"))).toBe("The app was closed before this finished.");
    for (const locale of ["de", "es", "it", "pl", "pt-BR"] as const) {
      await setLocale(locale);
      const said = (["slow", "stopped", "closed"] as const).map((why) => say(new HostFault("stopped: x 1000 ms", why)));
      expect(new Set(said).size, locale).toBe(3);
      for (const s of said) {
        expect(s, locale).not.toMatch(/1000|realm|isolate|sandbox|worker/i);
        expect(["This took too long, so it was stopped.", "The app was stopped before this finished.", "The app was closed before this finished."], locale).not.toContain(s);
      }
    }
  });
});

describe("each rule a field can refuse by", () => {
  const def = defineApp(definition());
  const say = (field: string, issue: unknown): string =>
    failureWords({ kind: "refused", refusal: { entity: "wine", field, issue } as never, detail: "" }, def as never);

  it("is one sentence naming the field", () => {
    expect(say("year", { rule: "whole" })).toBe("Not saved: Year (Wine) takes a whole number.");
    expect(say("year", { rule: "min", bound: 1900 })).toBe("Not saved: Year (Wine) takes 1,900 or more.");
    expect(say("price", { rule: "max", bound: 50000, currency: "EUR" })).toBe("Not saved: Price (Wine) takes €500.00 or less.");
    expect(say("name", { rule: "text" })).toBe("Not saved: Name (Wine) takes text.");
    expect(say("tastings", { rule: "row", key: "score", issue: { rule: "max", bound: 100 } })).toBe("Not saved: Tastings › Score (Wine) takes 100 or less.");
  });

  it("does not read out a long list of choices", () => {
    expect(say("region", { rule: "options", options: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] })).toBe("Not saved: Region (Wine) takes one of its listed choices.");
  });

  it("a refusal naming a field the app does not have is the plain sentence, never the name it was sent", () => {
    expect(say("<b>nope</b>", { rule: "text" })).toBe("That did not work");
  });

  it("every rule has words, in every language Potyro speaks", async () => {
    const rules: unknown[] = [
      { rule: "text" }, { rule: "number" }, { rule: "whole" }, { rule: "amount" }, { rule: "yesNo" }, { rule: "tags" }, { rule: "date" }, { rule: "place" },
      { rule: "media" }, { rule: "file" }, { rule: "list" }, { rule: "record", many: false }, { rule: "record", many: true }, { rule: "person", many: false },
      { rule: "member", many: true }, { rule: "min", bound: 1 }, { rule: "max", bound: 9 }, { rule: "options", options: ["malbec"] },
    ];
    const english = rules.map((r) => say("grape", r));
    expect(new Set(english).size).toBe(rules.length);
    for (const locale of ["de", "es", "it", "pl", "pt-BR"] as const) {
      await setLocale(locale);
      rules.forEach((r, i) => {
        const said = say("grape", r);
        expect(said, `${locale} ${JSON.stringify(r)}`).not.toBe(english[i]);
        expect(said).toContain("Grape");
      });
      expect(failureWords(actionFailure(new TypeError("x is undefined")), def as never)).not.toMatch(/TypeError|undefined/);
    }
  });
});
