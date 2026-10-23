// "Bring your apps in" — the NEW site's side of a move (docs/16 §Moving to a new home), at `/?move`.
//
// Opened by the old site with a channel (`/?move=<channel>`), it says hello to its opener and waits
// for an offer: a description of everything that would come in, shown here in full before anything
// is written. Only when the person says yes does it ask for the archive, and it takes the archive
// only from the origin that made the offer and only if it is the archive that was offered
// (move-protocol.ts `receive`). Anything else — another site, another window, a message out of turn —
// is ignored without a word.
//
// Opened without one, or when nothing arrives, it takes the file the old site saved instead. A file
// can come from anyone, so every app in one arrives sealed, and who you are never comes in one.

import { useEffect, useMemo, useRef, useState } from "react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { navigateTo } from "./router.js";
import { originEnv, siteName } from "./move-origins.js";
import { envelope, isChannel, receive, type ReceiverState } from "./move-protocol.js";
import { archiveDigest, matchesOffer, MoveArchiveError, offerOf, readMoveArchive, type MoveArchive, type MoveOffer } from "./move-archive.js";
import { bringInEverything, previewPlans, type BringInProgress, type BringInResult } from "./move-bring-in.js";
import type { AppPlan, MoveVia } from "./move-plan.js";
import { shellCaps } from "./shell-caps.js";
import { openStore } from "./open-store.js";
import { isStorageElsewhere } from "@potyro/store";
import { DEFAULT_NAME } from "@potyro/identity";

/** Can this tab write the site's storage now? Opening a store says, without writing anything. */
async function storageIsHere(): Promise<boolean> {
  try {
    const probe = await openStore("studio-chat");
    await probe.close();
    return true;
  } catch (e) {
    if (isStorageElsewhere(e)) return false;
    return true; // any other failure is reported by the import itself, by name
  }
}

/** How long to wait for the old site before offering the file instead. */
const PATIENCE_MS = 10_000;
const HELLO_EVERY_MS = 1_000;

type View =
  | { kind: "waiting"; patient: boolean }
  | { kind: "file" }
  | { kind: "offered"; offer: MoveOffer; via: MoveVia; archive?: MoveArchive; elsewhere?: boolean }
  | { kind: "importing"; progress?: BringInProgress }
  | { kind: "done"; result: BringInResult; from: string }
  | { kind: "failed"; reason: string };

export function MovePage({ channel }: { channel?: string }) {
  const { t } = useLingui();
  const opener = typeof window !== "undefined" ? (window.opener as Window | null) : null;
  const live = Boolean(opener) && isChannel(channel);
  const [view, setView] = useState<View>(live ? { kind: "waiting", patient: true } : { kind: "file" });
  const state = useRef<ReceiverState>({ phase: "waiting", channel: isChannel(channel) ? channel : "" });

  const fail = (reason: string): void => {
    state.current = { ...state.current, phase: "failed" };
    setView({ kind: "failed", reason });
    if (state.current.peer && opener) opener.postMessage(envelope(state.current.channel, { step: "failed", reason }), state.current.peer);
  };

  const bringIn = async (archive: MoveArchive, via: MoveVia): Promise<void> => {
    setView({ kind: "importing" });
    try {
      const result = await bringInEverything(archive, { via, onProgress: (progress) => setView({ kind: "importing", progress }) });
      state.current = { ...state.current, phase: "done" };
      setView({ kind: "done", result, from: archive.manifest.from });
      if (via === "window" && state.current.peer && opener) {
        opener.postMessage(envelope(state.current.channel, { step: "done", result: { apps: result.apps, records: result.records, files: result.files } }), state.current.peer);
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  };

  // The window hand-over: say hello until an offer comes, then hear only that origin.
  useEffect(() => {
    if (!live || !opener) return;
    const here = location.origin;
    const env = originEnv();
    const onMessage = (ev: MessageEvent): void => {
      const decision = receive(state.current, { origin: ev.origin, fromOpener: ev.source === opener, data: ev.data }, here, env);
      if (!decision.accept) return; // silently: a message that is not ours gets no answer at all
      state.current = decision.state;
      const message = decision.message;
      if (message.step === "offer") setView({ kind: "offered", offer: message.offer, via: "window" });
      if (message.step === "archive") void received(message.bytes);
    };
    const received = async (buffer: ArrayBuffer): Promise<void> => {
      const bytes = new Uint8Array(buffer);
      const offer = state.current.offer;
      if (!offer || (await archiveDigest(bytes)) !== state.current.digest) return fail(t`What arrived is not what you were shown, so none of it was brought in.`);
      let archive: MoveArchive;
      try {
        archive = readMoveArchive(bytes);
      } catch (e) {
        return fail(e instanceof MoveArchiveError ? e.message : t`What arrived could not be read.`);
      }
      if (!matchesOffer(archive, offer)) return fail(t`What arrived is not what you were shown, so none of it was brought in.`);
      await bringIn(archive, "window");
    };
    globalThis.addEventListener("message", onMessage);
    // Content-free, so it may go to whichever window opened this one: the opener already holds the
    // channel, having made it. Everything after this is addressed to the origin that offers.
    const hello = (): void => {
      if (state.current.phase === "waiting") opener.postMessage(envelope(state.current.channel, { step: "hello" }), "*");
    };
    hello();
    const timer = setInterval(hello, HELLO_EVERY_MS);
    const patience = setTimeout(() => setView((v) => (v.kind === "waiting" ? { kind: "waiting", patient: false } : v)), PATIENCE_MS);
    return () => {
      globalThis.removeEventListener("message", onMessage);
      clearInterval(timer);
      clearTimeout(patience);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async (): Promise<void> => {
    if (view.kind !== "offered") return;
    // Another tab of this site may hold the storage. Then it shows "Use it here" over this page, and
    // this page asks again after that reload — nothing is started that could only half finish.
    if (!(await storageIsHere())) return setView({ ...view, elsewhere: true });
    if (view.via === "file") {
      if (view.archive) void bringIn(view.archive, "file");
      return;
    }
    // Only now may the archive come, and only from the origin that offered it.
    state.current = { ...state.current, phase: "confirmed" };
    setView({ kind: "importing" });
    if (opener && state.current.peer) opener.postMessage(envelope(state.current.channel, { step: "send" }), state.current.peer);
  };

  const pickFile = async (): Promise<void> => {
    let blob: Blob;
    try {
      blob = await shellCaps().filesystem.pick();
    } catch {
      return; // cancelled
    }
    try {
      const archive = readMoveArchive(new Uint8Array(await blob.arrayBuffer()));
      // A file never brings who you are, whatever it says.
      const { identity: _never, ...manifest } = archive.manifest;
      const safe: MoveArchive = { ...archive, manifest };
      setView({ kind: "offered", offer: offerOf(manifest), via: "file", archive: safe });
    } catch (e) {
      setView({ kind: "failed", reason: e instanceof MoveArchiveError ? e.message : t`This file could not be read.` });
    }
  };

  return (
    <main className="k-move-page">
      {view.kind === "waiting" ? <Waiting patient={view.patient} onFile={() => void pickFile()} /> : null}
      {view.kind === "file" ? <FromFile onFile={() => void pickFile()} /> : null}
      {view.kind === "offered" ? (
        <Offer offer={view.offer} via={view.via} elsewhere={Boolean(view.elsewhere)} onConfirm={() => void confirm()} onCancel={() => navigateTo({ kind: "home" })} />
      ) : null}
      {view.kind === "importing" ? <Importing progress={view.progress} /> : null}
      {view.kind === "done" ? <Done result={view.result} from={view.from} /> : null}
      {view.kind === "failed" ? <Failed reason={view.reason} onFile={() => void pickFile()} /> : null}
    </main>
  );
}

function Waiting({ patient, onFile }: { patient: boolean; onFile: () => void }) {
  return (
    <section className="k-move-card" aria-live="polite">
      <p className="k-move-eyebrow">
        <Trans>Moving to a new home</Trans>
      </p>
      <h1 className="k-move-title">
        <Trans>Getting your apps ready</Trans>
      </h1>
      <p className="k-move-status" role="status">
        <span className="k-move-spin" aria-hidden />
        <Trans>Your old Potyro is packing them. Nothing comes in until you say yes here.</Trans>
      </p>
      {patient ? null : (
        <p className="k-muted">
          <Trans>Nothing yet? Go back to the window you came from and press “Bring my apps over” again — or bring them in from a file.</Trans>{" "}
          <button type="button" className="k-move-quiet" onClick={onFile}>
            <Trans>Choose a file</Trans>
          </button>
        </p>
      )}
    </section>
  );
}

function FromFile({ onFile }: { onFile: () => void }) {
  return (
    <section className="k-move-card">
      <p className="k-move-eyebrow">
        <Trans>Moving to a new home</Trans>
      </p>
      <h1 className="k-move-title">
        <Trans>Bring your apps in from a file</Trans>
      </h1>
      <p>
        <Trans>Choose the file your old Potyro saved. You will see everything in it before anything comes in.</Trans>
      </p>
      <div className="k-move-actions">
        <button type="button" className="k-add k-primary-action" onClick={onFile}>
          <Trans>Choose the file</Trans>
        </button>
        <button type="button" className="k-move-quiet" onClick={() => navigateTo({ kind: "home" })}>
          <Trans>Go to your apps</Trans>
        </button>
      </div>
    </section>
  );
}

interface OfferProps {
  offer: MoveOffer;
  via: MoveVia;
  /** Another tab of this site holds the storage: nothing can come in until this one has it. */
  elsewhere: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function Offer({ offer, via, elsewhere, onConfirm, onCancel }: OfferProps) {
  const { t } = useLingui();
  const plans = useMemo(() => previewPlans({ manifest: offer.manifest }, via), [offer, via]);
  const from = siteName(offer.manifest.from);
  const records = offer.manifest.apps.reduce((n, a) => n + a.records, 0);
  const files = offer.manifest.apps.reduce((n, a) => n + a.files, 0);
  const conversations = offer.manifest.conversations;
  const sealed = plans.filter((p) => p.kind !== "merge" && !p.trusted).length;
  // An app that is already here and brings nothing new — an example never opened there — is one
  // line at the end, not a row each: the list is for what actually changes.
  const nothingNew = (p: AppPlan): boolean => p.kind === "merge" && p.app.records === 0 && p.app.files === 0;
  const sorted = plans.filter((p) => !nothingNew(p)).sort((a, b) => a.app.name.localeCompare(b.app.name));
  const quiet = plans.length - sorted.length;
  const who = offer.identity?.name;
  return (
    <section className="k-move-card k-move-offer" aria-labelledby="k-move-offer-h">
      <p className="k-move-eyebrow">
        <Trans>From {from}</Trans>
      </p>
      <h1 className="k-move-title" id="k-move-offer-h">
        {plural(plans.length, { one: "Bring this app in?", other: "Bring these # apps in?" })}
      </h1>
      <p className="k-move-totals">
        <span>{plural(records, { one: "# record", other: "# records" })}</span>
        <span>{plural(files, { one: "# file", other: "# files" })}</span>
        {conversations ? <span>{plural(conversations, { one: "# Studio conversation", other: "# Studio conversations" })}</span> : null}
      </p>
      <ul className="k-move-apps" aria-label={t`Apps that will come in`}>
        {sorted.map((p) => (
          <li key={p.app.id} className="k-move-app" data-kind={p.kind}>
            <span className="k-move-app-name">{p.app.name}</span>
            <span className="k-move-app-meta">
              {plural(p.app.records, { one: "# record", other: "# records" })}
              {p.app.files ? <> · {plural(p.app.files, { one: "# file", other: "# files" })}</> : null}
            </span>
            <span className="k-move-app-tags">
              <PlanTag plan={p} />
              {p.kind !== "merge" && !p.trusted ? (
                <span className="k-ask-badge" data-tone="warn" title={t`It runs in the sealed box, as apps from other people do. You can trust it later from its menu.`}>
                  <Trans>sealed</Trans>
                </span>
              ) : null}
              {p.app.wasShared ? (
                <span className="k-ask-badge" title={t`It was shared there. It comes in as your own copy; share it again from here if you want to.`}>
                  <Trans>was shared</Trans>
                </span>
              ) : null}
            </span>
          </li>
        ))}
        {quiet ? (
          <li className="k-move-app k-move-app-quiet">
            <span className="k-move-app-meta">
              {plural(quiet, {
                one: "And # more that is already here, with nothing new in it.",
                other: "And # more that are already here, with nothing new in them.",
              })}
            </span>
          </li>
        ) : null}
      </ul>
      <div className="k-move-notes">
        {via === "file" ? (
          <p>
            <Trans>Who you are does not come in a file. To be the same person here, enter your recovery words under You afterwards.</Trans>
          </p>
        ) : who === undefined ? null : who && who !== DEFAULT_NAME ? (
          <p>
            <Trans>You come too: here you will be {who}, with the same recovery words, so what you made is still yours.</Trans>
          </p>
        ) : (
          <p>
            <Trans>You come too, with the same recovery words, so what you made is still yours.</Trans>
          </p>
        )}
        {sealed ? (
          <p>
            {via === "file"
              ? t`Apps from a file come in sealed, because a file could be from anyone. Trust the ones you made from their menu.`
              : t`Apps that came from other people stay sealed here, as they were there.`}
          </p>
        ) : null}
        {plans.some((p) => p.app.wasShared) ? (
          <p>
            <Trans>Shared apps come in as your own copy, with everything in them. People you shared with keep the one on the old site.</Trans>
          </p>
        ) : null}
        <p className="k-muted">
          <Trans>Nothing is removed from {from}, and nothing already here is doubled.</Trans>
        </p>
      </div>
      {elsewhere ? (
        <p className="k-move-status" data-tone="warn" role="status">
          <Trans>Potyro is open in another tab of this site. Press “Use it here”: this page comes back and asks you again.</Trans>
        </p>
      ) : null}
      <div className="k-move-actions">
        <button type="button" className="k-add k-primary-action" onClick={onConfirm}>
          <Trans>Bring them in</Trans>
        </button>
        <button type="button" className="k-move-quiet" onClick={onCancel}>
          <Trans>Not now</Trans>
        </button>
      </div>
    </section>
  );
}

function PlanTag({ plan }: { plan: AppPlan }) {
  if (plan.kind === "merge") {
    return (
      <span className="k-ask-badge" data-tone="good">
        <Trans>joins the one here</Trans>
      </span>
    );
  }
  if (plan.kind === "replace") {
    return (
      <span className="k-ask-badge">
        <Trans>replaces the untouched example here</Trans>
      </span>
    );
  }
  if (plan.kind === "new") {
    return (
      <span className="k-ask-badge" data-tone="good">
        <Trans>new here</Trans>
      </span>
    );
  }
  if (plan.kind === "copy") {
    return (
      <span className="k-ask-badge">
        <Trans>comes in beside the one here</Trans>
      </span>
    );
  }
  return null;
}

function Importing({ progress }: { progress?: BringInProgress }) {
  const name = progress?.name ?? "";
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  return (
    <section className="k-move-card" aria-live="polite">
      <h1 className="k-move-title">
        <Trans>Bringing your apps in</Trans>
      </h1>
      <p className="k-move-status" role="status">
        <span className="k-move-spin" aria-hidden />
        {progress ? <Trans>{name} — {done} of {total}</Trans> : <Trans>Receiving them</Trans>}
      </p>
      <p className="k-muted">
        <Trans>Keep this window open until it says it is done. If it closes, start again: nothing is doubled.</Trans>
      </p>
    </section>
  );
}

function Done({ result, from }: { result: BringInResult; from: string }) {
  const site = siteName(from);
  return (
    <section className="k-move-card" data-state="done" aria-live="polite">
      <p className="k-move-eyebrow">
        <Trans>Moved from {site}</Trans>
      </p>
      <h1 className="k-move-title">
        <Trans>Your apps are here</Trans>
      </h1>
      <p className="k-move-totals">
        <span>{plural(result.apps, { one: "# app", other: "# apps" })}</span>
        <span>{plural(result.records, { one: "# record", other: "# records" })}</span>
        <span>{plural(result.files, { one: "# file", other: "# files" })}</span>
      </p>
      {result.identity === "adopted" || result.identity === "same" ? (
        <p>
          <Trans>You are the same person here as there, with the same recovery words.</Trans>
        </p>
      ) : null}
      {result.identity === "kept-own" ? (
        <p>
          <Trans>
            This Potyro already knew you as someone else, and apps here are shared under that name, so it was kept. To be the person you
            were on {site}, enter those recovery words under You.
          </Trans>
        </p>
      ) : null}
      {result.failed.length ? (
        <div className="k-move-notes" data-tone="warn">
          <p>
            <Trans>Some things could not come in. Try again from {site}; what is already here is not doubled.</Trans>
          </p>
          <ul>
            {result.failed.map((f) => (
              <li key={f.name}>
                <strong>{f.name}</strong>: {f.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="k-move-actions">
        <button type="button" className="k-add k-primary-action" onClick={() => navigateTo({ kind: "home" })}>
          <Trans>Open your apps</Trans>
        </button>
      </div>
    </section>
  );
}

function Failed({ reason, onFile }: { reason: string; onFile: () => void }) {
  return (
    <section className="k-move-card" data-state="failed" role="alert">
      <h1 className="k-move-title">
        <Trans>Nothing came in</Trans>
      </h1>
      <p>{reason}</p>
      <div className="k-move-actions">
        <button type="button" className="k-add" onClick={onFile}>
          <Trans>Choose a file</Trans>
        </button>
        <button type="button" className="k-move-quiet" onClick={() => navigateTo({ kind: "home" })}>
          <Trans>Go to your apps</Trans>
        </button>
      </div>
    </section>
  );
}
