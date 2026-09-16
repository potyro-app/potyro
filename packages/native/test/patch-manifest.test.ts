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
    <application android:label="Karta" />
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
