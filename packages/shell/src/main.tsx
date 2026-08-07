// Shell entry / composition root wiring. `pnpm dev` → trusted (recipes imported directly).
// `pnpm dev:sandbox` (mode "sandbox") → the same app UNTRUSTED in the QuickJS-WASM isolate.

import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { KartaApp, KartaRecord } from "karta";
import { createMemorySqliteStore, importSqliteStore, packBundle, unpackBundle, type Store } from "@karta/store";
import { openStore } from "./open-store.js";
import { createWebCapabilities, type Capabilities } from "@karta/capabilities";
import { maybeCreateNativeCapabilities } from "@karta/native";
import type { Provenance } from "@karta/host";
import type { KartaRuntime } from "@karta/runtime";
import { App } from "./App.js";
import { Studio } from "./studio.js";
import { Launcher, openBuiltinApp, openUserApp } from "./launcher.js";
import { getUserApp, listUserApps } from "./user-apps.js";
import { Toaster } from "./toaster.js";
import { compose, type Composed } from "./compose.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { NavHost } from "./nav-host.js";
import { Dialogs, shellDialogs } from "./dialog.js";
import { PickerHost } from "./picker.js";
import { seedIfEmpty } from "./seed.js";
import { startReminderSync } from "./reminder-sync.js";

const SANDBOX = import.meta.env.MODE === "sandbox";
const APPS = ["recipes", "plants", "places", "workout"] as const;
type AppId = (typeof APPS)[number];

// Route from the URL: a saved user app (?user=), a built-in example (?app=), or the launcher home.
type Route = { kind: "builtin"; id: AppId } | { kind: "user"; id: string } | { kind: "home" };
function route(): Route {
  const p = new URLSearchParams(location.search);
  const user = p.get("user");
  if (user && getUserApp(user)) return { kind: "user", id: user };
  const app = p.get("app");
  if (app && (APPS as readonly string[]).includes(app)) return { kind: "builtin", id: app as AppId };
  return { kind: "home" };
}

// Static specifiers so Vite can resolve each sandbox virtual module.
async function sandboxBundle(appId: AppId): Promise<string> {
  switch (appId) {
    case "recipes":
      return (await import("virtual:sandbox:recipes")).default;
    case "plants":
      return (await import("virtual:sandbox:plants")).default;
    case "places":
      return (await import("virtual:sandbox:places")).default;
    case "workout":
      return (await import("virtual:sandbox:workout")).default;
  }
}

// Export the current app as a portable `.karta.zip` bundle (KA-04): logic + a real SQLite data file
// + manifest + CSV/JSON, saved via the filesystem cap. The current data is snapshotted into a fresh
// in-memory SQLite so a genuine `data.sqlite` is produced from ANY durable store (even the LocalStore
// fallback) — the export never depends on the browser having OPFS.
async function exportApp(
  runtime: KartaRuntime,
  store: Store,
  caps: Capabilities,
  provenance: Provenance,
  appSource: string | undefined,
  toaster: Toaster,
): Promise<void> {
  const def = runtime.definition;
  const rowsByEntity: Record<string, KartaRecord[]> = {};
  for (const entity of Object.keys(def.entities)) rowsByEntity[entity] = await store.all(entity);

  const snapshot = await createMemorySqliteStore(def.id);
  try {
    for (const [entity, rows] of Object.entries(rowsByEntity)) {
      for (const row of rows) await snapshot.store.insert(entity, row);
    }
    const zip = packBundle({
      sqlite: snapshot.export(),
      manifest: {
        format: "karta-bundle/1",
        appId: def.id,
        appVersion: def.version,
        schemaVersion: def.schemaVersion,
        provenance,
        grantedCaps: Object.keys(def.permissions ?? {}),
        mode: "snapshot",
        exportedAt: new Date().toISOString(),
        entities: Object.keys(def.entities),
      },
      appSource,
      rowsByEntity,
    });
    await caps.filesystem.save(`${def.id}.karta.zip`, new Blob([zip as BlobPart], { type: "application/zip" }));
    toaster.push(`Exported ${def.id}.karta.zip`);
  } finally {
    snapshot.destroy();
  }
}

// Session-storage handoff for an import: the picked bundle's data.sqlite bytes (base64) survive the
// reload so the OPFS pool VFS is installed exactly once — on the fresh page — before the store opens.
const IMPORT_KEY = "karta:import";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Import a `.karta.zip` bundle's data into the matching app (KA-04): pick → unpack → stash the
// SQLite bytes → reload into that app, where boot() restores them into the durable store.
async function importApp(caps: Capabilities, toaster: Toaster): Promise<void> {
  let blob: Blob;
  try {
    blob = await caps.filesystem.pick();
  } catch {
    return; // cancelled
  }
  const zip = new Uint8Array(await blob.arrayBuffer());
  let appId: string;
  let sqlite: Uint8Array;
  try {
    const bundle = unpackBundle(zip);
    appId = bundle.manifest.appId;
    sqlite = bundle.sqlite;
  } catch {
    toaster.push("Not a valid Karta export bundle.");
    return;
  }
  if (!(APPS as readonly string[]).includes(appId)) {
    toaster.push(`No app "${appId}" installed to import into.`);
    return;
  }
  sessionStorage.setItem(IMPORT_KEY, bytesToBase64(sqlite));
  location.search = `?app=${appId}`; // reload → boot() detects the pending import
}

// The launcher home — first surface when no app is selected. Lists trusted examples + untrusted
// saved apps; a tile launches (reload → ?app / ?user); "New app" opens the Studio in place.
function Home() {
  const [studio, setStudio] = useState(false);
  return (
    <>
      <Launcher
        variant="home"
        builtins={APPS as readonly string[]}
        userApps={listUserApps()}
        onOpenBuiltin={openBuiltinApp}
        onOpenUser={openUserApp}
        onNewApp={() => setStudio(true)}
      />
      {studio ? <Studio onClose={() => setStudio(false)} /> : null}
    </>
  );
}

// One React root per document, reused.
//
// `mount` is called from several boot paths, and some of them run in sequence — a user app that has
// been deleted mounts the launcher after boot has already mounted something. Calling `createRoot` a
// second time on the same element makes React warn and leaves the first root orphaned, still
// subscribed to the store.
let reactRoot: ReturnType<typeof createRoot> | null = null;

function mount(root: HTMLElement, node: ReactNode): void {
  reactRoot ??= createRoot(root);
  reactRoot.render(
    <StrictMode>
      {node}
      {/* Once, around every route — home, a built-in, or a saved app. */}
      <Dialogs host={shellDialogs} />
    </StrictMode>,
  );
  registerServiceWorker();
}

// A built-in example: trusted (direct) by default, or untrusted (isolate) under `dev:sandbox`.
async function bootBuiltin(appId: AppId, root: HTMLElement, toaster: Toaster, caps: Capabilities): Promise<void> {
  const pending = sessionStorage.getItem(IMPORT_KEY);
  let store: Store;
  if (pending) {
    sessionStorage.removeItem(IMPORT_KEY);
    store = await importSqliteStore(appId, base64ToBytes(pending));
    toaster.push(`Imported data into ${appId}.`);
  } else {
    store = await openStore(appId);
    await seedIfEmpty(store, appId);
  }
  const picker = new PickerHost();
  const ui = createUiBridge(toaster.push, picker, shellDialogs);
  const navHost = new NavHost();
  const nav = createNavBridge((pageId, param) => navHost.navigate(pageId, param));

  const examples = import.meta.glob("../../../examples/*.app.ts", { import: "default" });
  const loadTrusted = examples[`../../../examples/${appId}.app.ts`] as (() => Promise<KartaApp>) | undefined;
  if (!loadTrusted) throw new Error(`example "${appId}" not found`);
  const app = await loadTrusted();

  let composed: Composed;
  let appSource: string | undefined;
  if (SANDBOX) {
    const { createSandboxLoader } = await import("./isolate-bridge.js");
    appSource = await sandboxBundle(appId);
    composed = await compose({ app, provenance: "untrusted", bundleCode: appSource, store, caps, ui, nav, loadIsolated: await createSandboxLoader(store) });
  } else {
    composed = await compose({ app, provenance: "trusted", store, caps, ui, nav });
  }
  startReminderSync(composed.runtime, store);

  const provenance: Provenance = SANDBOX ? "untrusted" : "trusted";
  mount(
    root,
    <App
      navHost={navHost}
      picker={picker}
      runtime={composed.runtime}
      provenance={provenance}
      toaster={toaster}
      appId={appId}
      apps={APPS as readonly string[]}
      currentKind="builtin"
      onExport={() => void exportApp(composed.runtime, store, caps, provenance, appSource, toaster)}
      onImport={() => void importApp(caps, toaster)}
      generator
    />,
  );
}

// A saved user app. UNTRUSTED by default (isolate); if the user promoted it, TRUSTED (direct) — the
// source runs as a real module. A trusted load that fails (e.g. an edited, invalid version) falls
// back to untrusted so the app still opens. Either way it has its own durable store.
/** A `#join=…` link means someone shared a synced app. Accept it, then open it as a normal app. */
async function bootInviteIfPresent(root: HTMLElement): Promise<string | null> {
  const { pendingInvite, acceptInvite } = await import("./share-sync.js");
  const invite = pendingInvite();
  if (!invite) return null;
  root.textContent = `Joining "${invite.name}"…`;
  try {
    const id = await acceptInvite(invite);
    // Drop the fragment so a reload does not re-accept, and so the secret stops sitting in the bar.
    history.replaceState(null, "", `${location.pathname}?user=${encodeURIComponent(id)}`);
    return id;
  } catch (e) {
    root.textContent = `Could not join: ${e instanceof Error ? e.message : String(e)}`;
    return null;
  }
}

async function bootUserApp(id: string, root: HTMLElement, toaster: Toaster, caps: Capabilities): Promise<void> {
  const saved = getUserApp(id);
  if (!saved) {
    mount(root, <Home />); // deleted out from under us → home
    return;
  }
  // Sync is per app (ADR 0001 D3): a Jazz-backed CRDT store when the user opted in, otherwise
  // exactly the previous SqliteStore/LocalStore path.
  const store = await openStore(`user:${id}`, { sync: saved.sync });
  const picker = new PickerHost();
  const ui = createUiBridge(toaster.push, picker, shellDialogs);
  const navHost = new NavHost();
  const nav = createNavBridge((pageId, param) => navHost.navigate(pageId, param));

  let composed: Composed;
  let provenance: Provenance = "untrusted";
  let appSource: string | undefined;

  if (saved.trusted) {
    try {
      const { loadTrustedModule } = await import("./trusted-loader.js");
      const app = await loadTrustedModule(saved.source); // real defineApp validates or throws
      composed = await compose({ provenance: "trusted", app, store, caps, ui, nav });
      provenance = "trusted";
    } catch (e) {
      toaster.push(`Couldn't run "${saved.name}" trusted; opening safely. ${e instanceof Error ? e.message : ""}`.trim());
    }
  }
  if (provenance === "untrusted") {
    const [{ createAppBundler }, { createSandboxLoader }] = await Promise.all([
      import("./app-bundler.js"),
      import("./isolate-bridge.js"),
    ]);
    appSource = await (await createAppBundler())(saved.source);
    composed = await compose({ provenance: "untrusted", bundleCode: appSource, store, caps, ui, nav, loadIsolated: await createSandboxLoader(store) });
  }
  startReminderSync(composed!.runtime, store);

  mount(
    root,
    <App
      navHost={navHost}
      picker={picker}
      runtime={composed!.runtime}
      provenance={provenance}
      toaster={toaster}
      appId={id}
      apps={APPS as readonly string[]}
      currentKind="user"
      onExport={() => void exportApp(composed!.runtime, store, caps, provenance, appSource, toaster)}
      generator
    />,
  );
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");

  // A shared link is handled before routing: it creates the local app, so the route it should land
  // on does not exist until the invite has been accepted.
  const joined = await bootInviteIfPresent(root);
  if (joined) {
    const toaster = new Toaster();
    const caps = (await maybeCreateNativeCapabilities()) ?? createWebCapabilities();
    await bootUserApp(joined, root, toaster, caps);
    return;
  }

  const r = route();
  if (r.kind === "home") {
    mount(root, <Home />);
    return;
  }

  const toaster = new Toaster();
  // Native (Capacitor) capabilities on a device — chiefly EXACT offline notifications — else web.
  // Only imported when actually on a device (web bundle stays Capacitor-free). Sole target-selection.
  const caps = (await maybeCreateNativeCapabilities()) ?? createWebCapabilities();

  if (r.kind === "user") await bootUserApp(r.id, root, toaster, caps);
  else await bootBuiltin(r.id, root, toaster, caps);
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  // NEVER in dev. The SW is cache-first, so in dev it serves stale modules indefinitely: an edit is
  // invisible until the cache happens to miss, and a route change (which is a real navigation —
  // `location.search = ...`) reliably replays the OLD bundle. Actively tear down any SW + caches a
  // previous dev session installed, otherwise it keeps serving this page forever.
  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister())));
    if ("caches" in globalThis) void caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))));
    return;
  }

  navigator.serviceWorker.register("/sw.js").catch(() => {
    /* offline SW is best-effort */
  });
}

boot().catch((err: unknown) => {
  const root = document.getElementById("root");
  if (root) root.textContent = `Boot error: ${err instanceof Error ? err.message : String(err)}`;
  // eslint-disable-next-line no-console
  console.error(err);
});
