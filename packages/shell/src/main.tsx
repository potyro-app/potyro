// Shell entry / composition root wiring. `pnpm dev` → trusted (recipes imported directly).
// `pnpm dev:sandbox` (mode "sandbox") → the same app UNTRUSTED in the QuickJS-WASM isolate.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { KartaApp } from "karta";
import { createSqliteStore, LocalStore, type Store } from "@karta/store";
import { WebCapabilities } from "@karta/capabilities";
import { App } from "./App.js";
import { Toaster } from "./toaster.js";
import { compose, type Composed } from "./compose.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { seedIfEmpty } from "./seed.js";

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

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");

  const appId = selectedAppId();
  const toaster = new Toaster();
  const store = await openStore(appId); // durable OPFS SQLite, per-app namespace
  await seedIfEmpty(store, appId);

  const caps = new WebCapabilities();
  const ui = createUiBridge(toaster.push);
  const nav = createNavBridge(() => {}); // in-app nav is handled by App state

  // Load the chosen example. `import.meta.glob` keeps them out of strict tsc while Vite bundles them.
  const examples = import.meta.glob("../../../examples/*.app.ts", { import: "default" });
  const loadTrusted = examples[`../../../examples/${appId}.app.ts`] as (() => Promise<KartaApp>) | undefined;
  if (!loadTrusted) throw new Error(`example "${appId}" not found`);
  const app = await loadTrusted();

  let composed: Composed;
  if (SANDBOX) {
    const { createSandboxLoader } = await import("./isolate-bridge.js");
    const bundleCode = await sandboxBundle(appId);
    const loadIsolated = await createSandboxLoader(store);
    composed = await compose({ app, provenance: "untrusted", bundleCode, store, caps, ui, nav, loadIsolated });
  } else {
    composed = await compose({ app, provenance: "trusted", store, caps, ui, nav });
  }

  createRoot(root).render(
    <StrictMode>
      <App
        runtime={composed.runtime}
        provenance={SANDBOX ? "untrusted" : "trusted"}
        toaster={toaster}
        appId={appId}
        apps={APPS as readonly string[]}
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
