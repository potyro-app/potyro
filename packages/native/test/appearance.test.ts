import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
// @ts-expect-error — a plain .mjs build script, typed by use
import { PLUGINS, TEMPLATES, fillTemplate } from "../scripts/patch-android.mjs";

// The Android app's bars and its next splash follow the theme the shell is SHOWING, not the phone's
// (android-templates/appearance.js run in the page, AppearancePlugin.java on the other side).

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const script = readFileSync(at("../android-templates/appearance.js"), "utf8");
const plugin = readFileSync(at("../android-templates/AppearancePlugin.java"), "utf8");

interface Call { plugin: string; method: string; options: Record<string, unknown> }

/** A page as the script sees it: the root's attribute, the phone's theme, the kept Look, the bridge. */
function page(o: { theme?: string; phoneDark?: boolean; look?: unknown; bridge?: boolean } = {}) {
  const calls: Call[] = [];
  const state = { theme: o.theme as string | undefined, phoneDark: o.phoneDark ?? false, look: o.look };
  let onAttribute: () => void = () => {};
  let onMedia: () => void = () => {};
  let observers = 0;
  const window: Record<string, unknown> = {
    matchMedia: () => ({ get matches() { return state.phoneDark; }, addEventListener: (_: string, cb: () => void) => (onMedia = cb) }),
    localStorage: { getItem: (k: string) => (k === "potyro:look" && state.look !== undefined ? (typeof state.look === "string" ? state.look : JSON.stringify(state.look)) : null) },
    Capacitor: o.bridge === false ? undefined : {
      nativePromise: (p: string, method: string, options: Record<string, unknown>) => { calls.push({ plugin: p, method, options }); return Promise.resolve(); },
    },
  };
  const context = {
    window,
    document: { documentElement: { getAttribute: (n: string) => (n === "data-theme" ? state.theme ?? null : null) } },
    MutationObserver: class {
      constructor(cb: () => void) { onAttribute = cb; observers++; }
      observe(_: unknown, options: { attributeFilter?: string[] }) { expect(options.attributeFilter).toEqual(["data-theme"]); }
    },
    JSON,
  };
  const run = () => runInNewContext(script, context);
  run();
  return {
    calls,
    run,
    observers: () => observers,
    setTheme: (t: string | undefined) => { state.theme = t; onAttribute(); },
    setPhone: (dark: boolean) => { state.phoneDark = dark; onMedia(); },
    setLook: (l: unknown) => { state.look = l; },
    last: (name: string) => calls.filter((c) => c.plugin === name).at(-1)?.options,
  };
}

describe("appearance.js: what the page tells the app", () => {
  it("a light Potyro on a dark phone: bars for a light page, and the choice remembered", () => {
    const p = page({ theme: "light", phoneDark: true, look: { appearance: "light" } });
    expect(p.last("SystemBars")).toEqual({ style: "LIGHT" });
    expect(p.last("PotyroAppearance")).toEqual({ dark: false, look: "light" });
    expect(p.calls.map((c) => `${c.plugin}.${c.method}`)).toEqual(["SystemBars.setStyle", "PotyroAppearance.show"]);
  });

  it("a dark Potyro on a light phone", () => {
    const p = page({ theme: "dark", phoneDark: false, look: { appearance: "dark", accent: 120 } });
    expect(p.last("SystemBars")).toEqual({ style: "DARK" });
    expect(p.last("PotyroAppearance")).toEqual({ dark: true, look: "dark" });
  });

  it("no choice: the phone's theme, and it follows the phone when that changes", () => {
    const p = page({ phoneDark: true });
    expect(p.last("PotyroAppearance")).toEqual({ dark: true, look: "system" });
    p.setPhone(false);
    expect(p.last("PotyroAppearance")).toEqual({ dark: false, look: "system" });
    expect(p.last("SystemBars")).toEqual({ style: "LIGHT" });
  });

  it("follows the choice when the person changes it, without being asked", () => {
    const p = page({ phoneDark: true });
    p.setLook({ appearance: "light" });
    p.setTheme("light");
    expect(p.last("PotyroAppearance")).toEqual({ dark: false, look: "light" });
    p.setLook({ appearance: "system" });
    p.setTheme(undefined);
    expect(p.last("PotyroAppearance")).toEqual({ dark: true, look: "system" });
  });

  it("an app's own theme changes the bars and is not taken for the person's choice", () => {
    const p = page({ phoneDark: false, look: { appearance: "system" } });
    p.setTheme("dark"); // a dark app opens
    expect(p.last("PotyroAppearance")).toEqual({ dark: true, look: "system" });
    p.setTheme(undefined); // and closes
    expect(p.last("PotyroAppearance")).toEqual({ dark: false, look: "system" });
  });

  it("says nothing twice", () => {
    const p = page({ theme: "light", phoneDark: true, look: { appearance: "light" } });
    p.setTheme("light");
    p.setPhone(false); // the phone changed; a chosen theme does not
    expect(p.calls).toHaveLength(2);
  });

  it("watches once, however often it is run in the same page", () => {
    const p = page({ phoneDark: true });
    p.run();
    p.run();
    expect(p.observers()).toBe(1);
    expect(p.calls).toHaveLength(2);
  });

  it("reads a Look it cannot understand as no choice, and does nothing without the bridge", () => {
    expect(page({ look: "not json" }).last("PotyroAppearance")).toEqual({ dark: false, look: "system" });
    expect(page({ look: { appearance: "sepia" } }).last("PotyroAppearance")).toEqual({ dark: false, look: "system" });
    expect(page({ bridge: false }).calls).toEqual([]);
  });

  it("reads the Look where the shell keeps it", () => {
    const look = readFileSync(at("../../shell/src/look.ts"), "utf8");
    expect(look).toMatch(/const KEY = "potyro:look";/);
    expect(look).toMatch(/appearance/);
    expect(script).toContain('getItem("potyro:look")');
  });

  it("never polls", () => {
    const code = script.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
});

describe("AppearancePlugin: installed with the script inside it", () => {
  it("is copied and registered with the other plugins", () => {
    expect(TEMPLATES).toContain("AppearancePlugin.java");
    expect(PLUGINS).toContain("AppearancePlugin");
    expect(plugin).toContain('@CapacitorPlugin(name = "PotyroAppearance")');
  });

  it("gets the script as one Java string that is still the same program", () => {
    const filled: string = fillTemplate(plugin, { pkg: "app.potyro", appearanceJs: script });
    expect(filled).toMatch(/^package app\.potyro;/);
    expect(filled).not.toContain("__APPEARANCE_JS__");
    const literal = /static final String WATCH = (".*");$/m.exec(filled)![1]!;
    const js = JSON.parse(literal) as string; // a JSON string of plain ASCII is a Java string too
    expect(literal).toMatch(/^[\x20-\x7e]+$/);
    expect(js).not.toMatch(/^\s*\/\//m);
    // the same behaviour as the file it came from
    const calls: string[] = [];
    runInNewContext(js, {
      window: {
        matchMedia: () => ({ matches: true, addEventListener: () => {} }),
        localStorage: { getItem: () => '{"appearance":"light"}' },
        Capacitor: { nativePromise: (p: string, m: string, o: unknown) => { calls.push(`${p}.${m} ${JSON.stringify(o)}`); return Promise.resolve(); } },
      },
      document: { documentElement: { getAttribute: () => "light" } },
      MutationObserver: class { observe() {} },
      JSON,
    });
    expect(calls).toEqual(['SystemBars.setStyle {"style":"LIGHT"}', 'PotyroAppearance.show {"dark":false,"look":"light"}']);
  });

  it("draws the bars for what is shown and hands the person's choice to the system, from Android 12", () => {
    const code = plugin.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).toContain("bars.setAppearanceLightStatusBars(!dark);");
    expect(code).toContain("bars.setAppearanceLightNavigationBars(!dark);");
    expect(code).toContain("dark ? R.color.potyro_bg_dark : R.color.potyro_bg_light");
    expect(code).toContain("if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;");
    expect(code).toMatch(/"dark"\.equals\(look\) \? UiModeManager\.MODE_NIGHT_YES : "light"\.equals\(look\) \? UiModeManager\.MODE_NIGHT_NO : UiModeManager\.MODE_NIGHT_AUTO/);
  });
});
