// Apply what the generated iOS project does not get on its own — the iOS twin of patch-manifest.mjs.
//
// `ios/` is generated (gitignored) like `android/`, so everything below is re-applied after every
// `cap add ios` / `cap sync ios`. Idempotent: a key already present is left as it is, so a wording the
// iOS developer changed in Xcode survives the next sync. NOTHING HERE HAS RUN ON A MAC YET (docs/27).
//
// Info.plist (ios/App/App/Info.plist):
//   NSCameraUsageDescription — `ctx.caps.camera` taking a photo, and the live camera (docs/25):
//     WKWebView's getUserMedia asks iOS for the camera, and without this key iOS KILLS the app the
//     moment it is asked, rather than refusing.
//   NSPhotoLibraryUsageDescription | NSPhotoLibraryAddUsageDescription — the camera plugin's photo
//     picker and its save-to-library path; @capacitor/camera's iOS setup requires both.
//   NSLocationWhenInUseUsageDescription — `ctx.caps.geo`. NSLocationAlwaysAndWhenInUseUsageDescription
//     too: @capacitor/geolocation links background-location code, and Apple rejects a build that
//     links it without the key, even though Potyro never asks for "always" and the prompt never shows.
//   UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace — exports land in the app's Documents
//     (`Directory.Documents`), which the Files app shows under "On My iPhone → Potyro" only with both.
//   CFBundleURLTypes `potyro` — the Share Extension opens the app with `potyro://share` (the share
//     plugin listens for it); nothing else uses the scheme.
//   CFBundleDocumentTypes (public.data, public.content) — "Open with Potyro" on any file, the iOS
//     counterpart of Android's ACTION_VIEW filter (#254).
// NOT here: no microphone key (the live camera never asks for audio), no background modes (local
// notifications need none), no ITSAppUsesNonExemptEncryption (an export-compliance answer the owner
// gives, docs/27 §7).
//
// AppDelegate.swift: a file opened IN PLACE from Files arrives as a security-scoped URL outside the
//   sandbox, which the WebView's file address cannot read. The patch copies it into the app's tmp
//   first and hands Capacitor the copy, so `readSharedFile` reads it like any other.
//
// project.pbxproj: IPHONEOS_DEPLOYMENT_TARGET raised to 17.0 — OffscreenCanvas WebGL in a worker
//   (faces) and the getUserMedia fixes landed in iOS 17; OPFS sync access handles need 16.4 (docs/27 §3).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MIN_IOS = "17.0";

/** Usage descriptions: the words iOS shows in its permission prompt. English; the strings are localised in Xcode later. */
export const USAGE = {
  NSCameraUsageDescription: "Potyro uses the camera when one of your apps takes a photo or shows the live camera.",
  NSPhotoLibraryUsageDescription: "Potyro opens your photos when you choose a picture for one of your apps.",
  NSPhotoLibraryAddUsageDescription: "Potyro saves a picture to your photos when you ask it to.",
  NSLocationWhenInUseUsageDescription: "Potyro uses your location when one of your apps asks for where you are.",
  NSLocationAlwaysAndWhenInUseUsageDescription: "Potyro uses your location only while you use it, when one of your apps asks for where you are.",
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Each entry as the plist XML it adds, keyed by its top-level key. */
export const ENTRIES = {
  ...Object.fromEntries(Object.entries(USAGE).map(([k, v]) => [k, `<key>${k}</key>\n\t<string>${esc(v)}</string>`])),
  UIFileSharingEnabled: "<key>UIFileSharingEnabled</key>\n\t<true/>",
  LSSupportsOpeningDocumentsInPlace: "<key>LSSupportsOpeningDocumentsInPlace</key>\n\t<true/>",
  CFBundleURLTypes: `<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>app.potyro</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>potyro</string>
			</array>
		</dict>
	</array>`,
  CFBundleDocumentTypes: `<key>CFBundleDocumentTypes</key>
	<array>
		<dict>
			<key>CFBundleTypeName</key>
			<string>Any file</string>
			<key>CFBundleTypeRole</key>
			<string>Viewer</string>
			<key>LSHandlerRank</key>
			<string>Alternate</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>public.data</string>
				<string>public.content</string>
			</array>
		</dict>
	</array>`,
};

const hasKey = (xml, key) => xml.includes(`<key>${key}</key>`);

/** Info.plist with whatever it is missing added, and what that was. Pure, so a test can hold it. */
export function withInfoPlist(xml) {
  const missing = Object.keys(ENTRIES).filter((k) => !hasKey(xml, k));
  if (missing.length === 0) return { xml, added: [] };
  // The top-level dict closes right before </plist>; new keys go at its end.
  const close = /<\/dict>\s*<\/plist>\s*$/;
  if (!close.test(xml)) throw new Error("Info.plist does not end in </dict></plist> — not the file Capacitor generates?");
  const block = missing.map((k) => `\t${ENTRIES[k]}\n`).join("");
  return { xml: xml.replace(close, `${block}</dict>\n</plist>\n`), added: missing };
}

/** project.pbxproj with every deployment target below MIN_IOS raised to it. Pure. */
export function withDeploymentTarget(pbxproj, min = MIN_IOS) {
  let raised = 0;
  const below = (v) => {
    const [a, b = 0] = v.split(".").map(Number);
    const [ma, mb = 0] = min.split(".").map(Number);
    return a < ma || (a === ma && b < mb);
  };
  const text = pbxproj.replace(/IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);/g, (whole, v) => {
    if (!below(v)) return whole;
    raised++;
    return `IPHONEOS_DEPLOYMENT_TARGET = ${min};`;
  });
  return { text, raised };
}

const PROXY_CALL = "return ApplicationDelegateProxy.shared.application(app, open: url, options: options)";
const MARK = "potyroReadableCopy";

/** The helper appended to AppDelegate.swift. Compiles against UIKit/Foundation only. UNTESTED on a Mac. */
export const READABLE_COPY = `
// Potyro (packages/native/scripts/patch-plist.mjs): a file opened in place from Files is a
// security-scoped URL outside the sandbox, which the WebView cannot read through its file address.
// Copy it into tmp while access is granted and hand Capacitor the copy; anything else passes through.
fileprivate func ${MARK}(of url: URL) -> URL {
    guard url.isFileURL else { return url }
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("opened", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let copy = dir.appendingPathComponent(url.lastPathComponent)
    var result = url
    var coordinationError: NSError?
    NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readable in
        try? FileManager.default.removeItem(at: copy)
        if (try? FileManager.default.copyItem(at: readable, to: copy)) != nil { result = copy }
    }
    return result
}
`;

/** AppDelegate.swift with opened files copied before Capacitor sees them, once. Pure. */
export function withReadableOpenedFiles(swift) {
  if (swift.includes(MARK)) return { swift, changed: false, reason: "already patched" };
  if (!swift.includes(PROXY_CALL)) return { swift, changed: false, reason: "the template changed: add the copy by hand (docs/27 §4.5)" };
  const next = swift.replace(PROXY_CALL, `return ApplicationDelegateProxy.shared.application(app, open: ${MARK}(of: url), options: options)`);
  return { swift: `${next.trimEnd()}\n${READABLE_COPY}`, changed: true, reason: "opened files are copied before Capacitor reads them" };
}

function patch(path, label, fn) {
  if (!existsSync(path)) {
    console.error(`[patch-plist] ${path} not found — run \`pnpm cap:add:ios\` first.`);
    process.exit(1);
  }
  const before = readFileSync(path, "utf8");
  const { after, said } = fn(before);
  if (after !== before) writeFileSync(path, after);
  console.log(`[patch-plist] ${label}: ${said}`);
}

// Running it (rather than importing it) patches the generated project.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const at = (p) => fileURLToPath(new URL(`../ios/App/${p}`, import.meta.url));
  patch(at("App/Info.plist"), "Info.plist", (xml) => {
    const r = withInfoPlist(xml);
    return { after: r.xml, said: r.added.length ? `added ${r.added.join(", ")}` : "nothing missing" };
  });
  patch(at("App.xcodeproj/project.pbxproj"), "deployment target", (text) => {
    const r = withDeploymentTarget(text);
    return { after: r.text, said: r.raised ? `raised ${r.raised} setting(s) to iOS ${MIN_IOS}` : `already iOS ${MIN_IOS}+` };
  });
  patch(at("App/AppDelegate.swift"), "AppDelegate.swift", (swift) => {
    const r = withReadableOpenedFiles(swift);
    return { after: r.swift, said: r.reason };
  });
}
