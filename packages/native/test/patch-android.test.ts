import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs build script, typed by use
import { SPLASH_HOLD, TEMPLATES, packageOf, withPluginRegistered, withSplashHeld } from "../scripts/patch-android.mjs";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The local-socket plugin (docs/28 §6) is registered in the generated MainActivity, once.

const GENERATED = `package app.potyro;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`;

describe("patch-android", () => {
  it("reads the generated activity's package", () => {
    expect(packageOf(GENERATED)).toBe("app.potyro");
  });

  it("registers the plugin before super.onCreate in the generated empty activity, once", () => {
    const { source, added } = withPluginRegistered(GENERATED);
    expect(added).toBe(true);
    expect(source).toContain("import android.os.Bundle;");
    expect(source.indexOf("registerPlugin(LocalSocketPlugin.class);")).toBeLessThan(source.indexOf("super.onCreate(savedInstanceState);"));
    expect(source.indexOf("registerPlugin(SpeechPlugin.class);")).toBeLessThan(source.indexOf("super.onCreate(savedInstanceState);"));
    expect(withPluginRegistered(source)).toEqual({ source, added: false });
  });

  it("registers keep-awake too, and adds it to an activity patched before it existed", () => {
    const { source } = withPluginRegistered(GENERATED);
    expect(source.match(/registerPlugin\(KeepAwakePlugin\.class\)/g)).toHaveLength(1);
    expect(source.indexOf("registerPlugin(KeepAwakePlugin.class);")).toBeLessThan(source.indexOf("super.onCreate(savedInstanceState);"));
    const older = withPluginRegistered(GENERATED, ["LocalSocketPlugin", "SpeechPlugin"]).source;
    const upgraded = withPluginRegistered(older);
    expect(upgraded.added).toBe(true);
    expect(upgraded.source.match(/registerPlugin\(LocalSocketPlugin\.class\)/g)).toHaveLength(1);
    expect(upgraded.source.match(/registerPlugin\(KeepAwakePlugin\.class\)/g)).toHaveLength(1);
    expect(upgraded.source.indexOf("KeepAwakePlugin")).toBeLessThan(upgraded.source.indexOf("super.onCreate(savedInstanceState);"));
  });

  it("adds the voice plugin to an activity an earlier build registered only the socket plugin in", () => {
    const earlier = withPluginRegistered(GENERATED).source.replace(/\n\s*registerPlugin\(SpeechPlugin\.class\);/, "");
    const { source, added } = withPluginRegistered(earlier);
    expect(added).toBe(true);
    expect(source.match(/registerPlugin\(/g)).toHaveLength(4);
  });

  it("adds to an onCreate that is already there", () => {
    const has = GENERATED.replace("extends BridgeActivity {}", "extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle b) {\n        super.onCreate(b);\n    }\n}").replace("import com.getcapacitor.BridgeActivity;", "import android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;");
    const { source } = withPluginRegistered(has);
    expect(source.match(/registerPlugin\(LocalSocketPlugin\.class\)/g)).toHaveLength(1);
    expect(source.match(/registerPlugin\(SpeechPlugin\.class\)/g)).toHaveLength(1);
    expect(source.indexOf("registerPlugin")).toBeLessThan(source.indexOf("super.onCreate(b)"));
    expect(source.match(/import android\.os\.Bundle;/g)).toHaveLength(1);
  });

  it("holds the splash right after super.onCreate, once, in the activity the plugins were registered in", () => {
    const registered = withPluginRegistered(GENERATED).source;
    const { source, added } = withSplashHeld(registered);
    expect(added).toBe(true);
    const lines = source.split("\n").map((l: string) => l.trim());
    expect(lines[lines.indexOf("super.onCreate(savedInstanceState);") + 1]).toBe(SPLASH_HOLD);
    expect(withSplashHeld(source)).toEqual({ source, added: false });
    // and the plugins are still registered before super.onCreate
    expect(source.indexOf("registerPlugin(KeepAwakePlugin.class);")).toBeLessThan(source.indexOf("super.onCreate"));
  });

  it("leaves an activity with no onCreate alone rather than guessing where the call goes", () => {
    expect(withSplashHeld(GENERATED)).toEqual({ source: GENERATED, added: false });
  });

  it("has every template it copies, each in the package placeholder", () => {
    for (const t of TEMPLATES) {
      const path = fileURLToPath(new URL(`../android-templates/${t}`, import.meta.url));
      expect(existsSync(path), t).toBe(true);
      expect(readFileSync(path, "utf8"), t).toMatch(/^package __PACKAGE__;/);
    }
  });

  it("holds the splash for the shell's own first-screen signal, with one limit, and not for a mounted root", () => {
    const hold = readFileSync(fileURLToPath(new URL("../android-templates/SplashHold.java", import.meta.url)), "utf8");
    const code = hold.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).toContain(`static final String READY = "document.documentElement.dataset.potyroReady==='1'";`);
    expect(code).toContain("web.evaluateJavascript(READY,");
    expect(code).toContain("static final long LIMIT_MS = 5000;");
    expect(code.match(/LIMIT_MS/g)).toHaveLength(2); // declared, and the one place it ends the hold
    // a mounted root is not a drawn screen: the hold must not end on it
    expect(code).not.toMatch(/childElementCount|getElementById/);
  });
});
