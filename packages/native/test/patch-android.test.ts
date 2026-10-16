import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs build script, typed by use
import { packageOf, withPluginRegistered } from "../scripts/patch-android.mjs";

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
    expect(source.match(/registerPlugin\(/g)).toHaveLength(3);
  });

  it("adds to an onCreate that is already there", () => {
    const has = GENERATED.replace("extends BridgeActivity {}", "extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle b) {\n        super.onCreate(b);\n    }\n}").replace("import com.getcapacitor.BridgeActivity;", "import android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;");
    const { source } = withPluginRegistered(has);
    expect(source.match(/registerPlugin\(LocalSocketPlugin\.class\)/g)).toHaveLength(1);
    expect(source.match(/registerPlugin\(SpeechPlugin\.class\)/g)).toHaveLength(1);
    expect(source.indexOf("registerPlugin")).toBeLessThan(source.indexOf("super.onCreate(b)"));
    expect(source.match(/import android\.os\.Bundle;/g)).toHaveLength(1);
  });
});
