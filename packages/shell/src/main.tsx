// Shell entry / composition root wiring. Every app — the seeded examples included (#152) — is a
// saved source: trusted ones run direct, untrusted ones sealed — in the browser realm (#272), or the
// QuickJS-WASM isolate behind a flag (sandbox-runner.ts). `pnpm dev:sandbox` (mode "sandbox") seeds
// the examples untrusted, which is what exercises the sealed box.

// First, before any module below reads localStorage: the codename-to-product key move (#114).
import { plural, t } from "@lingui/core/macro";
import "./rename-migration.js";
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { PotyroRecord } from "potyro";
import { copyStoreData, createMemorySqliteStore, declareApp, isReservedPath, isStorageElsewhere, packBundle, unpackBundle, type Store } from "@potyro/store";
import { watchStorageOwner } from "./storage-elsewhere.js";
import { appCode, modulesOf } from "./app-modules.js";
import { openStore } from "./open-store.js";
import { setShellCaps } from "./shell-caps.js";
import { capsWithAi } from "./app-ai-caps.js";
import { guardedStore } from "./read-only-store.js";
import { AppLock } from "./app-lock.js";
import { migrateOnLoad } from "./migrate-on-load.js";
import { getLaunchUrl, onUrlOpen, systemLanguages } from "@potyro/native";
import { setSystemLanguages, startI18n } from "@potyro/i18n";
import { createWebCapabilities, type Capabilities } from "@potyro/capabilities";
import { isOpenedFile, keepStorage, listenForShares, maybeCreateNativeCapabilities, maybeCreateNativeSourceHttp, maybeCreateNativeVault, nameFromUri } from "@potyro/native";
import { setSourceHttp } from "./ask-sources.js";
import { browserVault, deferredVault, secureIdentitySecrets, setSecretVault } from "@potyro/identity";
import type { Provenance } from "@potyro/host";
import type { PotyroRuntime } from "@potyro/runtime";
import { App } from "./App.js";
import { Studio } from "./studio.js";
import { Launcher, openInstalledApp } from "./launcher.js";
import { applyLook } from "./look.js";
import { appKey, recordOpen, recordSignals } from "./launcher-store.js";
import { pauseTiles, watchTile } from "./tile-runner.js";
import { seedExamples } from "./examples.js";
import { restoreScope } from "./scope.js";
import { getUserApp, listUserApps } from "./user-apps.js";
import { Toaster } from "./toaster.js";
import { compose, type Composed } from "./compose.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { NavHost } from "./nav-host.js";
import { Dialogs, shellDialogs } from "./dialog.js";
import { askToIncludeChat } from "./share-chat.js";
import { UiHost } from "./ui-host.js";
import { PickerHost } from "./picker.js";
import { openAppStore, syncAllowedFor } from "./app-store.js";
import { Splash } from "./splash.js";
import { startReminderSync, watchReminderTimes } from "./reminder-sync.js";
import { navigateTo, setRouteHandler, type ShellRoute } from "./router.js";
import { DataPage } from "./data-page.js";
import { SharePage } from "./share-page.js";
import { rememberShare } from "./share-inbox.js";
import { IncomingFiles } from "./incoming-files-host.js";
import { receiveSharedFiles } from "./incoming-files.js";
import { watchLiveCamera } from "./camera-indicator.js";
import { loadFaces } from "./faces/faces-loader.js";
import { readDemoLink, type DemoLink } from "./demo-link.js";

// `sandbox-quickjs` is the same, with shared apps in the QuickJS fallback (sandbox-runner.ts).
const SANDBOX = import.meta.env.MODE === "sandbox" || import.meta.env.MODE === "sandbox-quickjs";

// Route from the URL: a saved app (?user=, or the older ?app= that named an example) or the home.
// The examples are ordinary apps (#152), so `?app=recipes` is the same app as `?user=recipes`.
type Route = ShellRoute;
function route(): Route {
  const p = new URLSearchParams(location.search);
  if (p.has("data")) return { kind: "data", ...(p.get("data") ? { id: p.get("data")! } : {}), ...(p.has("files") ? { files: true } : {}) };
  if (p.has("share")) return { kind: "share" };
  const id = p.get("user") ?? p.get("app");
  if (id && getUserApp(id)) return { kind: "user", id };
  return { kind: "home" };
}

// Export the current app as a portable `.potyro.zip` bundle (KA-04): logic + a real SQLite data file
// + manifest + CSV/JSON, saved via the filesystem cap. The current data is snapshotted into a fresh
// in-memory SQLite so a genuine `data.sqlite` is produced from ANY durable store (even the LocalStore
// fallback) — the export never depends on the browser having OPFS.
async function exportApp(
  runtime: PotyroRuntime,
  store: Store,
  caps: Capabilities,
  provenance: Provenance,
  appSource: string | undefined,
  toaster: Toaster,
  /** The saved app, whose Studio conversation may go along — only if the person says so (#261). */
  appId?: string,
): Promise<void> {
  const def = runtime.definition;
  // Asked before anything is packed, so the answer is the first thing that happens after Export.
  const chat = appId ? await askToIncludeChat(appId) : undefined;
  const rowsByEntity: Record<string, PotyroRecord[]> = {};
  for (const entity of Object.keys(def.entities)) rowsByEntity[entity] = await store.all(entity);

  const snapshot = await createMemorySqliteStore(def.id);
  try {
    // `copyStoreData`, not a loop of inserts. The loop copied RECORDS, and a record's photo is a
    // reference — `{key, mime}` — to bytes held beside it. So an export of an app full of pictures
    // was a few kilobytes of pointers to nothing, and importing it gave you records whose images
    // would not load. Measured before the fix: a 1MB photo exported as a 3KB bundle.
    //
    // The app's code (`.modules/`, `.src/`) is not its data: it goes beside the data, with the lock
    // that vouches for it (#282), so the bundle restores on a device with no network.
    const copied = await copyStoreData(store, snapshot.store, { entities: Object.keys(def.entities), skipFile: isReservedPath });
    // A shared app's files that never reached this device are listed, not fetched for the export (#255).
    const missingFiles = copied.skippedFiles.map(({ path, size }) => ({ path, size }));
    const lock = appId ? getUserApp(appId)?.lock : undefined;
    const code = await appCode((await modulesOf(appId)) ?? store, lock);
    const zip = packBundle({
      sqlite: snapshot.export(),
      manifest: {
        format: "potyro-bundle/1",
        appId: def.id,
        appVersion: def.version,
        schemaVersion: def.schemaVersion,
        provenance,
        grantedCaps: Object.keys(def.permissions ?? {}),
        mode: "snapshot",
        exportedAt: new Date().toISOString(),
        entities: Object.keys(def.entities),
        // What the app is, as data: a device adding this bundle describes it without running it (#271).
        app: declareApp(def),
        ...(missingFiles.length ? { missingFiles } : {}),
      },
      appSource,
      chat,
      rowsByEntity,
      lock,
      code,
    });
    await caps.filesystem.save(`${def.id}.potyro.zip`, new Blob([zip as BlobPart], { type: "application/zip" }));
    const file = `${def.id}.potyro.zip`;
    const notHere = missingFiles.length;
    toaster.push(
      notHere
        ? plural(notHere, { one: `Exported ${file}. # file is not on this device yet, so it is listed in the export but not inside it.`, other: `Exported ${file}. # files are not on this device yet, so they are listed in the export but not inside it.` })
        : t`Exported ${file}`,
    );
  } finally {
    snapshot.destroy();
  }
}

// Session-storage handoff for an import: the picked bundle's data.sqlite bytes (base64) survive the
// reload so the OPFS pool VFS is installed exactly once — on the fresh page — before the store opens.
const IMPORT_KEY = "potyro:import";

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

/**
 * Replace an app's records with a bundle's (KA-04), in whatever store the app uses.
 *
 * This used to hand the bundle's SQLite file to OPFS directly, which is only there where OPFS SQLite
 * is — everywhere else (Firefox, the LocalStore fallback, a locked-down browser) the app failed to
 * boot with "Missing required OPFS APIs". The file is now opened as an in-memory database, which
 * works anywhere, and its rows are copied into the app's own store with their ids, dates, photos and
 * app storage intact. The records it replaces are removed first, so what you import is what you have.
 */
async function replaceWithBundle(target: Store, pending: string, appId: string): Promise<void> {
  let stash: { sqlite: string; entities?: string[] };
  try {
    stash = JSON.parse(pending) as { sqlite: string; entities?: string[] };
  } catch {
    stash = { sqlite: pending }; // stashed by a build that kept only the bytes
  }
  const entities = stash.entities?.length
    ? stash.entities
    : (await (await import("./app-source.js")).inspect(getUserApp(appId)?.source ?? "")).entities.map((e) => e.key);
  const bundle = await createMemorySqliteStore(appId, { bytes: base64ToBytes(stash.sqlite) });
  try {
    for (const entity of entities) {
      for (const row of await target.all(entity)) await target.delete(entity, row.id);
    }
    // Data only: the app keeps its own code. A bundle from before #282 has that code in its database,
    // and an older copy of one of the app's modules put over its own would stop it opening.
    await copyStoreData(bundle.store, target, { entities, skipFile: isReservedPath });
  } finally {
    bundle.destroy();
  }
}

// Import a `.potyro.zip` bundle's data into the matching app (KA-04): pick → unpack → stash the
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
  let entities: string[];
  try {
    const bundle = unpackBundle(zip);
    appId = bundle.manifest.appId;
    sqlite = bundle.sqlite;
    entities = bundle.manifest.entities ?? [];
  } catch {
    toaster.push(t`Not a valid Potyro export bundle.`);
    return;
  }
  const target = getUserApp(appId);
  if (!target) {
    toaster.push(t`No app "${appId}" installed to import into.`);
    return;
  }
  if (target.sync) {
    const name = target.name;
    toaster.push(t`"${name}" is synced; a data import would overwrite what others share.`);
    return;
  }
  sessionStorage.setItem(IMPORT_KEY, JSON.stringify({ sqlite: bytesToBase64(sqlite), entities }));
  location.search = `?user=${encodeURIComponent(appId)}`; // reload → boot() detects the pending import
}

// The launcher home — first surface when no app is selected. A tile launches (reload → ?user=);
// "New app" opens the Studio in place.
function Home() {
  const [studio, setStudio] = useState<{ prefill?: string; draftId?: string } | null>(null);
  return (
    <>
      <Launcher
        variant="home"
        onOpen={openInstalledApp}
        onNewApp={(prefill) => setStudio({ prefill })}
        onResumeDraft={(draftId) => setStudio({ draftId })}
      />
      {studio ? <Studio onClose={() => setStudio(null)} initialDescription={studio.prefill} initialDraftId={studio.draftId} /> : null}
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
      {/* Files dropped on Potyro, shared to it or opened with it (#254). */}
      <IncomingFiles />
    </StrictMode>,
  );
  registerServiceWorker();
  registerDeepLinks();
  registerShares();
}

// A saved user app. UNTRUSTED by default (isolate); if the user promoted it, TRUSTED (direct) — the
// source runs as a real module. A trusted load that fails (e.g. an edited, invalid version) falls
// back to untrusted so the app still opens. Either way it has its own durable store.
/** A `#join=…` link means someone shared a synced app. Accept it, then open it as a normal app. */
/** The app joined, null when there was no invite, false when joining failed and said so. */
async function bootInviteIfPresent(root: HTMLElement): Promise<string | null | false> {
  const { pendingInvite, acceptInvite, usesCustomViews } = await import("./share-sync.js");
  // Web: the address bar. Device COLD start: the app was launched by the link, so nothing has
  // listened yet and the URL must be fetched. (Warm starts are handled by the listener below.)
  const launched = (await getLaunchUrl()) ?? undefined;
  // Launched by "Open with Potyro" on a file (#254): offered once the shell is on screen, like a drop.
  if (launched && isOpenedFile(launched)) void receiveSharedFiles([{ uri: launched, name: nameFromUri(launched), mimeType: "" }]);
  const invite = pendingInvite() ?? pendingInvite(launched);
  if (!invite) return null;

  // Ask BEFORE opening. A shared app runs sandboxed by default, and a sandboxed app whose screens
  // are its own code renders nothing — so opening first and asking later meant landing in an empty
  // app with a message about a control you had not found yet.
  // `shellDialogs` renders through a mounted host; at this point in boot nothing is on screen yet,
  // so the prompt would resolve into a void. Mount SOMETHING first — `mount` brings the dialog host
  // with it — plus a line of context so the page is not blank behind the question.
  // Modern links state this outright; legacy ones still carry the source to inspect.
  const custom = invite.custom ?? (invite.source ? usesCustomViews(invite.source) : false);
  mount(
    root,
    <Splash name={invite.name} source={invite.source} verb="Joining" />,
  );
  // Joining IS the consent sync needs (KA-23): the question says what syncing means before anyone
  // answers it, and declining trust still joins — sandboxed, which is the safer half, not a refusal.
  const invited = invite.name;
  const trust = await shellDialogs.confirm(t`“${invited}” was shared with you.`, {
    detail: custom
      ? t`Its data syncs with the people sharing it: what the app writes on this device, they can read. Its screens are built with its own code, so it needs to run as yours to show them. You can change this later from the app header.`
      : t`Its data syncs with the people sharing it: what the app writes on this device, they can read. Apps from other people run in the sealed box unless you say otherwise. You can change this later from the app header.`,
    ok: t`Join, run it as yours`,
    cancel: t`Join, keep it sealed`,
  });

  // Asked after trust and before joining. After, because "do you trust this app?" is the question
  // the user opened the link to answer and nothing should come between them and it. Before, because
  // joining is what materialises your account for the people already in the space — answer later and
  // the person who invited you watches "Me" arrive.
  const { askNameIfUnnamed } = await import("./identity-panel.js");
  await askNameIfUnnamed();

  try {
    const id = await acceptInvite(invite, trust);
    // Drop the fragment so a reload does not re-accept, and so the secret stops sitting in the bar.
    history.replaceState(null, "", `${location.pathname}?user=${encodeURIComponent(id)}`);
    return id;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    // Through React, on the screen that was joining: emptying the root by hand left React rendering
    // into a container it no longer owned ("root container was removed without using React").
    mount(root, <Splash name={invite.name} source={invite.source} verb="Joining" failed={t`Could not join: ${why}`} />);
    return false;
  }
}

/**
 * A demo link (docs/24): the app in it, running straight away — sealed, on records in memory, with
 * nothing installed and no question asked before it is on screen. Nothing here touches this device's
 * apps, identity or storage; "Keep this app" is the ordinary Add-an-app card.
 */
async function bootDemo(root: HTMLElement, link: DemoLink): Promise<void> {
  const caps = (await maybeCreateNativeCapabilities()) ?? createWebCapabilities();
  setShellCaps(caps);
  const [{ loadDemoPackage, openDemo, demoName, DemoScreen, DemoDeclined, leaveDemoPath }, { shareEvent }] = await Promise.all([import("./demo.js"), import("./share-events.js")]);
  // Anywhere a demo goes next — home, an app it was kept as — is the shell at the site's root, by a
  // page load: the demo's runtime is not one the router knows how to put away.
  setRouteHandler(() => {
    leaveDemoPath();
    return false;
  });
  const shared = t({ message: "Shared app", comment: "A demo app whose name could not be read" });
  let pkg: Awaited<ReturnType<typeof loadDemoPackage>>;
  mount(root, <Splash name={shared} />);
  try {
    pkg = await loadDemoPackage(link);
  } catch (e) {
    mount(root, <Splash name={shared} failed={e instanceof Error ? e.message : String(e)} />);
    return;
  }
  const name = demoName(pkg);
  mount(root, <Splash name={name} source={pkg.source} />);
  try {
    const session = await openDemo(pkg, caps);
    shareEvent("demo-opened");
    mount(root, <DemoScreen session={session} pkg={pkg} />);
  } catch (e) {
    const why =
      e instanceof DemoDeclined
        ? t`It needs a library from the internet to open, and you said not now.`
        : e instanceof Error
          ? e.message
          : String(e);
    mount(root, <Splash name={name} source={pkg.source} failed={why} action={{ label: t`Try again`, run: async () => location.reload() }} />);
  }
}

/** Run pending migrations, reporting rather than crashing the app if they fail. */
async function runMigrationsIfPossible(
  definition: Parameters<typeof migrateOnLoad>[1],
  store: Parameters<typeof migrateOnLoad>[0],
  toaster: Toaster,
): Promise<void> {
  try {
    const { ran, from } = await migrateOnLoad(store, definition);
    if (ran.length) {
      const was = from ?? "";
      const to = definition.version;
      toaster.push(t`Updated your data from ${was} to ${to}.`);
    }
  } catch (e) {
    // A failed migration must not leave the user staring at a blank screen with no explanation.
    // The app still opens; the data is simply not migrated yet.
    console.warn("[potyro] migration failed:", e);
    const why = e instanceof Error ? e.message : String(e);
    toaster.push(t`Could not update your data: ${why}`);
  }
}

/** How many apps are open and not yet put away — exposed in dev so a spec can see switching leaks nothing. */
function liveApps(delta: number): void {
  if (!import.meta.env.DEV) return;
  const g = globalThis as unknown as { __potyroLiveApps?: number };
  g.__potyroLiveApps = (g.__potyroLiveApps ?? 0) + delta;
}

/** An open app, and how to put it away when another route takes the screen (#89). */
interface Opened {
  sync: boolean;
  dispose: () => Promise<void>;
}

async function bootUserApp(id: string, root: HTMLElement, toaster: Toaster, caps: Capabilities, isCurrent: () => boolean = () => true): Promise<Opened | null> {
  const saved = getUserApp(id);
  if (!saved) {
    mount(root, <Home />); // deleted out from under us → home
    return null;
  }

  // Mount BEFORE anything that can ask a question. This is load-bearing, not cosmetic.
  //
  // `shellDialogs.confirm` returns a promise that settles only when a `<Dialogs>` host renders the
  // request and someone answers it. Boot awaits one of those — "this app was updated by someone you
  // share it with" — seventy lines before the app was mounted, so on a device that had an update
  // waiting the promise could never settle: boot stopped there and the page stayed WHITE. Forever,
  // through every reload, because the same update was still pending on the next boot.
  //
  // It needed two devices and an edit on one of them to happen at all, which is why it survived: the
  // update path has no unit coverage that can see a React tree, and every browser spec that shared
  // an app either never edited it afterwards or never reopened the other device.
  //
  // `mount` brings the dialog host with it, so mounting anything is enough. A line of text is also
  // the honest thing to show while a CRDT store, an identity and a space are being opened.
  mount(
    root,
    <Splash id={id} name={saved.name} source={saved.source} />,
  );

  // Sync is per app (ADR 0001 D3): a Jazz-backed CRDT store when the user opted in, otherwise
  // exactly the previous SqliteStore/LocalStore path.
  // A data import (KA-04) lands here after the reload it triggers. Otherwise the store opens, and
  // an empty one gets its first-run rows from `seedIfEmpty` — keyed by app id, so the examples are
  // filled the way they always were, now as ordinary apps (#152).
  // An app someone else wrote may only open its SYNCED store once this device has agreed to that
  // (KA-23). Denied, or never asked — an imported app whose `sync` flag came in a bundle — it opens
  // local-only rather than failing: that is what the permission means.
  const syncAllowed = !saved.sync || (await syncAllowedFor(saved));
  if (saved.sync && !syncAllowed) {
    const name = saved.name;
    toaster.push(t`“${name}” runs on this device only: it has not been allowed to sync.`);
  }

  // Who this device is (KA-18), before the store: minted on first run with crypto alone — no
  // database, no network — so seed rows can be attributed to the person using the app.
  const { ensureIdentity } = await import("@potyro/identity");
  const me = await ensureIdentity();

  let rawStore: Store;
  // Its data, from where it is — never from a stand-in (open-store.ts `StoreBusyError`): an app opened
  // on another store would run without its records and its files. The screen says why, and Try again
  // opens it once the other tab has let go.
  const retry = { label: t`Try again`, run: async () => location.reload() };
  // A launcher tile being run from the home screen holds its app's store for a moment; the app being
  // opened waits for it rather than racing it for the same database (tile-runner.ts).
  const resumeTiles = await pauseTiles();
  try {
    const pending = sessionStorage.getItem(IMPORT_KEY);
    if (pending && !(syncAllowed && saved.sync)) {
      rawStore = await openStore(`user:${id}`, { sync: false });
      sessionStorage.removeItem(IMPORT_KEY);
      try {
        await replaceWithBundle(rawStore, pending, id);
        const name = saved.name;
        toaster.push(t`Imported data into ${name}.`);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        toaster.push(t`Could not import that data: ${why}`);
      }
    } else {
      // Seeded when empty, never when joined — the same open the Data panel uses (app-store.ts).
      rawStore = await openAppStore(saved, { sync: syncAllowed && Boolean(saved.sync), me: me.id });
    }
  } catch (e) {
    resumeTiles();
    // Another tab owns the storage: the whole tab already says so, with "Use it here".
    if (isStorageElsewhere(e)) return null;
    mount(root, <Splash id={id} name={saved.name} source={saved.source} failed={e instanceof Error ? e.message : String(e)} action={retry} />);
    return null;
  }
  resumeTiles();

  // The files it shipped with (`levels.json`), before any of its code runs: one that is not here
  // would fail the app in its own words, which read like its bug. The screen says what is missing,
  // and puts it back from the link it came from when there is one.
  {
    const { missingShipped, describeMissingShipped, reinstallShipped } = await import("./shipped-files.js");
    const missing = await missingShipped(rawStore, saved);
    if (missing.length) {
      const store = rawStore;
      const reinstall = saved.link
        ? {
            label: t`Reinstall its files`,
            run: async () => {
              const still = await reinstallShipped(saved, store);
              if (still.length) throw new Error(describeMissingShipped(still));
              location.reload();
            },
          }
        : undefined;
      const how = saved.link ? "" : ` ${t`Add it again from its package, and choose “Replace it, keep its data”: its records stay.`}`;
      mount(root, <Splash id={id} name={saved.name} source={saved.source} failed={`${describeMissingShipped(missing)}${how}`} action={reinstall} />);
      return null;
    }
  }

  // `ctx.me` is always present, which is what lets app code stop branching on whether identity
  // exists; the same person whether or not this app has ever synced.

  // The space, for `ctx.space` — only for a synced app. Solo stays `undefined` rather than becoming
  // a one-member space object, so `ctx.space?.members ?? [ctx.me]` reads correctly and app code
  // never has to ask whether sync is on.
  const space = syncAllowed && saved.sync
    ? await (async () => {
        const { currentSpace, liveSpace, watchSpace } = await import("./open-store.js");
        const s = await currentSpace();
        if (!s) return undefined;
        // Keep it current from here on: membership changes when someone joins, and a snapshot would
        // leave every later edit of theirs attributed to an account id.
        await watchSpace();
        // The tile remembers who is here (#87): the launcher cannot open every store to ask.
        const { onSpaceChange } = await import("./open-store.js");
        const { updateEntry } = await import("./launcher-store.js");
        const remember = (): void => {
          const members = (liveSpace() ?? s).members.map((m) => ({ id: m.id, name: m.name }));
          updateEntry(appKey("user", id), { people: members });
        };
        remember();
        onSpaceChange(remember);
        return () => ({
          ...(liveSpace() ?? s),
          // Host-mediated: the shell owns the UI and the admin check, so an app cannot hand its
          // space to a stranger without the user seeing it happen.
          invite: async (): Promise<string> => {
            const { createShareLink } = await import("./share-sync.js");
            return createShareLink(id);
          },
        });
      })()
    : undefined;

  // A synced app shares its SOURCE through the space too, so an edit by one person reaches the
  // others instead of silently diverging (and, if the edit changed the schema, silently misreading
  // each other's records). Whether this copy may write is the version gate's call (KA-22, #63), and
  // it can change while the app is open — so the store is guarded by a lock read on every write.
  const lock = new AppLock();
  let store = rawStore;
  let gate: import("./version-gate.js").GateResult | undefined;
  const canWrite = space ? space().role !== "reader" : true;
  if (syncAllowed && saved.sync) {
    const { openVersionGate } = await import("./version-gate.js");
    gate = await openVersionGate({ id, saved, rawStore, lock, canWrite });
    if (!gate.proceed) return null;
    store = guardedStore(rawStore, lock.refusal);

    // Tell your ACCOUNT this app exists and where its data is, so a device linked with the recovery
    // words can find it. Written on every open, not once: the name, the icon and the source all
    // change, and the space this points at is what a new device asks the relay for.
    //
    // Not awaited and never fatal — a backup that cannot be written is not a reason to fail opening
    // an app you are looking at right now.
    void (async () => {
      const { rememberAppOnAccount } = await import("./open-store.js");
      const { getEntry, appKey } = await import("./launcher-store.js");
      const entry = getEntry(appKey("user", id));
      await rememberAppOnAccount({
        id,
        name: entry.displayName ?? saved.name,
        icon: entry.icon ?? entry.identity?.icon,
        source: saved.source,
        shared: (space?.().members.length ?? 1) > 1,
      });
    })().catch((e: unknown) => console.warn("[potyro] could not record this app on your account:", e));
  }
  // This app's AI service (docs/23): its own switch, consent and spend. Only the app's runtime gets it.
  const appCaps = capsWithAi(caps, id);
  const picker = new PickerHost();
  const questions = new UiHost();
  const ui = createUiBridge(toaster.push, picker, shellDialogs, questions);
  const navHost = new NavHost();
  const nav = createNavBridge((pageId, param) => navHost.navigate(pageId, param));

  let composed: Composed;
  let provenance: Provenance = "untrusted";
  let appSource: string | undefined;
  const failed = async (e: unknown): Promise<null> => {
    // Sealed, and failing for want of a web page or a feature the box lacks: running it as yours is
    // the way out, so the screen says so and offers it (owner, 2026-10-13). A library that does not
    // match its lock is never one tap from full authority.
    const { promotionFixes } = await import("./promotion.js");
    const promote = !saved.trusted && promotionFixes(e) ? saved : undefined;
    mount(root, <Splash id={id} name={saved.name} source={saved.source} failed={e instanceof Error ? e.message : String(e)} promote={promote} />);
    await rawStore.close();
    return null;
  };
  // Its libraries and its own modules (#266, #258), this device's copy, checked against its lock. One
  // that arrived without them (by link, from the account, #281) fetches them now, with consent.
  const [{ rememberModules, forgetModules }, { ModuleError }, { codeForOpen }] = await Promise.all([import("./app-modules.js"), import("./package-modules.js"), import("./open-libraries.js")]);
  const code = await codeForOpen(saved, store, Boolean(syncAllowed && saved.sync));
  if ("message" in code) return failed(new Error(code.message));
  const modules = code.modules;
  rememberModules(id, modules?.lock, modules);

  if (saved.trusted) {
    try {
      const { loadTrustedModule } = await import("./trusted-loader.js");
      const app = await loadTrustedModule(saved.source, modules); // real defineApp validates or throws
      composed = await compose({ provenance: "trusted", app, store, caps: appCaps, ui, nav, me, space });
      provenance = "trusted";
    } catch (e) {
      // A library or module that does not match its lock is not a reason to try the sealed box.
      if (e instanceof ModuleError) return failed(e);
      const name = saved.name;
      const why = e instanceof Error ? e.message : "";
      toaster.push((why ? t`Couldn’t run “${name}” as yours, so it opens sealed. ${why}` : t`Couldn’t run “${name}” as yours, so it opens sealed.`).trim());
    }
  }
  if (provenance === "untrusted") {
    const [{ createAppBundler }, { createSharedAppLoader }] = await Promise.all([
      import("./app-bundler.js"),
      import("./isolate-bridge.js"),
    ]);
    try {
      appSource = await (await createAppBundler())(saved.source, modules);
      composed = await compose({ provenance: "untrusted", bundleCode: appSource, store, caps: appCaps, ui, nav, me, space, loadIsolated: await createSharedAppLoader(store) });
    } catch (e) {
      return failed(e);
    }
  }
  // Membership changes re-render the app. Wired here because the runtime does not exist when the
  // space is first read, and a view showing "who is in this list" is otherwise stale until some
  // unrelated write happens to refresh it.
  if (syncAllowed && saved.sync) {
    const { onSpaceChange } = await import("./open-store.js");
    onSpaceChange(() => composed!.runtime.core.invalidate());
  }

  if (gate) {
    const { migrateShared } = await import("./version-gate.js");
    const current = space?.();
    await migrateShared({
      definition: composed!.runtime.definition,
      rawStore,
      lock,
      gate,
      canWrite,
      others: (current?.members ?? []).filter((m) => m.id !== me.id).map((m) => m.name),
      toast: toaster,
      refresh: () => composed!.runtime.core.invalidate(),
    });
  } else {
    await runMigrationsIfPossible(composed!.runtime.definition, store, toaster);
  }
  // Everything this app started that outlives a render, so switching away can stop it (#89). The
  // page dying used to do this for free.
  const stops: Array<() => void> = gate ? [gate.stop] : [];
  stops.push(startReminderSync(composed!.runtime, store));
  // The person's language changed (You → Language, or the device's): the app reads differently now —
  // its words, its formats, its reminders' titles (#302). The App re-renders on the invalidation.
  {
    const { languagePrefs, onLanguagePrefsChange } = await import("./locale.js");
    stops.push(onLanguagePrefsChange(() => void composed!.runtime.setLanguages(languagePrefs())));
  }
  // The launcher badge's reminders (#86): due times, so one that falls due while the app is closed counts.
  stops.push(watchReminderTimes(composed!.runtime, store, (due) => recordSignals(appKey("user", id), { due })));
  // Its live launcher tile (docs/04 §Tile), run again after its data changes: home shows what you just did.
  stops.push(watchTile({ id, source: saved.source }, composed!.loaded, composed!.runtime, store));
  await restoreScope(composed!.runtime, id);

  let open = true;
  liveApps(+1);
  const opened: Opened = {
    sync: Boolean(syncAllowed && saved.sync),
    dispose: async () => {
      if (!open) return;
      open = false;
      liveApps(-1);
      for (const stop of stops.splice(0)) stop();
      forgetModules(id);
      // Writes still on their way land first — a tick then Home used to close the store under its
      // patch, and the tick was gone. Before the isolate goes too: an untrusted action writes from it.
      await composed!.runtime.settle();
      // From here a read that fails is the app going away, not the app failing.
      composed!.runtime.close();
      composed!.loaded.dispose();
      await rawStore.close();
    },
  };
  // Superseded while it was opening (another tap, Back): put it away without showing it.
  if (!isCurrent()) {
    await opened.dispose();
    return null;
  }

  // What this device calls this app and what colour it gave it.
  const { getEntry: entryFor, appKey: keyFor } = await import("./launcher-store.js");
  const { hueColour } = await import("./tile-identity.js");
  const appHue = entryFor(keyFor("user", id)).hue;

  mount(
    root,
    <App
      key={`${id}:${routeSeq}`}
      navHost={navHost}
      picker={picker}
      questions={questions}
      sync={syncAllowed && saved.sync}
      runtime={composed!.runtime}
      provenance={provenance}
      toaster={toaster}
      appId={id}
      // The app's own name — the one Rename sets. NOT the tile's `displayName`: editing a tile is
      // labelling a shortcut on this device ("Mum's recipes"), and the app goes on saying what it
      // says. That line is drawn in `tile-edit-trusted.spec.ts`, and it is a good one.
      name={saved.name}
      // The colour IS the tile's, though: it was picked for the app, and stopping at the tile is
      // what made choosing one feel like it did nothing.
      appAccent={appHue === undefined ? undefined : hueColour(appHue)}
      currentKind="user"
      lock={syncAllowed && saved.sync ? lock : undefined}
      // The app's own source, not `appSource`: that is set only for an app running in the isolate,
      // and it is the BUNDLED code — so a trusted app exported no app at all, and a bundle could not
      // be added on another device ("No app source in the zip"), which is what carrying how an app
      // was made (#261) depends on.
      onExport={() => void exportApp(composed!.runtime, store, caps, provenance, saved.source, toaster, id)}
      onImport={() => void importApp(caps, toaster)}
      onData={() => navigateTo({ kind: "data", id })}
      generator
    />,
  );
  return opened;
}

// What is on screen now, and the route counter that tells a slow open it has been superseded.
let current: Opened | null = null;
let routeSeq = 0;

/**
 * Put a route on screen (#89). The new surface is mounted FIRST — the previous app's tree unmounts
 * with it, so nothing reads a store that is about to close — and only then is the previous app's
 * runtime, isolate, store and watchers put away.
 */
async function show(r: Route, root: HTMLElement, caps: Capabilities): Promise<void> {
  // Leaving an app turns its camera off, whatever the app did or forgot to do (docs/25). First, so
  // not one frame of it reaches the next screen.
  caps.liveCamera?.stopAll("closed");
  const seq = ++routeSeq;
  const isCurrent = (): boolean => seq === routeSeq;
  const prev = current;
  current = null;

  if (r.kind === "home") {
    mount(root, <Home key={`home:${seq}`} />);
    await prev?.dispose().catch((e: unknown) => console.warn("[potyro] closing the previous app failed:", e));
    return;
  }
  if (r.kind === "share") {
    mount(root, <SharePage key={`share:${seq}`} />);
    await prev?.dispose().catch((e: unknown) => console.warn("[potyro] closing the previous app failed:", e));
    return;
  }
  if (r.kind === "data") {
    // Mounted before the app it came from is put away: the page opens that app's store too, and the
    // storage worker keeps a database open while anyone still holds it.
    mount(root, <DataPage key={`data:${seq}`} initialAppId={r.id} initialFiles={r.files} />);
    await prev?.dispose().catch((e: unknown) => console.warn("[potyro] closing the previous app failed:", e));
    return;
  }

  const saved = getUserApp(r.id);
  mount(
    root,
    <Splash key={`opening:${seq}`} id={r.id} name={saved?.name ?? r.id} source={saved?.source} />,
  );
  await prev?.dispose().catch((e: unknown) => console.warn("[potyro] closing the previous app failed:", e));
  if (!isCurrent()) return;

  // An open is an open however it came about — a tile, a deep link, a reload, Back — so it is
  // counted here, where every route to an app passes, not on the tile click (#81).
  recordOpen(appKey(r.kind, r.id), new Date().toISOString());
  const opened = await bootUserApp(r.id, root, new Toaster(), caps, isCurrent);
  if (isCurrent()) current = opened;
  else await opened?.dispose();
}

/**
 * Whether a route can replace what is on screen without a page load. Synced apps cannot, yet: the
 * space they read (`open-store.ts`) is module state that is set up once per page, and a pending data
 * import is restored on boot. Those keep the full navigation, which is always correct.
 */
function canSwitchInPlace(next: Route): boolean {
  if (current?.sync) return false;
  if (sessionStorage.getItem(IMPORT_KEY)) return false;
  return next.kind === "home" || next.kind === "data" || next.kind === "share" || !getUserApp(next.id)?.sync;
}

// Where the identity's secrets live (#57): the platform keystore on a device, else this browser's
// encrypted vault, else — where neither exists — plain storage as before. Registered at module load,
// before anything below can read identity; which one is decided on first use.
setSecretVault(deferredVault(async () => (await maybeCreateNativeVault()) ?? browserVault()));
// Ask's source requests (#213) go through the app's own HTTP stack on a device, where CORS does not
// exist; in a browser they stay on `fetch`. Boxed, never a bare plugin (capacitor await hazard).
void maybeCreateNativeSourceHttp().then((native) => {
  if (native) setSourceHttp(native.http);
});
// On a device the WebView's storage IS the person's data: ask WebKit / Android's WebView not to evict
// it under storage pressure (docs/27 §3.1). A no-op in a browser.
void keepStorage();

/**
 * Offer the apps on your account that are missing here.
 *
 * Reads the account with no app open (`openAccountNode` exists for exactly this moment), and does
 * nothing at all when there is nothing to offer — which is every boot but the first after linking.
 */
/** Set once the account has been read on this device, so the wait below happens only the first time. */
const OFFERED = "potyro:account:offered";

async function offerAccountApps(): Promise<void> {
  try {
    // Only for a device that was LINKED, or one that already syncs something. Reading the account
    // means opening a connection to the relay, and a person who has never synced anything has not
    // asked for their apps to be anywhere but here — starting a socket for them would be helping
    // ourselves to a device that never opted in. `origin: passphrase` is set by `signInWithPassphrase`
    // and by nothing else, so it is exactly "this device was told it is someone".
    const linked = globalThis.localStorage?.getItem("potyro:identity:origin") === "passphrase";
    const { listUserApps } = await import("./user-apps.js");
    const syncs = listUserApps().some((a) => a.sync);
    if (!linked && !syncs) return;

    // The database's worker takes a moment to spawn and open its OPFS pool. Started here, that
    // moment overlaps the launcher; left until an app is tapped, it sits between the tap and the
    // app appearing. Not awaited — nothing below needs it, and the real open shares this one.
    if (syncs) {
      const { warmDeviceDatabase } = await import("@potyro/store");
      void warmDeviceDatabase();
    }

    const { readAccountApps, readAccountName, readProfileName } = await import("@potyro/store");
    const { openAccountNodeForDevice, publishAppListToAccount } = await import("./open-store.js");
    const node = await openAccountNodeForDevice();
    if (!node) return;

    // Publish before reading. Every synced app this device has goes onto the account now, from the
    // ids already written down — so the list is current whether or not those apps were opened, and
    // a device that dies tonight has left behind everything it could.
    await publishAppListToAccount(node);
    // And each one's Studio conversation, both ways (#283). In the background.
    void import("./chat-sync.js").then((chats) => chats.syncAllChats(node));
    // Give the relay a moment: this device may have signed in seconds ago, and the account's
    // own copy of the list travels the same way any other CoValue does.
    const mine = await readAccountApps(node, { waitMs: 8_000 });
    globalThis.localStorage?.setItem(OFFERED, "1");

    // Your name, if the account already has one and this device does not.
    //
    // The name lived only in the localStorage of whichever device set it, so a device linked with
    // the recovery words called itself "Me" while the other one had a name — and the people shared
    // with saw the same person twice. The account profile is the copy that syncs.
    //
    // Read here, AFTER the account's own data has been waited for: the profile is its own CoValue
    // and arrives over the same relay, so asking the moment the node opens reliably finds nothing.
    // A device that HAS been named keeps its own — being renamed from elsewhere without asking
    // would be worse than the inconsistency.
    try {
      const { peekIdentity, renameIdentity, DEFAULT_NAME } = await import("@potyro/identity");
      const here = peekIdentity();
      if (here && (!here.name || here.name === DEFAULT_NAME)) {
        // The registry first — it is the copy that arrives with the apps — then the profile.
        // The registry first — it arrives with the apps — then the profile, which is the copy the
        // people in a shared space read.
        const theirs = (await readAccountName(node, { waitMs: 4_000 })) ?? (await readProfileName(node));
        if (theirs && theirs !== here.name) renameIdentity(theirs);
      }
    } catch {
      /* a name is a nicety; never hold up the apps for it */
    }
    // Offered: everything on the account this device is not ALREADY syncing.
    //
    // It used to be "everything this device does not have", by id — which quietly excluded the very
    // apps people test this with. Every device seeds the examples for itself, so a linked phone
    // already had a Groceries of its own and the Groceries with the shopping list in it was never
    // offered: "groceries is not with sync on and with the same data as before". A factory example
    // is not a reason to withhold someone's own app.
    //
    // And not what this device deleted, nor what it has already been offered and passed on: the
    // offer comes back only when an app it has never been offered appears (account-offer.ts).
    const { accountOffer, recordDeclined } = await import("./account-offer.js");
    const offer = accountOffer(mine, (id) => getUserApp(id)?.sync === true);
    if (!offer) return;

    const { RestoreApps, installFromAccount } = await import("./restore-apps.js");
    // Its own React root, over the launcher rather than in place of it. The shell renders every
    // route through ONE root, so mounting the panel there replaces whatever is on screen — which was
    // invisible while this ran before the first paint, and blanks the launcher now that it does not.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const panel = createRoot(host);
    let installed = 0;
    await new Promise<void>((done) => {
      panel.render(
        <RestoreApps
          apps={offer.apps}
          ticked={offer.ticked}
          onClose={() => {
            recordDeclined(offer.apps);
            done();
          }}
          onRestore={async (chosen) => {
            const now = new Date().toISOString();
            for (const app of chosen) await installFromAccount(app, now);
            installed = chosen.length;
            // What was left unticked was answered too.
            recordDeclined(offer.apps.filter((a) => !chosen.includes(a)));
            done();
          }}
        />,
      );
    });
    panel.unmount();
    host.remove();
    // The launcher was drawn before these apps existed and does not re-read the registry on its own.
    // Only after something was actually installed: there is nothing new to draw after "Not now".
    if (installed > 0) globalThis.location.reload();
  } catch (e) {
    // Never block boot on it: the apps already on this device are what someone came for.
    console.warn("[potyro] could not read the apps on your account:", e);
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");

  // Before anything paints. A light flash on a device set to dark is the whole feature failing in
  // the one moment it is most visible.
  applyLook();

  // The language, before anything paints for the same reason (#298): the saved choice, else the
  // device's, else English. English needs no fetch; another language is one small chunk, from the
  // service worker's cache when offline. The pseudo-language is offered in dev builds only.
  await startI18n({ pseudo: import.meta.env.DEV });
  // Right after the language, before anything opens storage: if another tab has it, that is said
  // in words — whether it is known now or only once that tab takes it over later.
  watchStorageOwner();
  // On Android the OS can say more than the WebView does (a per-app language, say). Not awaited:
  // it only matters when it disagrees, and then the switch is live.
  void systemLanguages()
    .then((tags) => (tags ? setSystemLanguages(tags) : undefined))
    .catch((e: unknown) => console.warn("[potyro] could not apply the system language:", e));

  // Move secrets an older build left in plain storage into the vault. Not awaited: nothing on screen
  // waits on it, and every read of a secret performs the same move if this has not finished.
  void secureIdentitySecrets().catch((e: unknown) => console.warn("[potyro] could not secure identity keys:", e));

  // A demo link opens its app and nothing else: no examples seeded, no account read, no launcher.
  const demo = readDemoLink(location.pathname, location.hash);
  if (demo) return bootDemo(root, demo);

  // The examples are ordinary apps (#152): seeded into the registry once, then yours to edit,
  // share or delete. Under `dev:sandbox` they are seeded untrusted, which is what exercises the
  // isolate. Before routing, because routing asks the registry whether an app exists.
  await seedExamples({ trusted: !SANDBOX, now: new Date().toISOString() });

  // A shared link is handled before routing: it creates the local app, so the route it should land
  // on does not exist until the invite has been accepted.
  const joined = await bootInviteIfPresent(root);
  // Joining failed and the screen says why, with the way back to the apps.
  if (joined === false) return;

  // Apps your ACCOUNT knows about that this device does not (KA-16 follow-up). This is what typing
  // the recovery words is supposed to get you: a device that is not only you, but yours. Offered,
  // never forced — a phone is not a laptop, and an app whose photos run to hundreds of megabytes is
  // a decision, not a default.
  //
  // Awaited for exactly one device: the one that has just been told who it is and owns nothing yet.
  // That person typed twenty-four words a second ago and is waiting to be handed their apps, so the
  // launcher may as well wait too — and it arrives with the apps already on it.
  //
  // Every other boot does NOT wait. Asking the account means asking the relay, and that answer is
  // allowed to take seconds; awaited on every boot it sat between opening Potyro and seeing anything
  // at all, for anyone who syncs even one app.
  if (!joined) {
    // "Linked, and not asked yet." Not "has no apps": every device is seeded with the examples, so
    // an empty list never happens. Not "linked" alone either, or the wait would come back on every
    // boot of that device forever.
    const justLinked =
      globalThis.localStorage?.getItem("potyro:identity:origin") === "passphrase" &&
      !globalThis.localStorage?.getItem(OFFERED);
    if (justLinked) await offerAccountApps();
    else void offerAccountApps();
  }

  // Native (Capacitor) capabilities on a device — chiefly EXACT offline notifications — else web.
  // Only imported when actually on a device (web bundle stays Capacitor-free). Sole target-selection.
  const caps = (await maybeCreateNativeCapabilities()) ?? createWebCapabilities();
  setShellCaps(caps);
  // "Camera on" whenever an app sees through the camera live; the shell's, not the app's (docs/25).
  if (caps.liveCamera) watchLiveCamera(caps.liveCamera);
  // Faces in its frames, when an app asks (`live({ faces: true })`): the shell loads the finder, the
  // first time it is wanted, from files it ships itself (faces/, docs/25 §Faces).
  caps.liveCamera?.useFaces(loadFaces);

  // Opening an app, going home and Back switch in place from here on (#89).
  setRouteHandler((next) => {
    if (!canSwitchInPlace(next)) return false;
    void show(next, root, caps);
    return true;
  });
  globalThis.addEventListener("popstate", () => {
    const next = route();
    if (canSwitchInPlace(next)) void show(next, root, caps);
    else location.reload();
  });

  await show(joined ? { kind: "user", id: joined } : route(), root, caps);
}

/**
 * A link opening the app while it is ALREADY running (device warm start).
 *
 * Reloading onto the invite is deliberate: joining rebuilds the store, the identity and the
 * runtime, and doing that underneath a mounted app is far more failure-prone than starting clean.
 */
let deepLinksRegistered = false;

let sharesRegistered = false;

/**
 * Text shared into Potyro from another app (#213). Kept for the session and put in front of the person
 * on the "Bring this into…" page, whatever they were looking at. The plugin holds a share that
 * arrived before this listened, so sharing into a closed Potyro arrives too.
 */
function registerShares(): void {
  if (sharesRegistered) return;
  sharesRegistered = true;
  void listenForShares(
    (share) => {
      rememberShare(share);
      navigateTo({ kind: "share" });
    },
    (files) => void receiveSharedFiles(files),
  ).catch((e: unknown) => console.warn("[potyro] could not listen for shares:", e));
}

function registerDeepLinks(): void {
  // `mount` runs on every route, so without this each navigation would add another listener and a
  // single incoming link would fire the join path several times over.
  if (deepLinksRegistered) return;
  deepLinksRegistered = true;
  void onUrlOpen((url) => {
    // "Open with Potyro" on a file (#254): the same question as a file dropped on it.
    if (isOpenedFile(url)) return void receiveSharedFiles([{ uri: url, name: nameFromUri(url), mimeType: "" }]);
    if (!/[#&]join=/.test(url)) return;
    const hash = url.slice(url.indexOf("#"));
    location.replace(`${location.pathname}${hash}`);
  });
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
  // Not a boot error: the screen saying another tab has the storage is already up.
  if (isStorageElsewhere(err)) return;
  const root = document.getElementById("root");
  if (root) {
    const why = err instanceof Error ? err.message : String(err);
    root.textContent = t`Boot error: ${why}`;
  }
  // eslint-disable-next-line no-console
  console.error(err);
});
