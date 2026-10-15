// Potyro's Share Extension — "Add to Potyro" in the iOS share sheet (#213, #254). docs/27 §4.4.
//
// UNTESTED: written on Linux against the iOS 17 SDK documentation; nothing here has been compiled.
// Copy it over the ShareViewController.swift Xcode generates for a new Share Extension target.
//
// What it does, and the contract it keeps with the app (@capgo/capacitor-share-target 8.x, read from
// its iOS source):
//   1. Reads every attachment of every item: a text becomes a string, a web link its address, and
//      anything with bytes (a file from Files, a photo, a PDF) is COPIED into the App Group container,
//      because the system deletes the provider's own copy the moment the handler returns.
//   2. Writes { title, texts: [String], files: [{ uri, name, mimeType }] } to the App Group's
//      UserDefaults under "share-target-data". The plugin reads that key on launch, on `potyro://share`
//      and whenever the app becomes active, then removes it.
//   3. Tries to open Potyro (`potyro://share`). iOS may refuse an extension that opens its app; then
//      the share is simply waiting the next time the person opens Potyro (step 2's "becomes active").
//
// In the app, `filesOfShare` / `readSharedFile` (packages/native/src/share-target.ts) take each `uri`
// (a file:// URL in the group container) through `Capacitor.convertFileSrc` — the same path as Android.

import UIKit
import UniformTypeIdentifiers

@objc(ShareViewController)
class ShareViewController: UIViewController {
    /// Must equal IOS_APP_GROUP in packages/native/capacitor.config.ts, and be enabled under
    /// Signing & Capabilities → App Groups for BOTH the app and this extension.
    private let appGroupId = "group.app.potyro"
    private let appURL = URL(string: "potyro://share")!

    private var texts: [String] = []
    private var files: [[String: String]] = []

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { await receive() }
    }

    private func receive() async {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let title = items.first?.attributedTitle?.string ?? items.first?.attributedContentText?.string ?? ""
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            return finish() // App Group not set up: nothing can reach the app
        }
        let inbox = container.appendingPathComponent("shared/\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        for item in items {
            for provider in item.attachments ?? [] {
                await take(provider, into: inbox)
            }
        }

        let data: [String: Any] = ["title": title, "texts": texts, "files": files]
        if let defaults = UserDefaults(suiteName: appGroupId) {
            defaults.set(data, forKey: "share-target-data")
        }
        openApp()
        finish()
    }

    /// One attachment: text and links as text, everything else as a file.
    private func take(_ provider: NSItemProvider, into inbox: URL) async {
        let isFile = provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
        if !isFile, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL, !url.isFileURL {
                texts.append(url.absoluteString)
                return
            }
        }
        if !isFile, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                texts.append(text)
                return
            }
        }
        // Bytes: ask for the most specific type the provider offers, so the name keeps its extension.
        let type = provider.registeredTypeIdentifiers.first ?? UTType.data.identifier
        if let ref = await copyFile(from: provider, type: type, into: inbox) {
            files.append(ref)
        }
    }

    private func copyFile(from provider: NSItemProvider, type: String, into inbox: URL) async -> [String: String]? {
        await withCheckedContinuation { (done: CheckedContinuation<[String: String]?, Never>) in
            _ = provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                guard let url = url else { return done.resume(returning: nil) }
                let name = provider.suggestedName.map { n in
                    // suggestedName often drops the extension; put the file's own back.
                    (n as NSString).pathExtension.isEmpty && !url.pathExtension.isEmpty ? "\(n).\(url.pathExtension)" : n
                } ?? url.lastPathComponent
                let copy = inbox.appendingPathComponent(name)
                do {
                    try? FileManager.default.removeItem(at: copy)
                    try FileManager.default.copyItem(at: url, to: copy)
                } catch {
                    return done.resume(returning: nil)
                }
                let mime = UTType(filenameExtension: copy.pathExtension)?.preferredMIMEType ?? UTType(type)?.preferredMIMEType ?? ""
                done.resume(returning: ["uri": copy.absoluteString, "name": name, "mimeType": mime])
            }
        }
    }

    /// Extensions may not call UIApplication.open directly; reach the app object through the
    /// responder chain and call `openURL:options:completionHandler:` by selector. If iOS refuses, the
    /// share still arrives the next time Potyro becomes active.
    private func openApp() {
        let selector = NSSelectorFromString("openURL:options:completionHandler:")
        var responder: UIResponder? = self
        while let current = responder {
            if current.responds(to: selector), current is UIApplication {
                typealias Open = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, (@convention(block) (Bool) -> Void)?) -> Void
                let open = unsafeBitCast(current.method(for: selector), to: Open.self)
                open(current, selector, appURL as NSURL, NSDictionary(), nil)
                return
            }
            responder = current.next
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
