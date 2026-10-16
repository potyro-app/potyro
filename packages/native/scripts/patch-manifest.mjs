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
//   CAMERA — `ctx.caps.camera` taking a new photo (the library picker needs nothing), and the live
//     camera (docs/25): the WebView's getUserMedia asks for it through Capacitor's chrome client.
//     Video only — the live camera never asks for audio.
//   RECORD_AUDIO — voice input ONLY (docs/29): the PotyroSpeech plugin asks for it at runtime the first
//     time an app or the Studio listens, never before; the live camera still asks for video alone.
//     With it, a <queries> entry for android.speech.RecognitionService: from Android 11 a recognizer
//     the app cannot "see" makes SpeechRecognizer.isRecognitionAvailable answer false.
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
  '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
];

/** Package visibility for the phone's speech recognizer (docs/29). */
export const SPEECH_QUERY = `<queries>
        <intent>
            <action android:name="android.speech.RecognitionService" />
        </intent>
    </queries>`;

/** The manifest with the recognizer visible to the app, once. Pure. */
export function withSpeechQuery(xml) {
  if (xml.includes("android.speech.RecognitionService")) return { xml, added: false };
  return { xml: xml.replace(/<\/manifest>\s*$/, `    ${SPEECH_QUERY}\n</manifest>\n`), added: true };
}

const nameOf = (perm) => perm.split("android.permission.")[1].split('"')[0];

/** The manifest with whatever it is missing added, and what that was. Pure, so a test can hold it. */
export function withPermissions(xml) {
  const missing = PERMS.filter((p) => !xml.includes(`android.permission.${nameOf(p)}`));
  if (missing.length === 0) return { xml, added: [] };
  // Right before the closing tag: permissions are valid as direct children of <manifest>.
  const block = "\n    " + missing.join("\n    ") + "\n";
  return { xml: xml.replace(/<\/manifest>\s*$/, `${block}</manifest>\n`), added: missing.map(nameOf) };
}

// Potyro in Android's share sheet (#213, #254): text shared from another app — what another AI made —
// arrives as ACTION_SEND text, and a file (or several) as ACTION_SEND / SEND_MULTIPLE with a stream,
// which @capgo/capacitor-share-target copies into the app's cache and hands to the shell. "Open with
// Potyro" on a file is ACTION_VIEW on a content:// (or file://) address; `@capacitor/app` reports it
// as an opened URL. Inside the main activity, where both plugins read the intent.
export const SHARE_FILTER = `<intent-filter android:label="Add to Potyro">
                <action android:name="android.intent.action.SEND" />
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="*/*" />
            </intent-filter>
            <intent-filter android:label="Potyro">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" android:mimeType="*/*" />
                <data android:scheme="file" android:mimeType="*/*" />
            </intent-filter>`;

/** The text-only filter an earlier build wrote, which this one replaces. */
const TEXT_ONLY = /<intent-filter android:label="Add to Potyro">\s*<action android:name="android\.intent\.action\.SEND" \/>\s*<category android:name="android\.intent\.category\.DEFAULT" \/>\s*<data android:mimeType="text\/\*" \/>\s*<\/intent-filter>\s*/;

/** The manifest with the share and open-with filters in the main activity, once. Pure. */
export function withShareTarget(xml) {
  if (xml.includes("android.intent.action.SEND_MULTIPLE")) return { xml, added: false };
  const base = xml.replace(TEXT_ONLY, "");
  const activity = /(<activity\b[^>]*android:name="[^"]*MainActivity"[\s\S]*?)(\s*<\/activity>)/;
  if (!activity.test(base)) return { xml, added: false };
  return { xml: base.replace(activity, (_, body, close) => `${body}\n            ${SHARE_FILTER}${close}`), added: true };
}

// Running it (rather than importing it) patches the generated project.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const manifest = fileURLToPath(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url));
  if (!existsSync(manifest)) {
    console.error(`[patch-manifest] ${manifest} not found — run \`pnpm cap:add:android\` first.`);
    process.exit(1);
  }
  const { xml, added } = withPermissions(readFileSync(manifest, "utf8"));
  const speech = withSpeechQuery(xml);
  const share = withShareTarget(speech.xml);
  if (added.length === 0 && !share.added && !speech.added) {
    console.log("[patch-manifest] permissions and share target already present — nothing to do.");
  } else {
    writeFileSync(manifest, share.xml);
    if (added.length) console.log(`[patch-manifest] added ${added.length} permission(s): ${added.join(", ")}.`);
    if (share.added) console.log("[patch-manifest] added the share and open-with targets to MainActivity.");
    if (speech.added) console.log("[patch-manifest] made the speech recognizer visible to the app (voice input).");
  }
}
