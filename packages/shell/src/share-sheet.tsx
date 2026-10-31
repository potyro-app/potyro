// Share (docs/24 §1): two ways, said plainly, the one most people want first.
//
//   A link anyone can try — the app, running, with sample records when it has some, else an empty
//                           copy of it. Nothing of yours goes with it.
//                           Sent by copying it, through WhatsApp or Telegram, or the device's own sheet.
//   A 15-second clip      — only where the app is on screen: a video of it, to post (docs/24 §8).
//   Use it together       — an invite into the app AND its records (the existing #join= link, sync on).
import { Mascot } from "@potyro/views";
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { DEFAULT_NAME, peekIdentity } from "@potyro/identity";
import { ShareBody } from "./dialog.js";
import type { UserApp } from "./user-apps.js";
import { appKey, updateEntry } from "./launcher-store.js";
import type { MadeDemoLink } from "./demo-share.js";
import { creditLine } from "./credit-words.js";
import { shareEvent } from "./share-events.js";
import { networkLinks } from "./share-networks.js";
import { CLIP_SECONDS, clipEnvFor, clipWay, startClip, type Recording } from "./clip.js";
import { shellCaps } from "./shell-caps.js";
import { LegalLink } from "./legal-links.js";
import { usesOwnRelay } from "./open-store.js";
import { hasSeeder } from "./seed.js";

type State = { kind: "choose" } | { kind: "making" } | { kind: "made"; made: MadeDemoLink } | { kind: "failed"; why: string };

type Clip =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "recording"; left: number; recording: Recording }
  | { kind: "ready"; blob: Blob; ext: "mp4" | "webm" }
  | { kind: "saved"; file: string }
  | { kind: "failed"; why: string };

export interface ShareSheetProps {
  app: UserApp;
  onClose: () => void;
  /** Use it together: the invite. Absent where it cannot start from here; the sheet then says where it can. */
  onInvite?: () => void;
  /** The app on screen, when it is: what a clip records. Absent from the launcher, where no app is open. */
  clipRoot?: () => Element | null;
}

/**
 * Whether a demo link of this app opens on sample records (docs/24 §3): its own first-run seeder, or
 * the seed kept beside it — the one its package came with, or for an app made in the Studio the ones
 * the create loop asked for (#486). An app with neither (made before that, or whose model reply did
 * not fit) opens empty.
 * What the sheet says at first, from the kept seed alone; then what fits the app as it is now
 * (`useSamplesFit`); once the link is made, the link itself (`MadeDemoLink.samples`).
 */
export function hasSampleRecords(app: Pick<UserApp, "id" | "seed">): boolean {
  return hasSeeder(app.id) || Object.values(app.seed ?? {}).some((rows) => rows.length > 0);
}

/**
 * Whether any of the kept seed fits the app as it is now (#486): a version whose shape takes none of
 * its rows opens empty, and the sheet says so before the link is made. Null until it is known.
 */
function useSamplesFit(app: UserApp): boolean | null {
  const [fits, setFits] = useState<{ key: string; fits: boolean } | null>(null);
  const kept = !hasSeeder(app.id) && hasSampleRecords(app);
  const key = kept ? `${app.id}\n${app.source}\n${JSON.stringify(app.seed)}` : "";
  useEffect(() => {
    if (!key) return;
    let live = true;
    void import("./demo-package.js")
      .then((m) => m.linkHasSamples(app))
      .then((fit) => live && setFits({ key, fits: fit }))
      .catch((e: unknown) => console.warn("[potyro] could not fit the sample records to the app:", e));
    return () => {
      live = false;
    };
    // `key` is the app's id, source and seed: what the answer depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key && fits?.key === key ? fits.fits : null;
}

const WHATSAPP = "WhatsApp"; // i18n-ignore — a name
const TELEGRAM = "Telegram"; // i18n-ignore — a name

export function ShareSheet({ app, onClose, onInvite, clipRoot }: ShareSheetProps) {
  const { t } = useLingui();
  const [state, setState] = useState<State>({ kind: "choose" });
  const [clip, setClip] = useState<Clip>({ kind: "idle" });
  const me = peekIdentity();
  // A kept app is passed on as its maker's (docs/24 §6): there is no "by me" to offer for it.
  const kept = Boolean(app.credit && !app.remixOf);
  const myName = !kept && me && me.name && me.name !== DEFAULT_NAME ? me.name : undefined;
  const madeBy = kept ? creditLine(app.credit) : null;
  const [showName, setShowName] = useState(Boolean(myName));
  const name = app.name;
  const busy = state.kind === "making" || clip.kind === "starting";
  const fit = useSamplesFit(app);
  const samples = state.kind === "made" ? state.made.samples : (fit ?? hasSampleRecords(app));

  const make = async (): Promise<void> => {
    setState({ kind: "making" });
    try {
      const { makeDemoLink } = await import("./demo-share.js");
      const made = await makeDemoLink(app, { by: showName ? myName : undefined });
      // A hosted link is the app published (#423): the Studio's Publish becomes Copy link.
      if (made.hosted) updateEntry(appKey("user", app.id), { published: { link: made.link, at: new Date().toISOString() } });
      setState({ kind: "made", made });
    } catch (e) {
      setState({ kind: "failed", why: e instanceof Error ? e.message : String(e) });
    }
  };

  const record = async (): Promise<void> => {
    setClip({ kind: "starting" });
    try {
      let rec: Recording | null = null;
      rec = await startClip(clipRoot?.() ?? null, { onTick: (left) => rec && setClip({ kind: "recording", left, recording: rec }) });
      setClip({ kind: "recording", left: CLIP_SECONDS, recording: rec });
      const { blob, ext } = await rec.done;
      setClip({ kind: "ready", blob, ext });
    } catch (e) {
      // Declining the browser's "share this tab?" is not a failure worth a sentence.
      if (e instanceof DOMException && e.name === "NotAllowedError") return setClip({ kind: "idle" });
      setClip({ kind: "failed", why: e instanceof Error ? e.message : String(e) });
    }
  };

  const saveClip = async (blob: Blob, ext: string): Promise<void> => {
    const file = `${app.id}-clip.${ext}`;
    try {
      await shellCaps().filesystem.save(file, blob);
      shareEvent("clip-recorded");
      setClip({ kind: "saved", file });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setClip({ kind: "failed", why: e instanceof Error ? e.message : String(e) });
    }
  };

  // While it records, the app is what is on screen: the sheet steps aside for a small bar with Stop.
  if (clip.kind === "recording") {
    const left = clip.left;
    return (
      <div className="k-clip-pill" role="status" aria-live="polite">
        <span className="k-clip-dot" aria-hidden />
        <span>
          <Trans comment="While a clip of the app is recorded; left is seconds">Recording · {left} s</Trans>
        </span>
        <button type="button" className="k-add" onClick={() => clip.recording.stop()}>
          <Trans comment="Stop recording the clip">Stop</Trans>
        </button>
      </div>
    );
  }

  const way = clipRoot ? clipWay(clipEnvFor(clipRoot())) : null;
  const file = clip.kind === "saved" ? clip.file : "";
  const why = clip.kind === "failed" ? clip.why : "";
  const shareText = t({ message: `Try ${name}, made with Potyro`, comment: "The words sent with a demo link in a chat" });

  return (
    <div className="k-modal-scrim" onClick={busy ? undefined : onClose}>
      <div
        className="k-modal k-share-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t({ message: `Share ${name}`, comment: "The share sheet's title" })}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <header className="k-share-sheet-head">
          <p className="k-ask-eyebrow">
            <Trans comment="Share sheet eyebrow">Share</Trans>
          </p>
          <h2>{name}</h2>
        </header>

        <section className="k-share-way k-share-way-try" aria-labelledby="k-share-try-title">
          <h3 id="k-share-try-title" className="k-share-try-title">
            {/* A success (DESIGN.md §4.2): the link is made, the mascot comes in. */}
            {state.kind === "made" ? <Mascot mode="enter" size={32} /> : null}
            <Trans>A link anyone can try</Trans>
          </h3>
          <p className="k-muted" data-share-opens={samples ? "samples" : "empty"}>
            {samples ? (
              <Trans>It opens the app right away in any browser, with sample records. No account, nothing to install. None of your records go with it.</Trans>
            ) : (
              <Trans comment="Share sheet, A link anyone can try, for an app with no sample records of its own (one made in the Studio)">
                It opens an empty copy of the app right away in any browser. No account, nothing to install. Your records stay with you.
              </Trans>
            )}
          </p>
          {state.kind === "made" ? (
            <>
              {state.made.hosted ? null : (
                <p className="k-share-note">
                  <Trans>This link carries the whole app, so chats show it without a preview picture.</Trans>
                </p>
              )}
              <NetworkRow link={state.made.link} text={shareText} />
              <ShareBody link={state.made.link} onDone={onClose} onHanded={(how) => how !== "save" && shareEvent(`share-network:${how}`)} />
            </>
          ) : (
            <>
              {madeBy ? <p className="k-share-note">{madeBy}</p> : null}
              {myName ? (
                <label className="k-share-name">
                  <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} disabled={state.kind === "making"} />
                  <span>
                    <Trans>Say it is by {myName}</Trans>
                  </span>
                </label>
              ) : null}
              {state.kind === "failed" ? (
                <p className="k-add-app-error" role="alert">
                  {state.why}
                </p>
              ) : null}
              <button type="button" className="k-add k-primary-action k-share-make" data-share="demo" disabled={busy} onClick={() => void make()}>
                {state.kind === "making" ? t`Making the link` : state.kind === "failed" ? t`Try again` : t`Make the link`}
              </button>
            </>
          )}
          {/* The link's name, line and picture are public (#117, docs/24 §4): what, and for how long. */}
          <LegalLink section="links" block>
            <Trans comment="Share sheet: link to the privacy page's section on demo links">What a link makes public, and for how long</Trans>
          </LegalLink>
        </section>

        {way ? (
          <section className="k-share-way k-share-way-clip" aria-labelledby="k-share-clip-title">
            <h3 id="k-share-clip-title">
              <Trans>A 15-second clip</Trans>
            </h3>
            <p className="k-muted">
              <Trans>Record the app as it is on your screen, to post as a video. Nothing is uploaded: you get a file.</Trans>
            </p>
            {way === "none" ? (
              <p className="k-share-note" data-clip="unsupported">
                <Trans>This browser cannot record the app. Your phone’s own screen recorder can: record the app, then trim it to 15 seconds.</Trans>
              </p>
            ) : clip.kind === "ready" ? (
              <>
                <p className="k-share-note" role="status">
                  <Trans>The clip is ready.</Trans>
                </p>
                <button type="button" className="k-add k-primary-action" data-clip="save" onClick={() => void saveClip(clip.blob, clip.ext)}>
                  <Trans>Save the clip</Trans>
                </button>
              </>
            ) : clip.kind === "saved" ? (
              <p className="k-share-note" role="status">
                <Trans>Saved {file}.</Trans>
              </p>
            ) : (
              <>
                {way === "tab" ? (
                  <p className="k-share-note">
                    <Trans>Your browser will ask what to record: choose this tab.</Trans>
                  </p>
                ) : null}
                {clip.kind === "failed" ? (
                  <p className="k-add-app-error" role="alert">
                    <Trans>The clip could not be recorded: {why}</Trans>
                  </p>
                ) : null}
                <button type="button" className="k-add" data-clip="record" disabled={busy} onClick={() => void record()}>
                  <Trans>Record a clip</Trans>
                </button>
              </>
            )}
          </section>
        ) : null}

        <section className="k-share-way k-share-way-together" aria-labelledby="k-share-together-title">
          <h3 id="k-share-together-title">
            <Trans>Use it together</Trans>
          </h3>
          <p className="k-muted">
            <Trans>Invite people into this app and its records. What one of you changes, the others see.</Trans>
          </p>
          {onInvite ? (
            <button
              type="button"
              className="k-add"
              data-share="invite"
              disabled={busy}
              onClick={() => {
                onClose();
                onInvite();
              }}
            >
              <Trans>Invite people</Trans>
            </button>
          ) : (
            <p className="k-muted">
              <Trans>Choose Share on its tile in your apps to invite someone: that turns on sync for it.</Trans>
            </p>
          )}
          {/* Through a relay of the person's own, sharing keeps nothing on Potyro's server (#117). */}
          {usesOwnRelay() ? null : (
            <LegalLink section="sync" block>
              <Trans comment="Share sheet, Use it together: link to the privacy page's section on sync and sharing">What sharing keeps on Potyro’s server</Trans>
            </LegalLink>
          )}
        </section>
      </div>
    </div>
  );
}

/** Straight into a chat: each network's own share address, opened by the person's tap. */
function NetworkRow({ link, text }: { link: string; text: string }) {
  const { t } = useLingui();
  const nets = networkLinks(link, text);
  return (
    <div className="k-share-networks" role="group" aria-label={t({ message: "Send it with", comment: "Share sheet: the chat apps a link can be sent with" })}>
      <a className="k-share-net" data-net="whatsapp" href={nets.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => shareEvent("share-network:whatsapp")}>
        <span className="k-share-net-mark" aria-hidden />
        {WHATSAPP}
      </a>
      {nets.telegram ? (
        <a className="k-share-net" data-net="telegram" href={nets.telegram} target="_blank" rel="noopener noreferrer" onClick={() => shareEvent("share-network:telegram")}>
          <span className="k-share-net-mark" aria-hidden />
          {TELEGRAM}
        </a>
      ) : null}
    </div>
  );
}
