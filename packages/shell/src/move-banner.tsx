// "Potyro has a new home" — on the OLD site only (docs/16 §Moving to a new home).
//
// Everything a person made here lives in this site's browser storage, which the new site cannot
// read. This banner packs it (move-gather.ts) and hands it to the new home in a window it opens, over
// `postMessage` (move-protocol.ts): no server sees any of it, and nothing here is deleted. Or, where a
// window cannot be opened, it saves the same thing as a file to open there.
//
// After the new site says it is all in, the banner says so — and stays able to do it again, because a
// second move is a merge (move-plan.ts) and brings only what changed.

import { Glyph } from "@potyro/views";
import { useEffect, useRef, useState } from "react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { currentNewHome, siteName } from "./move-origins.js";
import { acceptReply, envelope, newChannel, type MoveResult } from "./move-protocol.js";
import { archiveDigest, offerOf, type MoveManifest } from "./move-archive.js";
import { packEverything, type PackProgress } from "./move-gather.js";
import { shellCaps } from "./shell-caps.js";

/** The move this site handed over: where to, when, and what it came to there. */
export const MOVE_DONE = "potyro:move:done";
/** "Later", for this visit. The banner comes back next time: the move is not something to lose. */
const LATER = "potyro:move:later";

interface Done extends MoveResult {
  to: string;
  at: string;
}

function readDone(to: string): Done | null {
  try {
    const raw = globalThis.localStorage?.getItem(MOVE_DONE);
    const done = raw ? (JSON.parse(raw) as Done) : null;
    return done && done.to === to ? done : null;
  } catch {
    return null;
  }
}

type Phase =
  | { kind: "idle" }
  | { kind: "packing"; progress?: PackProgress; forFile: boolean }
  | { kind: "waiting" }
  | { kind: "sending" }
  | { kind: "blocked" }
  | { kind: "saved" }
  | { kind: "closed" }
  | { kind: "failed"; reason: string };

export function MoveBanner() {
  const newHome = currentNewHome();
  if (!newHome) return null;
  return <Banner newHome={newHome} />;
}

function Banner({ newHome }: { newHome: string }) {
  const { t } = useLingui();
  const site = siteName(newHome);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [done, setDone] = useState<Done | null>(() => readDone(newHome));
  const [later, setLater] = useState(() => {
    try {
      return globalThis.sessionStorage?.getItem(LATER) === "1";
    } catch {
      return false;
    }
  });
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const bringOver = (): void => {
    stop.current?.();
    const channel = newChannel();
    // Opened FIRST, inside the click: a window opened after an await is a pop-up the browser blocks.
    // The address carries the channel and nothing else.
    // Named, so bringing them over again reuses the window a first move opened: two tabs of the new
    // site would be two tabs after one storage (storage-elsewhere.tsx).
    const win = window.open(`${newHome}/?move=${channel}`, "potyro-move");
    if (!win) {
      setPhase({ kind: "blocked" });
      return;
    }
    let ready: { manifest: MoveManifest; bytes: Uint8Array; digest: string } | null = null;
    let hello = false;
    // Always to the new home's exact origin: if that window has gone somewhere else, nothing is delivered.
    const post = (message: Parameters<typeof envelope>[1], transfer?: Transferable[]): void => win.postMessage(envelope(channel, message), newHome, transfer ?? []);
    const offer = (): void => {
      if (!ready) return;
      post({ step: "offer", offer: offerOf(ready.manifest), digest: ready.digest, size: ready.bytes.length });
      setPhase({ kind: "waiting" });
    };

    const onMessage = (ev: MessageEvent): void => {
      const reply = acceptReply({ origin: ev.origin, fromChild: ev.source === win, data: ev.data }, channel, newHome);
      if (!reply) return;
      if (reply.step === "hello") {
        hello = true;
        offer();
      } else if (reply.step === "send" && ready) {
        // A copy each time: a transferred buffer is gone from this side.
        const bytes = ready.bytes.slice().buffer;
        post({ step: "archive", bytes, digest: ready.digest }, [bytes]);
        setPhase({ kind: "sending" });
      } else if (reply.step === "done") {
        const next: Done = { ...reply.result, to: newHome, at: new Date().toISOString() };
        globalThis.localStorage?.setItem(MOVE_DONE, JSON.stringify(next));
        setDone(next);
        setPhase({ kind: "idle" });
        cleanup();
      } else if (reply.step === "failed") {
        // Still listening: the new window may load again (its storage taken back from another tab)
        // and say hello, and then it is offered again.
        setPhase({ kind: "failed", reason: reply.reason });
      }
    };
    let finished = false;
    // The new window closed before it said it was done: nothing came in, and it can be tried again.
    const watch = setInterval(() => {
      if (!win.closed || finished) return;
      setPhase({ kind: "closed" });
      cleanup();
    }, 1000);
    const cleanup = (): void => {
      finished = true;
      clearInterval(watch);
      globalThis.removeEventListener("message", onMessage);
      stop.current = null;
    };
    globalThis.addEventListener("message", onMessage);
    stop.current = cleanup;

    setPhase({ kind: "packing", forFile: false });
    void (async () => {
      try {
        const packed = await packEverything({ from: location.origin, withIdentity: true, onProgress: (p) => setPhase({ kind: "packing", progress: p, forFile: false }) });
        ready = { manifest: packed.manifest, bytes: packed.bytes, digest: await archiveDigest(packed.bytes) };
        if (hello) offer();
        else setPhase({ kind: "waiting" });
      } catch (e) {
        setPhase({ kind: "failed", reason: e instanceof Error ? e.message : String(e) });
        cleanup();
      }
    })();
  };

  const saveFile = async (): Promise<void> => {
    setPhase({ kind: "packing", forFile: true });
    try {
      const packed = await packEverything({ from: location.origin, withIdentity: false, onProgress: (p) => setPhase({ kind: "packing", progress: p, forFile: true }) });
      const day = new Date().toISOString().slice(0, 10);
      await shellCaps().filesystem.save(`potyro-move-${day}.zip`, new Blob([packed.bytes as BlobPart], { type: "application/zip" }));
      setPhase({ kind: "saved" });
    } catch (e) {
      setPhase({ kind: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  };

  const dismiss = (): void => {
    try {
      globalThis.sessionStorage?.setItem(LATER, "1");
    } catch {
      // storage blocked: hidden for now anyway
    }
    setLater(true);
  };

  if (later && phase.kind === "idle") return null;
  const busy = phase.kind === "packing" || phase.kind === "waiting" || phase.kind === "sending";

  return (
    <section className="k-move" data-state={done && phase.kind === "idle" ? "done" : phase.kind} aria-labelledby="k-move-h" aria-live="polite">
      <div className="k-move-mark" aria-hidden>
        <span aria-hidden><Glyph icon="arrow-right" size={20} /></span>
      </div>
      <div className="k-move-body">
        {done && phase.kind === "idle" ? (
          <>
            <h2 id="k-move-h">
              <Trans>Done — your apps are on {site}</Trans>
            </h2>
            <p>
              {plural(done.apps, { one: "# app", other: "# apps" })}, {plural(done.records, { one: "# record", other: "# records" })},{" "}
              {plural(done.files, { one: "# file", other: "# files" })}.{" "}
              <Trans>Everything is still here too. Changed something here since? Bring them over again: what is already there is never doubled.</Trans>
            </p>
          </>
        ) : (
          <>
            <p className="k-move-eyebrow">
              <Trans>Potyro has a new home</Trans>
            </p>
            <h2 id="k-move-h">
              <Trans>Bring your apps over to {site}</Trans>
            </h2>
            <p>
              <Trans>
                Your apps, their records, files and Studio conversations are kept in this browser, for this address. Bring them to {site} in
                one go — straight from this window to the new one, through no server. Nothing here is deleted.
              </Trans>
            </p>
          </>
        )}
        <Status phase={phase} site={site} />
        <div className="k-move-actions">
          {done && phase.kind === "idle" ? (
            <a className="k-add k-primary-action" href={`${newHome}/`} target="_blank" rel="noreferrer">
              <Trans>Open {site}</Trans>
            </a>
          ) : null}
          {phase.kind === "saved" ? (
            // The page that takes a file. The address names the page and nothing else.
            <a className="k-add k-primary-action" href={`${newHome}/?move`} target="_blank" rel="noreferrer">
              <Trans>Open {site} to bring the file in</Trans>
            </a>
          ) : null}
          <button type="button" className={done ? "k-add" : "k-add k-primary-action"} disabled={busy} onClick={bringOver}>
            {done ? t`Bring them over again` : t`Bring my apps over`}
          </button>
          <button type="button" className="k-move-quiet" disabled={busy} onClick={() => void saveFile()}>
            <Trans>Save them as a file instead</Trans>
          </button>
          {!done && phase.kind === "idle" ? (
            <button type="button" className="k-move-quiet" onClick={dismiss}>
              <Trans>Later</Trans>
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Status({ phase, site }: { phase: Phase; site: string }) {
  if (phase.kind === "packing") {
    const p = phase.progress;
    const name = p?.name ?? "";
    const done = p?.done ?? 0;
    const total = p?.total ?? 0;
    return (
      <p className="k-move-status" role="status">
        <span className="k-move-spin" aria-hidden />
        {p ? <Trans>Packing {name} — {done} of {total}</Trans> : <Trans>Packing your apps</Trans>}
      </p>
    );
  }
  if (phase.kind === "waiting") {
    return (
      <p className="k-move-status" role="status">
        <span className="k-move-spin" aria-hidden />
        <Trans>Ready. Look at the {site} window: it shows what will come in and waits for you to say yes.</Trans>
      </p>
    );
  }
  if (phase.kind === "sending") {
    return (
      <p className="k-move-status" role="status">
        <span className="k-move-spin" aria-hidden />
        <Trans>Bringing them in on {site}</Trans>
      </p>
    );
  }
  if (phase.kind === "blocked") {
    return (
      <p className="k-move-status" data-tone="warn" role="status">
        <Trans>Your browser blocked the new window. Allow pop-ups for this site and try again — or save them as a file instead.</Trans>
      </p>
    );
  }
  if (phase.kind === "saved") {
    return (
      <p className="k-move-status" data-tone="good" role="status">
        <Trans>Saved. Open {site} with the button below and choose this file there. Who you are does not go in a file: to be the same person there, enter your recovery words under You.</Trans>
      </p>
    );
  }
  if (phase.kind === "closed") {
    return (
      <p className="k-move-status" data-tone="warn" role="status">
        <Trans>The {site} window was closed before it finished. Bring them over again when you are ready: nothing is doubled, and whatever was left out comes in.</Trans>
      </p>
    );
  }
  if (phase.kind === "failed") {
    const reason = phase.reason;
    return (
      <p className="k-move-status" data-tone="warn" role="status">
        <Trans>That did not work: {reason} Nothing here was changed. Try again: nothing is doubled.</Trans>
      </p>
    );
  }
  return null;
}
