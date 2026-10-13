// The Add an app dialog (#253): pick where it comes from, see what it is, decide how it runs.
//
// The card is the point. Before anything is saved it says what the app is called, what it keeps,
// what it would ask this device for, what it ships with, which libraries it fetches and from where
// (#266), and — when the same app is here already — that this is an update. Trust is chosen on the card, never assumed: sealed unless the person says
// "I wrote this", which a link cannot offer. The card is drawn from what the package declares, never by
// running the app (#271); a test load in the sealed box then says, in plain words, what the app would
// miss there, and offers to run it as theirs instead.
import { useEffect, useRef, useState } from "react";
import { pickFilesFromInput } from "@potyro/capabilities";
import type { AppPackage } from "@potyro/store";
import { gatherFromFiles, gatherFromLink, gatherFromPaste, inspectPackage, installPackage, type AddSource, type Inspected, type Installed } from "./add-app.js";
import { describeLibrary, formatSize } from "./package-libraries.js";
import { describeMissing } from "./missing-features.js";
import { navigateTo } from "./router.js";
import { PromoteButton } from "./trust-dialog.js";

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


const list = (words: string[]): string =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

export function AddAppDialog({ onClose, initialLink }: { onClose: () => void; initialLink?: string }) {
  const [step, setStep] = useState<Step>({ kind: "choose", tab: initialLink ? "link" : null });
  const [link, setLink] = useState(initialLink ?? "");
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [mode, setMode] = useState<"replace" | "copy">("replace");
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
      const done = await installPackage(step.pkg, step.inspected, { source: step.source, mine, mode, link: step.link });
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

  return (
    <div className="k-modal-scrim" onClick={busy ? undefined : onClose}>
      <div
        className="k-modal k-add-app"
        role="dialog"
        aria-modal="true"
        aria-label="Add an app"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <header className="k-add-app-head">
          <h2>Add an app</h2>
          <p className="k-muted">Someone sent you one, or you made it somewhere else.</p>
        </header>

        {step.kind === "choose" ? (
          <>
            <div className="k-add-app-sources" role="group" aria-label="Where it comes from">
              <button type="button" className="k-add-app-source" onClick={() => void fromDevice()}>
                <span className="k-add-app-source-glyph" aria-hidden>⤓</span>
                <span className="k-add-app-source-title">From this device</span>
                <span className="k-muted">A package (.zip), or the app’s file with the files it uses</span>
              </button>
              <button type="button" className="k-add-app-source" aria-pressed={step.tab === "link"} onClick={() => setStep({ kind: "choose", tab: "link" })}>
                <span className="k-add-app-source-glyph" aria-hidden>🔗</span>
                <span className="k-add-app-source-title">From a link</span>
                <span className="k-muted">To the app’s source or its package</span>
              </button>
              <button type="button" className="k-add-app-source" aria-pressed={step.tab === "paste"} onClick={() => setStep({ kind: "choose", tab: "paste" })}>
                <span className="k-add-app-source-glyph" aria-hidden>✎</span>
                <span className="k-add-app-source-title">Paste the source</span>
                <span className="k-muted">The whole app, as text</span>
              </button>
            </div>

            {step.tab === "link" ? (
              <form
                className="k-add-app-entry"
                onSubmit={(e) => {
                  e.preventDefault();
                  void read("link", () => gatherFromLink(link), link.trim());
                }}
              >
                <input ref={linkRef} id="k-add-app-link" className="k-input" type="url" inputMode="url" placeholder="https://…" aria-label="Link to the app" value={link} onChange={(e) => setLink(e.target.value)} />
                <button type="submit" className="k-add k-primary-action" disabled={!link.trim()}>
                  Fetch
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
                <textarea ref={pasteRef} id="k-add-app-paste" className="k-input k-add-app-paste" spellCheck={false} placeholder={'import { defineApp } from "potyro";\n…'} aria-label="The app's source" value={paste} onChange={(e) => setPaste(e.target.value)} />
                <button type="submit" className="k-add k-primary-action" disabled={!paste.trim()}>
                  Check it
                </button>
              </form>
            ) : null}
          </>
        ) : null}

        {step.kind === "reading" || step.kind === "installing" ? (
          <p className="k-add-app-busy" role="status">
            <span className="k-media-bar" aria-hidden />
            {step.kind === "reading" ? "Reading it…" : `Adding ${step.name}…`}
          </p>
        ) : null}

        {step.kind === "card" ? <Card step={step} mine={mine} setMine={setMine} mode={mode} setMode={setMode} /> : null}

        {step.kind === "updated" ? (
          <div className="k-add-app-updated" role="status">
            <p>
              <strong>{step.done.app.name}</strong> {step.done.updated ? "is updated, with your data as it was." : "is added."}
            </p>
            {step.sealed.problem || step.sealed.missing.length ? <RunsAsYours done={step.done} sealed={step.sealed} /> : null}
            {step.done.files.kept.length ? <p>Kept your own version of {list(step.done.files.kept)}: you changed {step.done.files.kept.length === 1 ? "it" : "them"} after it came with the app.</p> : null}
            {step.done.files.removed.length ? <p>The new version no longer comes with {list(step.done.files.removed)}, so {step.done.files.removed.length === 1 ? "it is" : "they are"} gone.</p> : null}
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
              Open {step.done.app.name}
            </button>
          ) : (
            <>
              {step.kind === "card" ? (
                <button type="button" className="k-add" onClick={() => setStep({ kind: "choose", tab: step.source === "file" ? null : step.source })}>
                  Back
                </button>
              ) : null}
              <button type="button" className="k-add" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              {step.kind === "card" ? (
                <button type="button" className="k-add k-primary-action" disabled={step.inspected.issues.length > 0} onClick={() => void install()}>
                  {step.inspected.installed && mode === "replace" ? "Update app" : "Add app"}
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
}: {
  step: Extract<Step, { kind: "card" }>;
  mine: boolean;
  setMine: (v: boolean) => void;
  mode: "replace" | "copy";
  setMode: (v: "replace" | "copy") => void;
}) {
  const { inspected: app, source } = step;
  const shippedBytes = app.files.reduce((n, f) => n + f.size, 0);
  const fetches = app.libraries.filter((l) => !l.here).length;
  // Whether it will run in the sealed box once added: what decides if a library that needs a web page matters.
  const sealed = source === "link" || (!mine && !(app.installed?.trusted && mode === "replace"));
  return (
    <section className="k-add-app-card" aria-label={`About ${app.name}`}>
      <div className="k-add-app-ident">
        <span className="k-launch-avatar" aria-hidden>
          {app.icon ?? app.name.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <h3>{app.name}</h3>
          <p className="k-muted">{app.installed ? "Already on this device" : "New on this device"}</p>
        </div>
      </div>

      <dl className="k-add-app-facts">
        <div>
          <dt>Keeps</dt>
          <dd>{app.keeps.length ? list(app.keeps) : app.preview === "unavailable" ? "not known until it runs" : "nothing of its own"}</dd>
        </div>
        <div>
          <dt>Asks for</dt>
          <dd>{app.asks.length ? list(app.asks) : app.preview === "unavailable" ? "not known until it runs" : "nothing on this device"}</dd>
        </div>
        {app.files.length ? (
          <div>
            <dt>Comes with</dt>
            <dd>
              {app.files.length === 1 ? app.files[0]!.path : `${app.files.length} files`} · {formatSize(shippedBytes)}
            </dd>
          </div>
        ) : null}
        {app.modules.length ? (
          <div>
            <dt>Code files</dt>
            <dd>{list(app.modules)}</dd>
          </div>
        ) : null}
        {app.libraries.length ? (
          <div>
            <dt>Libraries</dt>
            <dd>
              <ul className="k-add-app-libraries">
                {app.libraries.map((l) => (
                  <li key={l.url}>{describeLibrary(l)}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {app.seedRows && !(app.installed && mode === "replace") ? (
          <div>
            <dt>Starts with</dt>
            <dd>
              {app.seedRows} {app.seedRows === 1 ? "record" : "records"}
            </dd>
          </div>
        ) : null}
      </dl>

      {fetches ? (
        <p className="k-muted k-add-app-note">
          {fetches === 1 ? "It is" : "They are"} fetched once, when you add the app, and kept with it: after that the app works without the internet.
        </p>
      ) : null}
      {app.preview === "unavailable" ? (
        <p className="k-add-app-note k-add-app-unpreviewed" role="note">
          This app could not be previewed here, so what it keeps and asks for is not shown yet.
          {app.previewProblem ? <span className="k-muted"> ({app.previewProblem})</span> : null}
        </p>
      ) : null}
      {app.sealedProblem ? (
        <p className="k-add-app-sealed" role="note">
          <span aria-hidden>⚠</span> {app.sealedProblem}
          {sealed ? (source === "link" ? " In the sealed box it will not open. Once it is added you can let it run as yours — only do that if you know who made it." : " In the sealed box it will not open: tick “I wrote this” below to run it as yours.") : null}
        </p>
      ) : sealed && app.missing.length ? (
        <div className="k-add-app-sealed k-add-app-missing" role="note">
          <p>
            <span aria-hidden>⚠</span> {describeMissing(app.missing)}{" "}
            {app.failsToOpenSealed ? "In the sealed box it will not open." : `In the sealed box, the parts of it that use ${app.missing.length === 1 ? "it" : "them"} will not work.`}
          </p>
          {source === "link" ? (
            <p className="k-muted">Once it is added you can let it run as yours. Only do that if you know who made it.</p>
          ) : (
            <button type="button" className="k-add" onClick={() => setMine(true)}>
              Run it as my own app
            </button>
          )}
        </div>
      ) : sealed && app.trialProblem ? (
        <p className="k-add-app-sealed" role="note">
          <span aria-hidden>⚠</span> It could not be tried in the sealed box: {app.trialProblem}
        </p>
      ) : fetches && sealed ? (
        <p className="k-muted k-add-app-note">
          Some libraries only work in an app that runs as yours. If one of these does, you will be told as soon as it is added.
        </p>
      ) : null}

      {app.issues.length ? (
        <div className="k-add-app-issues" role="alert">
          <p>This app has problems and cannot be added:</p>
          <ul>
            {app.issues.slice(0, 6).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {app.installed ? (
        <fieldset className="k-add-app-choice">
          <legend>It is already here</legend>
          <label>
            <input type="radio" name="k-add-app-mode" checked={mode === "replace"} onChange={() => setMode("replace")} />
            <span>
              <strong>Replace it, keep its data</strong>
              <span className="k-muted">The old version stays in History. Files you changed are kept.</span>
            </span>
          </label>
          <label>
            <input type="radio" name="k-add-app-mode" checked={mode === "copy"} onChange={() => setMode("copy")} />
            <span>
              <strong>Add it as a second app</strong>
              <span className="k-muted">A separate copy, starting empty.</span>
            </span>
          </label>
        </fieldset>
      ) : null}

      {source === "link" ? (
        <p className="k-add-app-trust">
          <span aria-hidden>🛡</span> It runs in the sealed box: it can only reach what you allow, when it asks. If you know who made it, you can let it run as yours once it is added — from the app, or from its ⋯ menu on your apps.
        </p>
      ) : app.installed?.trusted && mode === "replace" ? (
        <p className="k-add-app-trust">
          <span aria-hidden>✓</span> It runs as yours, as it did before.
        </p>
      ) : (
        <label className="k-add-app-trust k-add-app-mine">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          <span>
            <strong>I wrote this. Run it as mine.</strong>
            <span className="k-muted">Directly, with everything this device lets apps do. Leave it off for an app from someone else: it then runs in the sealed box.</span>
          </span>
        </label>
      )}
    </section>
  );
}

/** After it was added: why it only works as yours, the button that does that, and what happens otherwise. */
function RunsAsYours({ done, sealed }: { done: Installed; sealed: SealedAfter }) {
  const parts = sealed.missing.length === 1 ? "it" : "them";
  return (
    <div className="k-add-app-sealed k-add-app-runs-as-yours" role="alert">
      {sealed.failsToOpen ? (
        <p>
          <span aria-hidden>⚠</span> <strong>It only works when it runs as yours.</strong> Only let it if you know who made it. Otherwise it stays sealed, and it will not open.
        </p>
      ) : (
        <p>
          <span aria-hidden>⚠</span> <strong>Parts of it only work when it runs as yours.</strong> Only let it if you know who made it. Otherwise it stays sealed, and the parts that use {parts} will not work.
        </p>
      )}
      <p className="k-muted">{sealed.problem ?? describeMissing(sealed.missing)}</p>
      <PromoteButton app={done.app} primary />
    </div>
  );
}
