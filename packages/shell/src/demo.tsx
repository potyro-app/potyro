// A demo link, opened (docs/24 §1): the app running straight away, sealed, with demo records.
//
// Nothing is installed and nothing is kept. The app's records live in memory for as long as the page
// is open; its code runs in the browser realm exactly as any app from someone else does (rule 3), and
// it reaches this device only through the mediated `ctx` — a capability is asked for when the app
// reaches for it, a library is fetched when the person says yes, as on any sealed app.
//
// "Keep this app" is the Add-an-app card, fed the package the link carried, as a link: sealed, never
// "I wrote this", promotable later from the app (docs/07).
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import type { Person } from "potyro";
import { MemoryStore, readAppPackage, type AppPackage } from "@potyro/store";
import type { Capabilities } from "@potyro/capabilities";
import { App } from "./App.js";
import { AddAppDialog } from "./add-app-dialog.js";
import { applySeed, applyShippedFiles } from "./add-app.js";
import { compose, type Composed } from "./compose.js";
import { askToFetch } from "./open-libraries.js";
import { inspectLibraries, prepareCode } from "./package-libraries.js";
import { memoryModules } from "./package-modules.js";
import { NavHost } from "./nav-host.js";
import { PickerHost } from "./picker.js";
import { UiHost } from "./ui-host.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { screenAwake } from "./keep-awake.js";
import { timerHub } from "./timer-hub.js";
import { shellDialogs } from "./dialog.js";
import { Toaster } from "./toaster.js";
import { siteBase, type DemoLink } from "./demo-link.js";
import { shareEvent } from "./share-events.js";
import { creditLine } from "./credit-words.js";
import { holdArrival, lineFor, withAppTarget, type AppTarget } from "./app-link.js";

/** The person using a demo: nobody in particular, and never this device's identity. */
const demoPerson = (): Person => ({ id: "demo-viewer", name: t({ message: "You", comment: "The person trying a demo app" }) });

/** A demo the person said no to opening: one of its libraries would have had to be fetched. */
export class DemoDeclined extends Error {}

/** The package a demo link carries. Throws in plain words when it cannot be read. */
export async function loadDemoPackage(link: DemoLink): Promise<AppPackage> {
  if (link.kind === "inline") {
    try {
      return readAppPackage(link.zip);
    } catch {
      throw new Error(t`This link is damaged: the app in it could not be read. Ask whoever sent it for a new one.`);
    }
  }
  const { fetchHostedPackage, GoneError } = await import("./share-service.js");
  let zip: Uint8Array;
  try {
    zip = await fetchHostedPackage(link.id, link.key);
  } catch (e) {
    if (e instanceof GoneError) throw new Error(t`This link no longer works: whoever shared it took it down, or it was never made.`);
    if (e instanceof TypeError) throw new Error(t`The app could not be fetched. Check the connection and try again.`);
    throw new Error(t`This link is damaged: the app in it could not be read. Ask whoever sent it for a new one.`);
  }
  try {
    return readAppPackage(zip);
  } catch {
    throw new Error(t`This link is damaged: the app in it could not be read. Ask whoever sent it for a new one.`);
  }
}

/** The app's name, as the link says it, before any of its code has run. */
export function demoName(pkg: AppPackage): string {
  const declared = typeof pkg.declared?.name === "string" ? pkg.declared.name : undefined;
  const written = /\bname\s*:\s*["'`]([^"'`\n]{1,80})["'`]/.exec(pkg.source)?.[1];
  return pkg.credit?.name ?? declared ?? written ?? t({ message: "Shared app", comment: "A demo app whose name could not be read" });
}

export interface DemoSession {
  composed: Composed;
  navHost: NavHost;
  picker: PickerHost;
  questions: UiHost;
  toaster: Toaster;
}

/**
 * Open the app in the package, sealed, on a store in memory, with its demo records. Asks before
 * fetching a library, as opening any sealed app does; a "no" is `DemoDeclined`.
 */
export async function openDemo(pkg: AppPackage, caps: Capabilities, opts: { link?: string } = {}): Promise<DemoSession> {
  const name = demoName(pkg);
  const libraries = await inspectLibraries(pkg);
  const missing = libraries.lines.filter((l) => !l.here);
  if (libraries.issues.length) throw new Error(libraries.issues.join("\n"));
  if (missing.length && !(await askToFetch(name, missing))) throw new DemoDeclined(name);
  const code = await prepareCode(pkg);

  const store = new MemoryStore();
  await store.open(`demo:${pkg.declared?.id ?? "app"}`);
  // Its shipped files and its code, before any of it runs: an app that reads `levels.json` at the top
  // finds it, as it would once kept.
  await applyShippedFiles(store, code.files, { update: false });
  const modules = memoryModules(code.lock, new Map(code.files.map((f) => [f.path, f.data])));

  const toaster = new Toaster();
  const picker = new PickerHost();
  const questions = new UiHost();
  const navHost = new NavHost();
  const [{ createAppBundler }, { createSharedAppLoader }] = await Promise.all([import("./app-bundler.js"), import("./isolate-bridge.js")]);
  const bundleCode = await (await createAppBundler())(pkg.source, modules);
  // A link to one of its pages, from inside the demo (docs/24 §11): the demo's own link, landing there.
  let declaredId: string | undefined = pkg.declared?.id;
  const { link } = opts;
  const makeLink = link
    ? async (to: { page: string; params: Record<string, string> }): Promise<string> => {
        const line = lineFor({ line: pkg.line }, declaredId);
        if (!line) throw new Error("This app has no id to make a link to it with");
        return withAppTarget(link, { line, page: to.page, params: to.params });
      }
    : undefined;
  const composed = await compose({
    provenance: "untrusted",
    bundleCode,
    store,
    caps,
    // A demo's timers and screen are the shell's, as an installed app's (docs/04); leaving a demo is a
    // page load, which lets go of the screen by itself.
    ui: createUiBridge(toaster.push, picker, shellDialogs, questions, makeLink, {
      keepAwake: () => ({ release: screenAwake.hold(`demo:${pkg.declared?.id ?? "app"}`) }),
      timers: timerHub.bridgeFor(`demo:${pkg.declared?.id ?? "app"}`, name),
    }),
    nav: createNavBridge((pageId, param) => navHost.navigate(pageId, param)),
    me: demoPerson(),
    loadIsolated: await createSharedAppLoader(store),
  });
  // The demo records, once the app has said which entities it keeps. Never anyone's real records:
  // the device that made the link wrote them from the app's own sample data (docs/24 §3).
  declaredId = composed.runtime.definition.id || declaredId;
  await applySeed(store, pkg.seed, Object.keys(composed.runtime.definition.entities ?? {}));
  composed.runtime.core.invalidate();
  return { composed, navHost, picker, questions, toaster };
}

/** Leave the demo for the shell's own page at the site's root, where a kept app opens. */
export function leaveDemoPath(): void {
  const base = siteBase(location.pathname);
  if (location.pathname !== base || location.hash) history.replaceState(null, "", base);
}

/**
 * `startRemix`: the link asked for Make it mine (`&remix=1`, the gallery's second button) — the card is
 * already open over the running app, so the person sees what they are making their own.
 */
export function DemoScreen({ session, pkg, startRemix, target }: { session: DemoSession; pkg: AppPackage; startRemix?: boolean; target?: AppTarget }) {
  const { t } = useLingui();
  // Keep and Make it mine are the same card (docs/24 §6): a remix is a copy of your own, opened in the Studio.
  const [adding, setAdding] = useState<"keep" | "remix" | null>(startRemix ? "remix" : null);
  const name = demoName(pkg);
  const credit = creditLine(pkg.credit);
  return (
    <div className="k-demo">
      <aside className="k-demo-bar" aria-label={t({ message: "About this demo", comment: "The bar above an app opened from a shared link" })}>
        <a className="k-demo-made" href={siteBase(location.pathname)}>
          <span className="k-demo-mark" aria-hidden>
            ✦
          </span>
          <Trans comment="Demo bar: links to Potyro itself">Made with Potyro</Trans>
        </a>
        <p className="k-demo-note">
          {credit ? <span className="k-demo-credit">{credit}</span> : null}
          <span>
            <Trans comment="Demo bar: nothing done in the demo is kept">A demo: nothing you do here is kept</Trans>
          </span>
        </p>
        <div className="k-demo-actions">
          <button type="button" className="k-demo-remix" onClick={() => setAdding("remix")}>
            <Trans comment="Demo bar: make your own copy of this app, to change in the Studio">Make it mine</Trans>
          </button>
          <button type="button" className="k-demo-keep" onClick={() => setAdding("keep")}>
            <Trans comment="Demo bar: add this app to your own apps">Keep this app</Trans>
          </button>
        </div>
      </aside>
      <App
        navHost={session.navHost}
        picker={session.picker}
        questions={session.questions}
        runtime={session.composed.runtime}
        provenance="untrusted"
        toaster={session.toaster}
        name={name}
        // A link to one of its pages (docs/24 §11): the demo opens there, as the kept copy will.
        arrival={target}
      />
      {adding ? (
        <AddAppDialog
          key={adding}
          initialPackage={pkg}
          remix={adding === "remix"}
          onClose={() => setAdding(null)}
          onAdded={(done) => {
            shareEvent(adding === "remix" ? "demo-remixed" : "demo-kept");
            // Kept from a link to one of its pages: the copy opens there (docs/24 §11).
            if (target) holdArrival(done.app.id, target);
            leaveDemoPath();
          }}
        />
      ) : null}
    </div>
  );
}
