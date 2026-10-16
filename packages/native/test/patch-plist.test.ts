// What the generated iOS project does not get on its own (docs/27). `ios/` is generated and
// gitignored, like `android/`, so this patch is the only place these live. The fixtures are the
// Capacitor 8.4 iOS (SPM) template's own files, trimmed.
//
// Without NSCameraUsageDescription iOS does not refuse the camera, it terminates the app the moment
// the camera is asked for; without the location keys the geolocation plugin cannot ask at all.

import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs script, imported here for its pure half.
import { ENTRIES, MIN_IOS, USAGE, withDeploymentTarget, withInfoPlist, withReadableOpenedFiles } from "../scripts/patch-plist.mjs";
import config, { IOS_APP_GROUP } from "../capacitor.config.js";

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>Potyro</string>
	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
	</array>
	<key>UIViewControllerBasedStatusBarAppearance</key>
	<true/>
</dict>
</plist>
`;

const keys = (xml: string): string[] => [...xml.matchAll(/^\t<key>([A-Za-z~]+)<\/key>/gm)].map((m) => m[1]!);

describe("the Info.plist patch", () => {
  it("adds every usage description and file key the plugins need, at the top level", () => {
    const { xml, added } = withInfoPlist(PLIST) as { xml: string; added: string[] };
    expect(added).toEqual(Object.keys(ENTRIES));
    for (const k of [
      "NSCameraUsageDescription",
      "NSPhotoLibraryUsageDescription",
      "NSPhotoLibraryAddUsageDescription",
      "NSLocationWhenInUseUsageDescription",
      "NSLocationAlwaysAndWhenInUseUsageDescription",
      "NSMicrophoneUsageDescription",
      "NSSpeechRecognitionUsageDescription",
      "UIFileSharingEnabled",
      "LSSupportsOpeningDocumentsInPlace",
      "CFBundleURLTypes",
      "CFBundleDocumentTypes",
    ]) {
      expect(keys(xml)).toContain(k);
    }
    // The microphone is for voice input (docs/29) only; nothing runs in the background.
    expect(xml).not.toContain("UIBackgroundModes");
    // The share extension opens the app with potyro://share — the scheme must be registered.
    expect(xml).toMatch(/<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>potyro<\/string>/);
    // What was there stays, and the document is still one dict closed once.
    expect(keys(xml)).toContain("CFBundleDisplayName");
    expect(xml.match(/<\/plist>/g)).toHaveLength(1);
    expect(xml.trimEnd().endsWith("</dict>\n</plist>")).toBe(true);
  });

  it("escapes the words it puts in XML and every description is a real sentence", () => {
    for (const text of Object.values(USAGE) as string[]) expect(text).toMatch(/^Potyro .+\.$/);
    const { xml } = withInfoPlist(PLIST) as { xml: string };
    expect(xml).not.toMatch(/<string>[^<]*&(?!amp;|lt;|gt;)[^<]*<\/string>/);
  });

  it("is idempotent, and leaves a wording changed in Xcode alone", () => {
    const once = (withInfoPlist(PLIST) as { xml: string }).xml;
    const twice = withInfoPlist(once) as { xml: string; added: string[] };
    expect(twice.added).toEqual([]);
    expect(twice.xml).toBe(once);
    const reworded = once.replace(/(<key>NSCameraUsageDescription<\/key>\s*<string>)[^<]*/, "$1Our own words.");
    expect((withInfoPlist(reworded) as { xml: string }).xml).toContain("Our own words.");
  });

  it("refuses a file that is not a plist, rather than writing a broken one", () => {
    expect(() => withInfoPlist("<html></html>")).toThrow(/Info\.plist/);
  });
});

describe("the deployment target", () => {
  const PBX = `buildSettings = {\n\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 15.0;\n\t\t\t};\n\t\t\tbuildSettings = {\n\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 18.2;\n\t\t\t};`;

  it(`raises what is below iOS ${MIN_IOS} and leaves a newer choice alone`, () => {
    const { text, raised } = withDeploymentTarget(PBX) as { text: string; raised: number };
    expect(raised).toBe(1);
    expect(text).toContain(`IPHONEOS_DEPLOYMENT_TARGET = ${MIN_IOS};`);
    expect(text).toContain("IPHONEOS_DEPLOYMENT_TARGET = 18.2;");
    expect((withDeploymentTarget(text) as { raised: number }).raised).toBe(0);
    expect((withDeploymentTarget("IPHONEOS_DEPLOYMENT_TARGET = 16.4;") as { raised: number }).raised).toBe(1);
  });
});

describe("files opened in place from Files", () => {
  const DELEGATE = `import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }
}
`;

  it("hands Capacitor a readable copy, once", () => {
    const once = withReadableOpenedFiles(DELEGATE) as { swift: string; changed: boolean };
    expect(once.changed).toBe(true);
    expect(once.swift).toContain("ApplicationDelegateProxy.shared.application(app, open: potyroReadableCopy(of: url), options: options)");
    expect(once.swift).toContain("startAccessingSecurityScopedResource");
    expect(once.swift.match(/fileprivate func potyroReadableCopy/g)).toHaveLength(1);
    const twice = withReadableOpenedFiles(once.swift) as { swift: string; changed: boolean };
    expect(twice.changed).toBe(false);
    expect(twice.swift).toBe(once.swift);
  });

  it("says so instead of guessing when the template changed", () => {
    const r = withReadableOpenedFiles("class AppDelegate {}") as { changed: boolean; reason: string };
    expect(r.changed).toBe(false);
    expect(r.reason).toMatch(/by hand/);
  });
});

describe("the Capacitor config", () => {
  it("pins both origins — changing one after release empties every phone", () => {
    expect(config.server?.androidScheme).toBe("https");
    expect(config.server?.iosScheme).toBe("capacitor");
    expect(config.server?.hostname).toBeUndefined();
    expect(config.server?.url).toBeUndefined();
  });

  it("gives the share plugin the same App Group the extension template writes to", async () => {
    expect((config.plugins?.CapacitorShareTarget as { appGroupId?: string }).appGroupId).toBe(IOS_APP_GROUP);
    const { readFileSync } = await import("node:fs");
    const swift = readFileSync(new URL("../ios-templates/ShareExtension/ShareViewController.swift", import.meta.url), "utf8");
    expect(swift).toContain(`private let appGroupId = "${IOS_APP_GROUP}"`);
    expect(swift).toContain('"share-target-data"'); // the key the plugin reads (its iOS source)
    expect(swift).toContain('URL(string: "potyro://share")'); // the scheme the plist patch registers
  });
});
