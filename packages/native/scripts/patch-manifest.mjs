// Inject the exact-alarm permissions into the generated Android manifest. The @capacitor/local-
// notifications plugin merges POST_NOTIFICATIONS / RECEIVE_BOOT_COMPLETED / WAKE_LOCK, but NOT the
// exact-alarm permission — and Karta's deciding native feature is an EXACT, offline, app-closed
// reminder. Since android/ is generated (gitignored) rather than committed, this runs after
// `cap sync` so the permission survives every regeneration. Idempotent.
//
//   USE_EXACT_ALARM      — Android 14+: exact alarms with no user prompt (central to the app).
//   SCHEDULE_EXACT_ALARM — Android 12/13: user-grantable fallback for the same capability.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifest = fileURLToPath(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url));

if (!existsSync(manifest)) {
  console.error(`[patch-manifest] ${manifest} not found — run \`pnpm cap:add:android\` first.`);
  process.exit(1);
}

const PERMS = [
  '<uses-permission android:name="android.permission.USE_EXACT_ALARM" />',
  '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />',
];

let xml = readFileSync(manifest, "utf8");
const missing = PERMS.filter((p) => !xml.includes('android.permission.' + p.split("android.permission.")[1].split('"')[0]));

if (missing.length === 0) {
  console.log("[patch-manifest] exact-alarm permissions already present — nothing to do.");
  process.exit(0);
}

// Insert right before the closing </manifest> tag (permissions are valid as direct manifest children).
const block = "\n    " + missing.join("\n    ") + "\n";
xml = xml.replace(/<\/manifest>\s*$/, `${block}</manifest>\n`);
writeFileSync(manifest, xml);
console.log(`[patch-manifest] added ${missing.length} exact-alarm permission(s).`);
