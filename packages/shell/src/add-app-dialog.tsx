// The Add an app dialog (#253): pick where it comes from, see what it is, decide how it runs.
//
// The card is the point. Before anything is saved it says what the app is called, what it keeps,
// what it would ask this device for, what it ships with, which libraries it fetches and from where
// (#266), and — when the same app is here already — that this is an update. Trust is chosen on the card, never assumed: sealed unless the person says
// "I wrote this", which a link cannot offer. The card is drawn from what the package declares, never by
// running the app (#271); a test load in the sealed box then says, in plain words, what the app would
// miss there, and offers to run it as theirs instead.
import { fmt } from "@potyro/i18n";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { pickFilesFromInput } from "@potyro/capabilities";
import type { AppPackage } from "@potyro/store";
import { gatherFromFiles, gatherFromLink, gatherFromPaste, inspectPackage, installPackage, type AddSource, type Inspected, type Installed } from "./add-app.js";
import { describeLibrary, formatSize } from "./package-libraries.js";
import { describeMissing } from "./missing-features.js";
import { navigateTo } from "./router.js";
import { PromoteButton } from "./trust-dialog.js";
import { creditLine } from "./credit-words.js";
import { handToStudio } from "./studio-handoff.js";
import { galleryUrl } from "./gallery-link.js";
import { Glyph } from "@potyro/views";

type Step =
  | { kind: "choose"; tab: AddSource | null }
  | { kind: "reading" }
  | { kind: "card"; pkg: AppPackage; inspected: Inspected; source: AddSource; link?: string }
  | { kind: "installing"; name: string }
  | { kind: "updated"; done: Installed; sealed: SealedAfter };

/**
 * What stands between a sealed app that was just added and working: one of its libraries, or a
 * feature the box lacks. Then the card offers to let it run as yours (owner, 2026-10-13) — after
 * install, for a link too: a link is never trusted on the way IN.
 */
interface SealedAfter {
  /** Why it will not open sealed, when it will not. */
  problem?: string;
  /** What it reaches for that the box lacks. */
  missing: string[];
  /** It will not open at all sealed, rather than miss a part. */
  failsToOpen: boolean;
}

function sealedAfter(done: Installed, inspected: Inspected): SealedAfter {
  if (done.app.trusted) return { missing: [], failsToOpen: false };
  // What the check after the fetch found outranks what the card found before it.
  const rechecked = done.sealedProblem !== undefined || done.missing !== undefined;
  const problem = done.sealedProblem ?? (rechecked ? undefined : inspected.sealedProblem);
  const missing = done.missing ?? (rechecked ? [] : inspected.missing);
  return { problem, missing, failsToOpen: !!problem || (!rechecked && inspected.failsToOpenSealed && missing.length > 0) };
}


/** "a, b and c" in the active language. */
const list = (words: readonly string[]): string => fmt.list(words);

/**
 * `initialFiles`: files that arrived from outside — dropped on Potyro, or opened or shared with it
 * (#254) — read straight away, as if they had been chosen here.
 *
 * `initialPackage`: the package a demo link carried (docs/24), read straight away as one that came
 * from a link — so it is sealed, and "I wrote this" is never offered for it. A function is called for
 * it: Make it mine from an app on this device builds its package first (remix.tsx).
 *
 * `onAdded`: told once the app is saved, before it is opened.
 *
 * `onGallery`: told as the person leaves for the gallery, in this tab (#487), so what the screen
 * behind holds can be kept first.
 *
 * `remix`: Make it mine (docs/24 §6) — the person's own copy to change: always a new app beside any copy
 * they have, credited as a remix, sealed like anything from someone else, and opened with the Studio
 * asking what to change. It may start with the package's sample records or empty; the card asks.
 */
export function AddAppDialog({
  onClose,
  initialLink,
  initialFiles,
  initialPackage,
  onAdded,
  remix,
  onGallery,
}: {
  onClose: () => void;
  initialLink?: string;
  initialFiles?: File[];
  initialPackage?: AppPackage | (() => Promise<AppPackage>);
  onAdded?: (done: Installed) => void;
  remix?: boolean;
  onGallery?: () => void;
}) {
  const { t } = useLingui();
  const [step, setStep] = useState<Step>(initialFiles?.length || initialPackage ? { kind: "reading" } : { kind: "choose", tab: initialLink ? "link" : null });
  const [link, setLink] = useState(initialLink ?? "");
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [mode, setMode] = useState<"replace" | "copy">("replace");
  // A remix starts with the app's sample records unless the person says otherwise (docs/24 §6).
  const [withSamples, setWithSamples] = useState(true);
  const linkRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (step.kind !== "choose") return;
    if (step.tab === "link") linkRef.current?.focus();
    if (step.tab === "paste") pasteRef.current?.focus();
  }, [step]);

  const read = async (source: AddSource, gather: () => Promise<AppPackage>, from?: string): Promise<void> => {
    setError(null);
    setStep({ kind: "reading" });
    try {
      const pkg = await gather();
      const inspected = await inspectPackage(pkg);
      setMine(false);
      setMode("replace");
      setStep({ kind: "card", pkg, inspected, source, link: from });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep({ kind: "choose", tab: source === "file" ? null : source });
    }
  };

  // Files that arrived from outside are read once: a second read (strict mode) would only repeat it.
  const readInitial = useRef(false);
  useEffect(() => {
    if (readInitial.current) return;
    if (initialPackage) {
      readInitial.current = true;
      void read("link", typeof initialPackage === "function" ? initialPackage : async () => initialPackage);
      return;
    }
    if (!initialFiles?.length) return;
    readInitial.current = true;
    void read("file", () => gatherFromFiles(initialFiles));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fromDevice = async (): Promise<void> => {
    const files = await pickFilesFromInput({ multiple: true });
    if (!files.length) return; // cancelled
    await read("file", () => gatherFromFiles(files));
  };

  const install = async (): Promise<void> => {
    if (step.kind !== "card") return;
    setError(null);
    setStep({ kind: "installing", name: step.inspected.name });
    try {
      const done = await installPackage(step.pkg, step.inspected, { source: step.source, mine, mode: remix ? "copy" : mode, link: step.link, remix, ...(remix ? { seed: withSamples } : {}) });
      onAdded?.(done);
      // The copy opens with the Studio on it, greeting it as a remix (studio-thread-view.tsx).
      if (remix) handToStudio(done.app.id);
      // Something to say before opening: changed files kept, files the new version dropped, or a
      // library that cannot start in the sealed box (known only once it was fetched).
      const sealed = sealedAfter(done, step.inspected);
      if (sealed.problem || sealed.missing.length || (done.updated && (done.files.kept.length || done.files.removed.length))) setStep({ kind: "updated", done, sealed });
      else navigateTo({ kind: "user", id: done.app.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(step);
    }
  };

  const busy = step.kind === "reading" || step.kind === "installing";
  const addingName = step.kind === "installing" ? step.name : "";
  const doneName = step.kind === "updated" ? step.done.app.name : "";
  const keptFiles = step.kind === "updated" ? list(step.done.files.kept) : "";
  const removedFiles = step.kind === "updated" ? list(step.done.files.removed) : "";

  return (
    <div className="k-modal-scrim" onClick={busy ? undefined : onClose}>
      <div
        className="k-modal k-add-app"
        role="dialog"
        aria-modal="true"
        aria-label={remix ? t({ message: "Make it mine", comment: "The Add-an-app dialog, opened from Make it mine: your own copy of an app to change" }) : t`Add an app`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <header className="k-add-app-head">
          {remix ? (
            <>
              <h2>
                <Trans comment="The Add-an-app dialog, opened from Make it mine: your own copy of an app to change">Make it mine</Trans>
              </h2>
              <p className="k-muted">
                <Trans>You get your own copy to change, beside anything you already have. Then the Studio opens on it and asks what you would like to change.</Trans>
              </p>
            </>
          ) : (
            <>
              <h2>
                <Trans>Add an app</Trans>
              </h2>
              <p className="k-muted">
                <Trans>Someone sent you one, or you made it somewhere else.</Trans>
              </p>
            </>
          )}
        </header>

        {step.kind === "choose" ? (
          <>
            <div className="k-add-app-sources" role="group" aria-label={t`Where it comes from`}>
              <button type="button" className="k-add-app-source" onClick={() => void fromDevice()}>
                <span className="k-add-app-source-glyph" aria-hidden><Glyph icon="download" size={24} /></span>
                <span className="k-add-app-source-title">
                  <Trans>From this device</Trans>
                </span>
                <span className="k-muted">
                  <Trans>A package (.zip), or the app’s file with the files it uses</Trans>
                </span>
              </button>
              <button type="button" className="k-add-app-source" aria-pressed={step.tab === "link"} onClick={() => setStep({ kind: "choose", tab: "link" })}>
                <span className="k-add-app-source-glyph" aria-hidden><Glyph icon="link" size={24} /></span>
                <span className="k-add-app-source-title">
                  <Trans>From a link</Trans>
                </span>
                <span className="k-muted">
                  <Trans>To the app’s source or its package</Trans>
                </span>
              </button>
              <button type="button" className="k-add-app-source" aria-pressed={step.tab === "paste"} onClick={() => setStep({ kind: "choose", tab: "paste" })}>
                <span className="k-add-app-source-glyph" aria-hidden><Glyph icon="clipboard-paste" size={24} /></span>
                <span className="k-add-app-source-title">
                  <Trans>Paste the source</Trans>
                </span>
                <span className="k-muted">
                  <Trans>The whole app, as text</Trans>
                </span>
              </button>
              {/* Not a source of its own: the gallery's apps are demo links, which open here as any link does.
                  In this tab (gallery-link.ts): its Make it mine comes back to the tab with your apps. */}
              <a className="k-add-app-source k-add-app-gallery" href={galleryUrl()} onClick={onGallery}>
                <span className="k-add-app-source-glyph" aria-hidden><Glyph icon="images" size={24} /></span>
                <span className="k-add-app-source-title">
                  <Trans comment="Add an app: Potyro's gallery of apps">From the gallery</Trans>
                </span>
                <span className="k-muted">
                  <Trans>Apps to try, and to make your own</Trans>
                </span>
              </a>
            </div>

            {step.tab === "link" ? (
              <form
                className="k-add-app-entry"
                onSubmit={(e) => {
                  e.preventDefault();
                  void read("link", () => gatherFromLink(link), link.trim());
                }}
              >
                {/* i18n-ignore — the placeholder is the start of a web address */}
                <input ref={linkRef} id="k-add-app-link" className="k-input" type="url" inputMode="url" placeholder="https://…" aria-label={t`Link to the app`} value={link} onChange={(e) => setLink(e.target.value)} />
                <button type="submit" className="k-add k-primary-action" disabled={!link.trim()}>
                  <Trans comment="Add an app: download the app from the link">Fetch</Trans>
                </button>
              </form>
            ) : null}

            {step.tab === "paste" ? (
              <form
                className="k-add-app-entry k-add-app-entry-paste"
                onSubmit={(e) => {
                  e.preventDefault();
                  void read("paste", async () => gatherFromPaste(paste));
                }}
              >
                {/* i18n-ignore — the placeholder is code */}
                <textarea ref={pasteRef} id="k-add-app-paste" className="k-input k-add-app-paste" spellCheck={false} placeholder={'import { defineApp } from "potyro";\n…'} aria-label={t`The app's source`} value={paste} onChange={(e) => setPaste(e.target.value)} />
                <button type="submit" className="k-add k-primary-action" disabled={!paste.trim()}>
                  <Trans>Check it</Trans>
                </button>
              </form>
            ) : null}
          </>
        ) : null}

        {step.kind === "reading" || step.kind === "installing" ? (
          <p className="k-add-app-busy" role="status">
            <span className="k-media-bar" aria-hidden />
            {step.kind === "reading" ? t`Reading it` : t`Adding ${addingName}`}
          </p>
        ) : null}

        {step.kind === "card" ? <Card step={step} mine={mine} setMine={setMine} mode={mode} setMode={setMode} remix={remix} withSamples={withSamples} setWithSamples={setWithSamples} /> : null}

        {step.kind === "updated" ? (
          <div className="k-add-app-updated" role="status">
            <p>
              {step.done.updated ? (
                <Trans>
                  <strong>{doneName}</strong> is updated, with your data as it was.
                </Trans>
              ) : (
                <Trans>
                  <strong>{doneName}</strong> is added.
                </Trans>
              )}
            </p>
            {step.sealed.problem || step.sealed.missing.length ? <RunsAsYours done={step.done} sealed={step.sealed} /> : null}
            {step.done.files.kept.length ? (
              <p>
                {plural(step.done.files.kept.length, {
                  one: `Kept your own version of ${keptFiles}: you changed it after it came with the app.`,
                  other: `Kept your own version of ${keptFiles}: you changed them after it came with the app.`,
                })}
              </p>
            ) : null}
            {step.done.files.removed.length ? (
              <p>
                {plural(step.done.files.removed.length, {
                  one: `The new version no longer comes with ${removedFiles}, so it is gone.`,
                  other: `The new version no longer comes with ${removedFiles}, so they are gone.`,
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="k-add-app-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="k-form-actions">
          {step.kind === "updated" ? (
            <button
              type="button"
              // When it only works as yours, that is the button that stands out; this one opens it sealed.
              className={step.sealed.problem || step.sealed.missing.length ? "k-add" : "k-add k-primary-action"}
              onClick={() => navigateTo({ kind: "user", id: step.done.app.id })}
            >
              <Trans>Open {doneName}</Trans>
            </button>
          ) : (
            <>
              {step.kind === "card" && !initialPackage ? (
                <button type="button" className="k-add" onClick={() => setStep({ kind: "choose", tab: step.source === "file" ? null : step.source })}>
                  <Trans>Back</Trans>
                </button>
              ) : null}
              <button type="button" className="k-add" onClick={onClose} disabled={busy}>
                <Trans>Cancel</Trans>
              </button>
              {step.kind === "card" ? (
                <button type="button" className="k-add k-primary-action" disabled={step.inspected.issues.length > 0} onClick={() => void install()}>
                  {remix ? t({ message: "Make it mine", comment: "Add-an-app card button, opened from Make it mine: your own copy of an app to change" }) : step.inspected.installed && mode === "replace" ? t`Update app` : t`Add app`}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({
  step,
  mine,
  setMine,
  mode,
  setMode,
  remix,
  withSamples,
  setWithSamples,
}: {
  remix?: boolean;
  withSamples: boolean;
  setWithSamples: (v: boolean) => void;
  step: Extract<Step, { kind: "card" }>;
  mine: boolean;
  setMine: (v: boolean) => void;
  mode: "replace" | "copy";
  setMode: (v: "replace" | "copy") => void;
}) {
  const { t } = useLingui();
  const { inspected: app, source } = step;
  const name = app.name;
  const fileCount = app.files.length;
  const size = formatSize(app.files.reduce((n, f) => n + f.size, 0));
  const trialProblem = app.trialProblem;
  const fetches = app.libraries.filter((l) => !l.here).length;
  // Whether it will run in the sealed box once added: what decides if a library that needs a web page matters.
  const sealed = source === "link" || (!mine && !(app.installed?.trusted && mode === "replace"));
  return (
    <section className="k-add-app-card" aria-label={t({ message: `About ${name}`, comment: "Add an app: the card describing the app" })}>
      <div className="k-add-app-ident">
        <span className="k-launch-avatar" aria-hidden>
          <Glyph icon={app.icon} size={24} fallback={app.name.slice(0, 2).toUpperCase()} />
        </span>
        <div>
          <h3>{app.name}</h3>
          {creditLine(app.credit) ? <p className="k-add-app-credit">{creditLine(app.credit)}</p> : null}
          <p className="k-muted">{app.installed && !remix ? t`Already on this device` : t`New on this device`}</p>
        </div>
      </div>

      <dl className="k-add-app-facts">
        <div>
          <dt>
            <Trans comment="Add an app card: the kinds of record the app keeps">Keeps</Trans>
          </dt>
          <dd>{app.keeps.length ? list(app.keeps) : app.preview === "unavailable" ? t`not known until it runs` : t`nothing of its own`}</dd>
        </div>
        <div>
          <dt>
            <Trans comment="Add an app card: what the app asks this device for (camera, location…)">Asks for</Trans>
          </dt>
          <dd>{app.asks.length ? list(app.asks) : app.preview === "unavailable" ? t`not known until it runs` : t`nothing on this device`}</dd>
        </div>
        {app.files.length ? (
          <div>
            <dt>
              <Trans comment="Add an app card: the files the app ships with">Comes with</Trans>
            </dt>
            <dd>
              {fileCount === 1 ? app.files[0]!.path : plural(fileCount, { one: "# file", other: "# files" })} · {size}
            </dd>
          </div>
        ) : null}
        {app.modules.length ? (
          <div>
            <dt>
              <Trans>Code files</Trans>
            </dt>
            <dd>{list(app.modules)}</dd>
          </div>
        ) : null}
        {app.libraries.length ? (
          <div>
            <dt>
              <Trans>Libraries</Trans>
            </dt>
            <dd>
              <ul className="k-add-app-libraries">
                {app.libraries.map((l) => (
                  <li key={l.url}>{describeLibrary(l)}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {app.seedRows && !remix && !(app.installed && mode === "replace") ? (
          <div>
            <dt>
              <Trans comment="Add an app card: the records it comes with">Starts with</Trans>
            </dt>
            <dd>
              {plural(app.seedRows, { one: "# record", other: "# records" })}
            </dd>
          </div>
        ) : null}
      </dl>

      {fetches ? (
        <p className="k-muted k-add-app-note">
          {plural(fetches, {
            one: "It is fetched once, when you add the app, and kept with it: after that the app works without the internet.",
            other: "They are fetched once, when you add the app, and kept with it: after that the app works without the internet.",
          })}
        </p>
      ) : null}
      {sealed && app.ownScreens ? (
        <p className="k-muted k-add-app-note k-add-app-screens">
          <Trans>It draws its own screens, inside the sealed box: from there they reach your data and this device only through Potyro, and only what you allow.</Trans>
        </p>
      ) : null}
      {app.preview === "unavailable" ? (
        <p className="k-add-app-note k-add-app-unpreviewed" role="note">
          <Trans>This app could not be previewed here, so what it keeps and asks for is not shown yet.</Trans>
          {app.previewProblem ? <span className="k-muted"> ({app.previewProblem})</span> : null}
        </p>
      ) : null}
      {app.sealedProblem ? (
        <p className="k-add-app-sealed" role="note">
          <span aria-hidden><Glyph icon="triangle-alert" size={16} /></span> {app.sealedProblem}
          {sealed ? " " : null}
          {sealed ? (source === "link" ? t`In the sealed box it will not open. Once it is added you can let it run as yours — only do that if you know who made it.` : t`In the sealed box it will not open: tick “I wrote this” below to run it as yours.`) : null}
        </p>
      ) : sealed && app.missing.length ? (
        <div className="k-add-app-sealed k-add-app-missing" role="note">
          <p>
            <span aria-hidden><Glyph icon="triangle-alert" size={16} /></span> {describeMissing(app.missing)}{" "}
            {app.failsToOpenSealed
              ? t`In the sealed box it will not open.`
              : plural(app.missing.length, {
                  one: "In the sealed box, the parts of it that use it will not work.",
                  other: "In the sealed box, the parts of it that use them will not work.",
                })}
          </p>
          {source === "link" ? (
            <p className="k-muted">
              <Trans>Once it is added you can let it run as yours. Only do that if you know who made it.</Trans>
            </p>
          ) : (
            <button type="button" className="k-add" onClick={() => setMine(true)}>
              <Trans>Run it as my own app</Trans>
            </button>
          )}
        </div>
      ) : sealed && app.trialProblem ? (
        <p className="k-add-app-sealed" role="note">
          <span aria-hidden><Glyph icon="triangle-alert" size={16} /></span> <Trans>It could not be tried in the sealed box: {trialProblem}</Trans>
        </p>
      ) : fetches && sealed ? (
        <p className="k-muted k-add-app-note">
          <Trans>Some libraries only work in an app that runs as yours. If one of these does, you will be told as soon as it is added.</Trans>
        </p>
      ) : null}

      {app.issues.length ? (
        <div className="k-add-app-issues" role="alert">
          <p>
            <Trans>This app has problems and cannot be added:</Trans>
          </p>
          <ul>
            {app.issues.slice(0, 6).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {remix && app.seedRows ? (
        // Its sample records — the app's own examples, never anyone's records (docs/24 §3) — or nothing.
        <label className="k-add-app-samples">
          <input type="checkbox" checked={withSamples} onChange={(e) => setWithSamples(e.target.checked)} />
          <span>
            <strong>
              {plural(app.seedRows, { one: "Start with its # sample record", other: "Start with its # sample records" })}
            </strong>
            <span className="k-muted">
              <Trans>So you can see what a change does. They are examples, not anyone’s own, and you can delete them. Leave it off to start empty.</Trans>
            </span>
          </span>
        </label>
      ) : null}

      {app.installed && !remix ? (
        <fieldset className="k-add-app-choice">
          <legend>
            <Trans>It is already here</Trans>
          </legend>
          <label>
            <input type="radio" name="k-add-app-mode" checked={mode === "replace"} onChange={() => setMode("replace")} />
            <span>
              <strong>
                <Trans>Replace it, keep its data</Trans>
              </strong>
              <span className="k-muted">
                <Trans>The old version stays in History. Files you changed are kept.</Trans>
              </span>
            </span>
          </label>
          <label>
            <input type="radio" name="k-add-app-mode" checked={mode === "copy"} onChange={() => setMode("copy")} />
            <span>
              <strong>
                <Trans>Add it as a second app</Trans>
              </strong>
              <span className="k-muted">
                <Trans>A separate copy, starting empty.</Trans>
              </span>
            </span>
          </label>
        </fieldset>
      ) : null}

      {source === "link" ? (
        <p className="k-add-app-trust">
          <span aria-hidden><Glyph icon="shield" size={16} /></span>{" "}
          <Trans>It runs in the sealed box: it can only reach what you allow, when it asks. If you know who made it, you can let it run as yours once it is added — from the app, or from its ⋯ menu on your apps.</Trans>
        </p>
      ) : app.installed?.trusted && mode === "replace" ? (
        <p className="k-add-app-trust">
          <span aria-hidden><Glyph icon="check" size={16} /></span> <Trans>It runs as yours, as it did before.</Trans>
        </p>
      ) : (
        <label className="k-add-app-trust k-add-app-mine">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          <span>
            <strong>
              <Trans>I wrote this. Run it as mine.</Trans>
            </strong>
            <span className="k-muted">
              <Trans>Directly, with everything this device lets apps do. Leave it off for an app from someone else: it then runs in the sealed box.</Trans>
            </span>
          </span>
        </label>
      )}
    </section>
  );
}

/** After it was added: why it only works as yours, the button that does that, and what happens otherwise. */
function RunsAsYours({ done, sealed }: { done: Installed; sealed: SealedAfter }) {
  return (
    <div className="k-add-app-sealed k-add-app-runs-as-yours" role="alert">
      {sealed.failsToOpen ? (
        <p>
          <span aria-hidden><Glyph icon="triangle-alert" size={16} /></span>{" "}
          <Trans>
            <strong>It only works when it runs as yours.</strong> Only let it if you know who made it. Otherwise it stays sealed, and it will not open.
          </Trans>
        </p>
      ) : (
        <p>
          <span aria-hidden><Glyph icon="triangle-alert" size={16} /></span>{" "}
          {sealed.missing.length === 1 ? (
            <Trans>
              <strong>Parts of it only work when it runs as yours.</strong> Only let it if you know who made it. Otherwise it stays sealed, and the parts that use it will not work.
            </Trans>
          ) : (
            <Trans>
              <strong>Parts of it only work when it runs as yours.</strong> Only let it if you know who made it. Otherwise it stays sealed, and the parts that use them will not work.
            </Trans>
          )}
        </p>
      )}
      <p className="k-muted">{sealed.problem ?? describeMissing(sealed.missing)}</p>
      <PromoteButton app={done.app} primary />
    </div>
  );
}
