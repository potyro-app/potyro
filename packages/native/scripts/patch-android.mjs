// Put Potyro's own Android code into the generated project (android/ is gitignored and regenerated):
// the `PotyroLocalSocket` plugin — plain ws:// to the LOCAL NETWORK only, docs/28 §6 — copied from
// android-templates/ into MainActivity's package, and registered in MainActivity. Idempotent.
//
// Nothing here touches the network security config or `usesCleartextTraffic`: the app's cleartext
// policy stays "no" for every HTTP stack. The plugin speaks ws:// itself, over a plain socket, and
// only to addresses it has checked are local (LocalWebSocket.java says why that is the only way to
// say "private ranges only" on Android).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATES = ["LocalWebSocket.java", "LocalSocketPlugin.java"];

/** The package a MainActivity.java declares, or null. Pure. */
export function packageOf(source) {
  const m = /^\s*package\s+([\w.]+)\s*;/m.exec(source);
  return m ? m[1] : null;
}

/**
 * MainActivity with the plugin registered before `super.onCreate` (Capacitor's rule for a plugin that
 * lives in the app), once. Handles the generated empty class and one that already has an onCreate. Pure.
 */
export function withPluginRegistered(source) {
  if (source.includes("registerPlugin(LocalSocketPlugin.class)")) return { source, added: false };
  let out = source;
  if (!/import\s+android\.os\.Bundle\s*;/.test(out)) out = out.replace(/(^\s*package\s+[\w.]+\s*;\s*\n)/m, "$1\nimport android.os.Bundle;\n");
  if (/void\s+onCreate\s*\(\s*Bundle\s+\w+\s*\)\s*\{/.test(out)) {
    out = out.replace(/(void\s+onCreate\s*\(\s*Bundle\s+\w+\s*\)\s*\{)/, "$1\n        registerPlugin(LocalSocketPlugin.class);");
  } else {
    const body = `{\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        // docs/28 §6: ws:// to the local network, from Potyro's own plugin (scripts/patch-android.mjs).\n        registerPlugin(LocalSocketPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}`;
    out = out.replace(/extends\s+BridgeActivity\s*\{\s*\}/, `extends BridgeActivity ${body}`);
  }
  return { source: out, added: out !== source };
}

function findMainActivity(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const found = findMainActivity(p);
      if (found) return found;
    } else if (name === "MainActivity.java") return p;
  }
  return null;
}

// Running it (rather than importing it) patches the generated project.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const javaRoot = fileURLToPath(new URL("../android/app/src/main/java", import.meta.url));
  const templates = fileURLToPath(new URL("../android-templates/", import.meta.url));
  if (!existsSync(javaRoot)) {
    console.error(`[patch-android] ${javaRoot} not found — run \`pnpm cap:add:android\` first.`);
    process.exit(1);
  }
  const activity = findMainActivity(javaRoot);
  if (!activity) {
    console.error("[patch-android] no MainActivity.java in the generated project.");
    process.exit(1);
  }
  const source = readFileSync(activity, "utf8");
  const pkg = packageOf(source);
  if (!pkg) {
    console.error(`[patch-android] ${activity} declares no package.`);
    process.exit(1);
  }
  const dir = dirname(activity);
  mkdirSync(dir, { recursive: true });
  for (const t of TEMPLATES) writeFileSync(join(dir, t), readFileSync(join(templates, t), "utf8").replaceAll("__PACKAGE__", pkg));
  const registered = withPluginRegistered(source);
  if (registered.added) writeFileSync(activity, registered.source);
  console.log(`[patch-android] ${TEMPLATES.join(", ")} → ${pkg}${registered.added ? "; registered in MainActivity" : ""}.`);
}
