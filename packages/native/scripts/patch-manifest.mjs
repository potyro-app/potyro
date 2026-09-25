// Inject the permissions the generated Android manifest does not get on its own.
//
// A Capacitor plugin merges some of its permissions and leaves the rest to the app: the local-
// notifications plugin merges POST_NOTIFICATIONS / RECEIVE_BOOT_COMPLETED / WAKE_LOCK but not the
// exact-alarm ones, and the geolocation and camera plugins merge none of theirs. Since android/ is
// generated (gitignored) rather than committed, this runs after `cap sync` so they survive every
// regeneration. Idempotent.
//
//   USE_EXACT_ALARM      — Android 14+: exact alarms with no user prompt (central to the app).
//   SCHEDULE_EXACT_ALARM — Android 12/13: user-grantable fallback for the same capability.
//   ACCESS_FINE_LOCATION | ACCESS_COARSE_LOCATION — `ctx.caps.geo`. Without them the plugin does not
//     ask the person, it REFUSES: "Missing the following permissions in AndroidManifest.xml".
//     Found on a Pixel on 2026-09-16 — "Use my location" did nothing, and nothing in the app said
//     why, because the refusal arrives as a rejected promise the geo field swallows.
//   CAMERA — `ctx.caps.camera` taking a new photo (the library picker needs nothing).
//
// NOT here: READ_EXTERNAL_STORAGE. The camera plugin asks for it only because
// `requestPermissions()` with no argument checks every alias it has; the adapter asks for the one
// alias the capture needs instead (capacitor-capabilities.ts). Declaring a storage permission to
// take a photo would be asking for every photo on the phone.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PERMS = [
  '<uses-permission android:name="android.permission.USE_EXACT_ALARM" />',
  '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.CAMERA" />',
];

const nameOf = (perm) => perm.split("android.permission.")[1].split('"')[0];

/** The manifest with whatever it is missing added, and what that was. Pure, so a test can hold it. */
export function withPermissions(xml) {
  const missing = PERMS.filter((p) => !xml.includes(`android.permission.${nameOf(p)}`));
  if (missing.length === 0) return { xml, added: [] };
  // Right before the closing tag: permissions are valid as direct children of <manifest>.
  const block = "\n    " + missing.join("\n    ") + "\n";
  return { xml: xml.replace(/<\/manifest>\s*$/, `${block}</manifest>\n`), added: missing.map(nameOf) };
}

// Karta in Android's share sheet (#213): text shared from another app — what another AI made —
// arrives as ACTION_SEND text/*, which @capgo/capacitor-share-target hands to the shell. Text only for
// now; images come later. Inside the main activity, where the plugin reads the intent.
export const SHARE_FILTER = `<intent-filter android:label="Add to Karta">
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/*" />
            </intent-filter>`;

/** The manifest with the share intent filter in the main activity, once. Pure. */
export function withShareTarget(xml) {
  if (xml.includes("android.intent.action.SEND")) return { xml, added: false };
  const activity = /(<activity\b[^>]*android:name="[^"]*MainActivity"[\s\S]*?)(\s*<\/activity>)/;
  if (!activity.test(xml)) return { xml, added: false };
  return { xml: xml.replace(activity, (_, body, close) => `${body}\n            ${SHARE_FILTER}${close}`), added: true };
}

// Running it (rather than importing it) patches the generated project.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const manifest = fileURLToPath(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url));
  if (!existsSync(manifest)) {
    console.error(`[patch-manifest] ${manifest} not found — run \`pnpm cap:add:android\` first.`);
    process.exit(1);
  }
  const { xml, added } = withPermissions(readFileSync(manifest, "utf8"));
  const share = withShareTarget(xml);
  if (added.length === 0 && !share.added) {
    console.log("[patch-manifest] permissions and share target already present — nothing to do.");
  } else {
    writeFileSync(manifest, share.xml);
    if (added.length) console.log(`[patch-manifest] added ${added.length} permission(s): ${added.join(", ")}.`);
    if (share.added) console.log("[patch-manifest] added the share target (text/*) to MainActivity.");
  }
}
