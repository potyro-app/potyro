// The permissions the generated Android manifest does not get on its own (#2, KA-02/KA-03).
//
// `android/` is generated and gitignored, so this patch is the only place these live. Found on a
// Pixel: without the location permissions the geolocation plugin does not ask the person, it REFUSES
// — "Missing the following permissions in AndroidManifest.xml" — and the geo field swallows the
// rejection, so "Use my location" silently did nothing.

import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs script, imported here for its pure half.
import { PERMS, withPermissions } from "../scripts/patch-manifest.mjs";

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="Potyro" />
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

const names = (xml: string): string[] => [...xml.matchAll(/android\.permission\.([A-Z_]+)/g)].map((m) => m[1]!);

describe("the manifest patch", () => {
  it("adds what a Capacitor plugin does not merge for us", () => {
    const { xml, added } = withPermissions(MANIFEST) as { xml: string; added: string[] };
    expect(added).toEqual(["USE_EXACT_ALARM", "SCHEDULE_EXACT_ALARM", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "CAMERA"]);
    // No storage permission: the adapter asks the camera plugin for the one alias a capture needs,
    // rather than declaring access to every photo on the phone (capacitor-capabilities.ts).
    expect(xml).not.toContain("READ_EXTERNAL_STORAGE");
    // Nor the microphone: the live camera asks getUserMedia for video only (docs/25).
    expect(xml).not.toContain("RECORD_AUDIO");
    expect(names(xml)).toContain("INTERNET"); // what was there already stays
    expect(xml.trimEnd().endsWith("</manifest>")).toBe(true);
    expect(PERMS).toHaveLength(5);
  });

  it("is idempotent — every cap sync runs it again", () => {
    const once = withPermissions(MANIFEST) as { xml: string };
    const twice = withPermissions(once.xml) as { xml: string; added: string[] };
    expect(twice.added).toEqual([]);
    expect(twice.xml).toBe(once.xml);
  });

  it("adds only what is missing", () => {
    const withCamera = MANIFEST.replace("</manifest>", '    <uses-permission android:name="android.permission.CAMERA" />\n</manifest>');
    const { added } = withPermissions(withCamera) as { added: string[] };
    expect(added).not.toContain("CAMERA");
    expect(added).toContain("ACCESS_FINE_LOCATION");
  });
});

// @ts-expect-error — a plain .mjs script, imported here for its pure half.
import { withShareTarget } from "../scripts/patch-manifest.mjs";

describe("the share target (#213)", () => {
  const WITH_ACTIVITY = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="Potyro">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;

  it("puts the share and open-with filters inside the main activity, once (#213, #254)", () => {
    const once = withShareTarget(WITH_ACTIVITY) as { xml: string; added: boolean };
    expect(once.added).toBe(true);
    const activity = once.xml.slice(once.xml.indexOf("<activity"), once.xml.indexOf("</activity>"));
    expect(activity).toContain('<action android:name="android.intent.action.SEND" />');
    expect(activity).toContain('<action android:name="android.intent.action.SEND_MULTIPLE" />');
    expect(activity).toContain('<action android:name="android.intent.action.VIEW" />');
    expect(activity).toContain('android:scheme="content"');
    expect(activity).toContain('android:mimeType="*/*"');
    const twice = withShareTarget(once.xml) as { xml: string; added: boolean };
    expect(twice.added).toBe(false);
    expect(twice.xml).toBe(once.xml);
  });

  it("upgrades a manifest patched when only text could be shared", () => {
    const old = WITH_ACTIVITY.replace(
      "        </activity>",
      `            <intent-filter android:label="Add to Potyro">
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/*" />
            </intent-filter>
        </activity>`,
    );
    const next = withShareTarget(old) as { xml: string; added: boolean };
    expect(next.added).toBe(true);
    expect(next.xml).not.toContain('android:mimeType="text/*"');
    expect(next.xml.match(/action\.SEND"/g)).toHaveLength(1);
    expect(next.xml).toContain("SEND_MULTIPLE");
  });
});
