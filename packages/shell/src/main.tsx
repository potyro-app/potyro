// Shell entry / composition root wiring. `pnpm dev` → trusted (recipes imported directly).
// `pnpm dev:sandbox` (mode "sandbox") → the same app UNTRUSTED in the QuickJS-WASM isolate.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { KartaApp, KartaRecord } from "karta";
import { createSqliteStore, LocalStore, packBundle, SqliteStore, type Store } from "@karta/store";
import { createWebCapabilities, type Capabilities } from "@karta/capabilities";
import type { Provenance } from "@karta/host";
import type { KartaRuntime } from "@karta/runtime";
import { App } from "./App.js";
import { Toaster } from "./toaster.js";
import { compose, type Composed } from "./compose.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { seedIfEmpty } from "./seed.js";
import { startReminderSync } from "./reminder-sync.js";

const SANDBOX = import.meta.env.MODE === "sandbox";
const APPS = ["recipes", "plants", "places", "workout"] as const;
type AppId = (typeof APPS)[number];

function selectedAppId(): AppId {
  const q = new URLSearchParams(location.search).get("app");
  return (APPS as readonly string[]).includes(q ?? "") ? (q as AppId) : "recipes";
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

// Durable store for the web target: OPFS-backed SQLite (KA-01). Falls back to LocalStore where the
// OPFS SAH-pool VFS is unavailable (older browsers / no cross-origin isolation), so the app still
// runs — just less durable. Swapping the store implementation is confined to this composition root.
async function openStore(appId: AppId): Promise<Store> {
  try {
    return await createSqliteStore(appId);
  } catch (err) {
    console.warn("[karta] SqliteStore unavailable; falling back to LocalStore.", err);
    const store = new LocalStore();
    await store.open(appId);
    return store;
  }
}

// Export the current app as a portable `.karta.zip` bundle (KA-04): logic + a real SQLite data file
// + manifest + CSV/JSON, saved via the filesystem cap. Requires the durable SQLite store.
async function exportApp(
  runtime: KartaRuntime,
  store: Store,
  caps: Capabilities,
  provenance: Provenance,
  appSource: string | undefined,
  toaster: Toaster,
): Promise<void> {
  if (!(store instanceof SqliteStore)) {
    toaster.push("Export needs the SQLite store (unavailable in this browser).");
    return;
  }
  const def = runtime.definition;
  const rowsByEntity: Record<string, KartaRecord[]> = {};
  for (const entity of Object.keys(def.entities)) rowsByEntity[entity] = await store.all(entity);

  const zip = packBundle({
    sqlite: store.exportSqlite(),
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
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");

  const appId = selectedAppId();
  const toaster = new Toaster();
  const store = await openStore(appId); // durable OPFS SQLite, per-app namespace
  await seedIfEmpty(store, appId);

  const caps = createWebCapabilities();
  const ui = createUiBridge(toaster.push);
  const nav = createNavBridge(() => {}); // in-app nav is handled by App state

  // Load the chosen example. `import.meta.glob` keeps them out of strict tsc while Vite bundles them.
  const examples = import.meta.glob("../../../examples/*.app.ts", { import: "default" });
  const loadTrusted = examples[`../../../examples/${appId}.app.ts`] as (() => Promise<KartaApp>) | undefined;
  if (!loadTrusted) throw new Error(`example "${appId}" not found`);
  const app = await loadTrusted();

  let composed: Composed;
  let appSource: string | undefined;
  if (SANDBOX) {
    const { createSandboxLoader } = await import("./isolate-bridge.js");
    appSource = await sandboxBundle(appId); // the untrusted app's bundled logic, for the export
    const loadIsolated = await createSandboxLoader(store);
    composed = await compose({ app, provenance: "untrusted", bundleCode: appSource, store, caps, ui, nav, loadIsolated });
  } else {
    composed = await compose({ app, provenance: "trusted", store, caps, ui, nav });
  }

  // Keep reminder notifications reconciled with the data (on load + on change). No-op on web
  // (no notification cap) — the in-app "due" view covers it; native (KA-03) schedules exactly.
  startReminderSync(composed.runtime, store);

  createRoot(root).render(
    <StrictMode>
      <App
        runtime={composed.runtime}
        provenance={SANDBOX ? "untrusted" : "trusted"}
        toaster={toaster}
        appId={appId}
        apps={APPS as readonly string[]}
        onExport={() => void exportApp(composed.runtime, store, caps, SANDBOX ? "untrusted" : "trusted", appSource, toaster)}
      />
    </StrictMode>,
  );

  registerServiceWorker();
}

function registerServiceWorker(): void {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline SW is best-effort */
    });
  }
}

boot().catch((err: unknown) => {
  const root = document.getElementById("root");
  if (root) root.textContent = `Boot error: ${err instanceof Error ? err.message : String(err)}`;
  // eslint-disable-next-line no-console
  console.error(err);
});
