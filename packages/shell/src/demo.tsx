// A demo link, opened (docs/24 §1): the app running straight away, sealed, with demo records.
//
// Nothing is installed and nothing is kept. The app's records live in memory for as long as the page
// is open; its code runs in the browser realm exactly as any app from someone else does (rule 3), and
// it reaches this device only through the mediated `ctx` — a capability is asked for when the app
// reaches for it, a library is fetched when the person says yes, as on any sealed app.
//
// "Keep this app" is the Add-an-app card, fed the package the link carried, as a link: sealed, never
// "I wrote this", promotable later from the app (docs/07).
import { SealMark } from "./seal.js";
import { useCallback, useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { pickLanguage, word, type Person } from "potyro";
import { languagePrefs } from "./locale.js";
import { MemoryStore, isReservedPath, readAppPackage, type AppPackage, type Store } from "@potyro/store";
import type { Capabilities } from "@potyro/capabilities";
import { App } from "./App.js";
import { capsForApp } from "./app-ai-caps.js";
import { AddAppDialog } from "./add-app-dialog.js";
import { applySeed, applyShippedFiles, fileFieldsOf } from "./add-app.js";
import { seedThatFits } from "./app-seed.js";
import { compose, type Composed } from "./compose.js";
import { askToFetch } from "./open-libraries.js";
import { inspectLibraries, prepareCode } from "./package-libraries.js";
import { memoryModules } from "./package-modules.js";
import { NavHost } from "./nav-host.js";
import { PickerHost } from "./picker.js";
import { UiHost } from "./ui-host.js";
import { createNavBridge, createUiBridge, type RecordLinkMaker } from "./ui-bridge.js";
import { screenAwake } from "./keep-awake.js";
import { timerHub } from "./timer-hub.js";
import { shellDialogs } from "./dialog.js";
import { Toaster } from "./toaster.js";
import { siteBase, type DemoLink } from "./demo-link.js";
import { shareEvent } from "./share-events.js";
import { creditLine } from "./credit-words.js";
import { chooseDemoScope } from "./scope.js";
import { holdArrival, lineFor, withAppTarget, type AppTarget } from "./app-link.js";
import { holdRecordJoin, type RecordLinkPayload } from "./record-link.js";
import { reportAddress, reportMailto } from "./contact.js";

/** The person using a demo: nobody in particular, and never this device's identity. */
const demoPerson = (): Person => ({ id: "demo-viewer", name: t({ message: "You", comment: "The person trying a demo app" }) });

/** A demo the person said no to opening: one of its libraries would have had to be fetched. */
export class DemoDeclined extends Error {}

/** The package a demo link carries. Throws in plain words when it cannot be read. */
/** A link that leads nowhere any more (a 404): the splash says so with the mascot, not as an error. */
export class LinkGoneError extends Error {}
/** The app could not be fetched now, but may be later (no connection, too many today): the splash offers Try again. */
export class DemoRetryError extends Error {}

export async function loadDemoPackage(link: DemoLink): Promise<AppPackage> {
  if (link.kind === "inline") {
    try {
      return readAppPackage(link.zip);
    } catch {
      throw new Error(t`This link is damaged: the app in it could not be read. Ask whoever sent it for a new one.`);
    }
  }
  const { fetchHostedPackage, GoneError, TakenDownError, TooManyError } = await import("./share-service.js");
  let zip: Uint8Array;
  try {
    zip = await fetchHostedPackage(link.id, link.key);
  } catch (e) {
    if (e instanceof TakenDownError) {
      const address = reportAddress();
      throw new LinkGoneError(
        t({
          message: `This link was taken down: the app behind it was removed from Potyro. If you think this was a mistake, write to ${address}.`,
          comment: "A demo link the Potyro team removed after a report; the address is where to write",
        }),
      );
    }
    if (e instanceof GoneError) throw new LinkGoneError(t`This link no longer works: whoever shared it took it down, or it was never made.`);
    // A limit for the day on this network's address (docs/16 "Limits per address"): the link is fine.
    if (e instanceof TooManyError) {
      throw new DemoRetryError(
        t({
          message: "Too many apps were opened from this network today. Try again tomorrow, or on another network.",
          comment: "Opening a demo link: the share service's daily limit for this network was reached",
        }),
      );
    }
    if (e instanceof TypeError) throw new DemoRetryError(t`The app could not be fetched. Check the connection and try again.`);
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
  // A name in several languages (#302) is said in the viewer's.
  const d = pkg.declared;
  const app = { language: typeof d?.language === "string" ? d.language : undefined, languages: Array.isArray(d?.languages) ? (d.languages as string[]) : undefined };
  const declared = d?.name === undefined ? undefined : word(d.name, pickLanguage(languagePrefs(), app), app) || undefined;
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
export async function openDemo(pkg: AppPackage, caps: Capabilities, opts: { link?: string; record?: RecordLinkPayload } = {}): Promise<DemoSession> {
  const name = demoName(pkg);
  const libraries = await inspectLibraries(pkg);
  const missing = libraries.lines.filter((l) => !l.here);
  if (libraries.issues.length) throw new Error(libraries.issues.join("\n"));
  if (missing.length && !(await askToFetch(name, missing))) throw new DemoDeclined(name);
  const code = await prepareCode(pkg);

  // A record's link (docs/24 §12): the viewer joins the record itself, live, so its store is a synced
  // one of its own — this device's identity, Potyro's relay — rather than records in memory. Nothing
  // of the sharer's but that record reaches it, and nothing of this device's leaves.
  const live = opts.record;
  let me: Person = demoPerson();
  let store: Store;
  if (live) {
    const [{ openStore }, identity] = await Promise.all([import("./open-store.js"), import("@potyro/identity")]);
    const person = await identity.ensureIdentity();
    me = { id: person.id, name: person.name };
    store = await openStore(`demo:${pkg.line ?? pkg.declared?.id ?? "app"}`, { sync: true });
  } else {
    store = new MemoryStore();
    await store.open(`demo:${pkg.declared?.id ?? "app"}`);
  }
  // Its shipped files and its code, before any of it runs: an app that reads `levels.json` at the top
  // finds it, as it would once kept. A synced store never holds the app's code (#281): the live viewer
  // keeps it in memory (`memoryModules`, below) and writes only what the app ships.
  await applyShippedFiles(store, live ? code.files.filter((f) => !isReservedPath(f.path)) : code.files, { update: false });
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
  // Inviting others to a record from here (`ctx.ui.share({ record })`, docs/24 §12). A viewer opened
  // from a record's link is on a synced store of its own, so a record IT made can be shared on: the
  // link is the one it arrived by, with the new record on it. A demo on records in memory cannot —
  // nothing of it syncs — and says what to do instead, rather than handing over words with no link.
  const makeRecordLink: RecordLinkMaker = live
    ? {
        prepare: async () => true,
        make: async (share) => {
          const line = lineFor({ line: pkg.line }, declaredId);
          if (!line || !link) throw new Error("This app has no id to make a link to it with");
          const { recordLinkOn } = await import("./record-share.js");
          return recordLinkOn(link, { line, name, ...(declaredId ? { declaredId } : {}) }, store, share.record);
        },
      }
    : {
        prepare: async () => {
          await shellDialogs.confirm(t`This is a demo: nothing in it syncs, so nobody can be invited to it yet. Keep the app first, then invite from your own copy.`, {
            ok: t({ message: "OK", comment: "Button: close the note that a demo cannot invite anyone" }),
          });
          return false;
        },
        make: async () => {
          throw new Error("a demo cannot invite anyone");
        },
      };
  const composed = await compose({
    provenance: "untrusted",
    bundleCode,
    store,
    // The same per-app capabilities an installed copy gets (capsForApp): its live connections reach
    // Potyro's rooms relay and ask in the app's name, its AI and voice are its own. With the page's
    // bare ones, every room a demo opened failed at once as "unreachable" — no relay address — so a
    // friend tapping a game invite could never join it (Draw & Guess, 2026-10-19).
    caps: capsForApp(caps, `demo:${pkg.declared?.id ?? "app"}`),
    // A demo's timers and screen are the shell's, as an installed app's (docs/04); leaving a demo is a
    // page load, which lets go of the screen by itself.
    ui: createUiBridge(
      toaster.push,
      picker,
      shellDialogs,
      questions,
      makeLink,
      {
        keepAwake: () => ({ release: screenAwake.hold(`demo:${pkg.declared?.id ?? "app"}`) }),
        timers: timerHub.bridgeFor(`demo:${pkg.declared?.id ?? "app"}`, name),
      },
      makeRecordLink,
    ),
    nav: createNavBridge((pageId, param) => navHost.navigate(pageId, param)),
    me,
    // Its custom views draw in their own sealed frames, as any shared app's do (#267).
    loadIsolated: await createSharedAppLoader(store, undefined, { source: pkg.source, modules, appKey: `demo:${pkg.declared?.id ?? "app"}`, name }),
  });
  // The demo records, once the app has said which entities it keeps. Never anyone's real records:
  // the device that made the link wrote them from the app's own sample data (docs/24 §3).
  declaredId = composed.runtime.definition.id || declaredId;
  const entities = composed.runtime.definition.entities ?? {};
  if (live) {
    // The record, and the records that point at it, as the sharer's device has them now.
    const { joinRecordInto } = await import("./record-share.js");
    await joinRecordInto(store, live);
  } else {
    // Fitted to the app as it loads here (#486): a row its write gate would refuse does not go in, and a
    // reference to it is taken out — whatever the device that made the link fitted it to.
    await applySeed(store, seedThatFits(pkg.seed, entities), Object.keys(entities), fileFieldsOf(entities));
  }
  // An app shown "for a group" opens on one of the demo's groups, not on "choose a group".
  await chooseDemoScope(composed.runtime);
  composed.runtime.core.invalidate();
  // A demo that is a process, not records (docs/24 §3): what the app plays when its demo link opens —
  // a feed's replay. Not waited for: it goes on in the background, like one of the app's actions.
  composed.loaded.callDemo(composed.runtime.ctx).catch((e: unknown) => console.warn("[potyro] the app's demo did not start:", e));
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
/** How long someone who came by an invitation uses the app before Keep and Make it mine are offered. */
const INVITE_OFFER_AFTER_MS = 3 * 60_000;

/**
 * `reportLink`: the hosted link's own address, without its key — what a report names (#11). Only a
 * hosted link has one: an inline link carries the whole app in itself and is on no server to remove.
 */
export function DemoScreen({ session, pkg, startRemix, target, reportLink, record }: { session: DemoSession; pkg: AppPackage; startRemix?: boolean; target?: AppTarget; reportLink?: string; record?: RecordLinkPayload }) {
  const { t } = useLingui();
  // Keep and Make it mine are the same card (docs/24 §6): a remix is a copy of your own, opened in the Studio.
  const [adding, setAdding] = useState<"keep" | "remix" | null>(startRemix ? "remix" : null);
  // A screen that cannot run here asks to "Run it as mine": nothing is installed in a demo, so the
  // first step is keeping it (sealed, docs/07); it can be promoted from the app once kept. A card
  // already open (Make it mine, from the link) stays as it is.
  const keep = useCallback((): void => setAdding((a) => a ?? "keep"), []);
  // A link to one of its pages is an invitation to DO something there — join a game, look at a list —
  // not to adopt an app (owner, 2026-10-19: "for the first user going to the link this makes no sense").
  // So it opens on that page with nothing to decide; Keep and Make it mine come once they have used it.
  // A record's link is different again: what they write here is kept and reaches the others, and
  // they will want to come back to it — so Keep is offered from the start, with that said (owner,
  // 2026-11-07: "the user doesn't have access to potyro.app, there is no menu for the apps or home").
  const [offering, setOffering] = useState(!target || Boolean(record));
  useEffect(() => {
    if (offering) return;
    const later = setTimeout(() => setOffering(true), INVITE_OFFER_AFTER_MS);
    return () => clearTimeout(later);
  }, [offering]);
  const name = demoName(pkg);
  const credit = creditLine(pkg.credit);
  return (
    <div className="k-demo">
      <aside className="k-demo-bar" aria-label={t({ message: "About this demo", comment: "The bar above an app opened from a shared link" })}>
        <a className="k-demo-made" href={siteBase(location.pathname)}>
          <SealMark hue={0} />
          <Trans comment="Demo bar: links to Potyro itself">Made with Potyro</Trans>
        </a>
        <p className="k-demo-note">
          {credit ? <span className="k-demo-credit">{credit}</span> : null}
          {record ? (
            <span>
              <Trans comment="Demo bar above a record shared by its link: what is written is kept and reaches the sharer; Keep adds the app">Shared with you: what you write here is kept, and reaches whoever shared it. Keep the app to find it again.</Trans>
            </span>
          ) : offering ? (
            <span>
              <Trans comment="Demo bar: nothing done in the demo is kept">A demo: nothing you do here is kept</Trans>
            </span>
          ) : null}
          {reportLink ? (
            <a
              className="k-demo-report"
              href={reportMailto(
                t({ message: "A Potyro link", comment: "Subject of the email that reports a demo link to the Potyro team" }),
                t({
                  message: `The link: ${reportLink}\n\nWhy I think it is illegal:\n\n\nI believe this report is accurate and complete.`,
                  comment: "Start of the email that reports a demo link; the person writes their reasons under the second line",
                }),
              )}
              title={t({ message: "Tell the Potyro team about this link, if you think it is illegal", comment: "Demo bar: what the Report link does" })}
            >
              <Trans comment="Demo bar: report this demo link to the Potyro team">Report</Trans>
            </a>
          ) : null}
        </p>
        {offering ? (
          <div className="k-demo-actions">
          <button type="button" className="k-demo-remix" onClick={() => setAdding("remix")}>
            <Trans comment="Demo bar: make your own copy of this app, to change in the Studio">Make it mine</Trans>
          </button>
          <button type="button" className="k-demo-keep" onClick={() => setAdding("keep")}>
            <Trans comment="Demo bar: add this app to your own apps">Keep this app</Trans>
          </button>
          </div>
        ) : null}
      </aside>
      <App
        navHost={session.navHost}
        picker={session.picker}
        questions={session.questions}
        runtime={session.composed.runtime}
        provenance="untrusted"
        onTrustRequest={keep}
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
            // Kept from a record's link: the copy joins the record as it opens (docs/24 §12).
            if (record) holdRecordJoin(done.app.id, record);
            leaveDemoPath();
          }}
        />
      ) : null}
    </div>
  );
}
