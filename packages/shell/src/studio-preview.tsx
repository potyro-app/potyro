// The app as the Studio shows it — built from a source, and opened like an artifact (#261).
//
// Building and showing are separate on purpose. Every version is BUILT the moment it arrives, because
// that is how it is validated: a version that does not load, or whose structure is wrong, is not
// saved. It is SHOWN only when someone opens it — tapping its card, or Preview — because the
// conversation is the screen now, and an app pushed underneath it could not be seen as it will run.
//
// Opened, it is a screen of its own. On a phone it is the whole screen; on a wide one it stands
// beside the conversation. Either way the app's fixed bars, its full-screen pages and its dialogs
// belong to THAT screen: the frame is a containing block for anything fixed inside it, the app's
// form sheets are portalled into it (`PortalRootContext`), and it has its own dialog host. Before
// this, a form opened in the preview covered the Studio, and the app's dialogs opened over the chat.

import { themeClass, type Appearance } from "./app-theme.js";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState, useEffect, type ReactNode } from "react";
import { MemoryStore, type Store } from "@potyro/store";
import { createWebCapabilities } from "@potyro/capabilities";
import { capsForApp } from "./app-ai-caps.js";
import { PortalRootContext, Glyph } from "@potyro/views";
import type { Provenance } from "@potyro/host";
import { createAppBundler } from "./app-bundler.js";
import { createSandboxLoader } from "./isolate-bridge.js";
import { compose, type Composed } from "./compose.js";
import { loadTrustedModule } from "./trusted-loader.js";
import { storeModules } from "./app-modules.js";
import { withLibrariesStoodIn, type ModuleSource } from "./package-modules.js";
import { promotionFixes } from "./promotion.js";
import { TrustDialog } from "./trust-dialog.js";
import { getUserApp } from "./user-apps.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { timerHub } from "./timer-hub.js";
import { t as tl } from "@lingui/core/macro";
import { PickerHost } from "./picker.js";
import { UiHost } from "./ui-host.js";
import { openStore } from "./open-store.js";
import { validateDefinition } from "./validate-app.js";
import { DialogHost, Dialogs } from "./dialog.js";
import { Toaster } from "./toaster.js";
import { App } from "./App.js";
import { PointGlyph, PointMode } from "./point-mode.js";
import type { Pointed } from "./point-target.js";

export interface Preview {
  composed: Composed;
  toaster: Toaster;
  picker: PickerHost;
  questions: UiHost;
  /** The app's own dialogs, shown inside its screen — not the shell's, which cover everything. */
  dialogs: DialogHost;
  /** Which path actually ran — the isolate is taken only when the trusted load throws. */
  provenance: Provenance;
  /** Bumped per build, so a rebuilt app remounts rather than keeping the last one's state. */
  build: number;
  /**
   * The saved app runs SEALED (someone else's, not promoted): the preview runs it in the isolate too,
   * and offers to let it run as yours. When its libraries cannot start in the box, they stand in, so
   * the app can still be seen and checked — the note says so.
   */
  sealed?: { librariesStoodIn: boolean };
}

let builds = 0;

async function draftStore(): Promise<Store> {
  const store = new MemoryStore();
  await store.open("studio-draft");
  return store;
}

/**
 * Build an app from source and validate its structure.
 *
 * `storeNamespace` is a saved app's id, so the app opens on its own durable data; without one (a
 * conversation that has not made an app yet) it runs on an empty store that nothing keeps. A source
 * that does not load at all comes back as `{ preview: null, issues }`.
 */
export async function buildPreview(
  source: string,
  storeNamespace: string | null,
  /** A version's libraries before they are saved (a Studio save that fetched one, #266). */
  pending?: ModuleSource,
): Promise<{ preview: Preview | null; issues: string[] }> {
  try {
    const store = storeNamespace ? await openStore(`user:${storeNamespace}`) : await draftStore();
    const toaster = new Toaster();
    const picker = new PickerHost();
    const questions = new UiHost();
    const dialogs = new DialogHost();
    const base = {
      store,
      // A preview reads a receipt the way the app will (docs/23), under the app's own switch and spend.
      caps: capsForApp(createWebCapabilities(), storeNamespace ?? "studio-draft"),
      // A countdown tried in the preview is a real one, on its chip; the screen is not held for a
      // preview, which has no moment of being left to let it go.
      ui: createUiBridge(toaster.push, picker, dialogs, questions, undefined, {
        timers: timerHub.bridgeFor(`studio:${storeNamespace ?? "draft"}`, tl({ message: "Preview", comment: "A timer started from the Studio's preview of an app" })),
      }),
      nav: createNavBridge(() => {}),
    };
    // Its libraries and own modules (#266, #258), from the store the preview just opened.
    const modules = pending ?? (storeNamespace ? storeModules(store, getUserApp(storeNamespace)?.lock) : undefined);
    // A saved app that runs sealed is previewed sealed: it is someone else's code until the person
    // lets it run as theirs (CLAUDE.md rule 3), and opening it in the Studio is not saying so.
    if (storeNamespace && getUserApp(storeNamespace)?.trusted === false) {
      const bundle = await createAppBundler();
      const sealed = async (mods: ModuleSource | undefined): Promise<Composed> =>
        compose({ provenance: "untrusted", bundleCode: await bundle(source, mods), ...base, loadIsolated: await createSandboxLoader(store) });
      let composed: Composed;
      let librariesStoodIn = false;
      try {
        composed = await sealed(modules);
      } catch (e) {
        // A library that needs a full web page: the app is still seen, and checked, with it standing in.
        const stoodIn = withLibrariesStoodIn(modules);
        if (!promotionFixes(e) || stoodIn === modules) throw e;
        composed = await sealed(stoodIn);
        librariesStoodIn = true;
      }
      builds += 1;
      return {
        preview: { composed, toaster, picker, questions, dialogs, provenance: "untrusted", build: builds, sealed: { librariesStoodIn } },
        issues: validateDefinition(composed.runtime.definition),
      };
    }
    // TRUSTED: this is the person's own app (CLAUDE.md rule 3). It also has to run directly for the
    // preview to be truthful — custom views never render in the isolate.
    let composed: Composed;
    let provenance: Provenance = "trusted";
    try {
      composed = await compose({ provenance: "trusted", app: await loadTrustedModule(source, modules), ...base });
    } catch {
      // A malformed app cannot produce a definition — the isolate still reports what is wrong with it.
      provenance = "untrusted";
      const bundle = await createAppBundler();
      composed = await compose({ provenance: "untrusted", bundleCode: await bundle(source, modules), ...base, loadIsolated: await createSandboxLoader(store) });
    }
    builds += 1;
    return {
      preview: { composed, toaster, picker, questions, dialogs, provenance, build: builds },
      issues: validateDefinition(composed.runtime.definition),
    };
  } catch (e) {
    return { preview: null, issues: [e instanceof Error ? e.message : String(e)] };
  }
}

export interface PreviewScreenProps {
  preview: Preview;
  /** The name and version on the bar, so it is never unclear which app this is. */
  title: string;
  version?: number;
  /** Shown instead of the version when this is not saved — a version with problems, held back. */
  unsaved?: boolean;
  onBack: () => void;
  onSource: () => void;
  /** A sealed app's preview: let it run as yours. Only after the same dialog as everywhere else. */
  onPromote?: () => void;
  /** Point mode (#284): the app is pointed at instead of used, until a part is picked or it is cancelled. */
  pointing: boolean;
  onPoint: () => void;
  onPointCancel: () => void;
  onPicked: (pointed: Pointed) => void;
  /** On a phone the Studio's two tabs (Conversation, App) stand where the way back was. */
  tabs?: ReactNode;
  /** The quick adjustments above the app (DESIGN.md §10): its name, its colour. */
  above?: ReactNode;
  /** The colour chosen for the app here, as the launcher's tile would carry it. */
  appAccent?: string;
  /** The app's own theme (#423): the frame wears it, the Studio around keeps the platform's. */
  appearance?: Appearance;
}

/** The opened app: a bar with the way back, and the app's own screen under it. */
export function PreviewScreen({ preview, title, version, unsaved, onBack, onSource, onPromote, pointing, onPoint, onPointCancel, onPicked, tabs, above, appAccent, appearance }: PreviewScreenProps) {
  const { t } = useLingui();
  const screenRef = useRef<HTMLDivElement>(null);
  // The portal root is the screen element itself, which exists only after the first render.
  const [screen, setScreen] = useState<HTMLDivElement | null>(null);
  useEffect(() => setScreen(screenRef.current), []);
  const [asking, setAsking] = useState(false);
  const def = preview.composed.runtime.definition;
  const promote = preview.sealed && onPromote ? onPromote : undefined;
  return (
    <section className="k-preview" aria-label={t`App preview`} data-pointing={pointing || undefined}>
      {pointing ? (
        // The bar says what the mode is and how to leave it — never the app's own controls.
        <header className="k-preview-bar k-point-bar" role="status">
          <span className="k-point-bar-mark" aria-hidden>
            <PointGlyph />
          </span>
          <p className="k-point-bar-text">
            <strong>
              <Trans>Point at the app</Trans>
            </strong>
            <span>
              <Trans>Tap the part you mean</Trans>
            </span>
          </p>
          <button type="button" className="k-point-cancel" onClick={onPointCancel}>
            <Trans>Cancel</Trans>
          </button>
        </header>
      ) : (
        <header className="k-preview-bar">
          {tabs ?? (
          <button type="button" className="k-preview-back" aria-label={t`Back to the chat`} onClick={onBack}>
            {/* Beside the conversation the chat is already there, so this closes the app instead. */}
            <span aria-hidden><Glyph icon="arrow-left" size={16} /></span> <span className="k-preview-back-word">
              <Trans comment="Preview bar: back to the Studio conversation">Chat</Trans>
            </span>
            <span className="k-preview-hide-word">
              <Trans>Close</Trans>
            </span>
          </button>
          )}
          <p className="k-preview-title">
            <strong>{title}</strong>
            {unsaved ? <span className="k-preview-unsaved">
                <Trans>not saved</Trans>
              </span> : version ? <span className="k-preview-seq">v{version}</span> : null}
          </p>
          {promote ? (
            <button type="button" className="k-preview-code k-preview-promote" title={t`It runs in the sealed box`} onClick={() => setAsking(true)}>
              <Trans>Let it run as yours</Trans>
            </button>
          ) : null}
          <button type="button" className="k-preview-point" title={t`Tap a part of the app to talk about it`} onClick={onPoint}>
            <PointGlyph />
            <span className="k-preview-point-word">
              <Trans comment="Preview bar button: point at a part of the app to talk about it">Point</Trans>
            </span>
          </button>
          <button type="button" className="k-preview-code" onClick={onSource}>
            <Trans comment="Preview bar button: see the app's source code">Code</Trans>
          </button>
        </header>
      )}
      {preview.sealed?.librariesStoodIn ? (
        <p className="k-preview-note" role="note">
          <Trans>It runs in the sealed box, and its libraries need a full web page, so here they stand in and draw nothing. Let it run as yours to see them work.</Trans>
        </p>
      ) : null}
      {asking && promote ? (
        <TrustDialog
          name={def.name}
          permissions={def.permissions ?? {}}
          onCancel={() => setAsking(false)}
          onPromote={() => {
            setAsking(false);
            promote();
          }}
        />
      ) : null}
      {/* The screen does not scroll; the app scrolls INSIDE it. Anything fixed in the app is placed
          against the screen, so a tab bar or a floating button stays put while the app scrolls —
          were the screen itself the scroller, they would scroll away with the content. */}
      {above ? <div className="k-preview-adjust-row">{above}</div> : null}
      {/* On a wide screen the app sits in a phone's frame (DESIGN.md §10): it is shared by link and
          mostly opened on one. The chrome measures its own width, so it lays out as a phone's. */}
      <div className="k-preview-frame">
      {/* The phone's screen wears the app's own theme (#423); the stage around it stays the platform's. */}
      <div className={`k-preview-screen${themeClass(appearance ?? "system") ? ` ${themeClass(appearance ?? "system")}` : ""}`} ref={screenRef}>
        {screen ? (
          <PortalRootContext.Provider value={screen}>
            {/* `k-studio-preview` kept from the old stage: what a spec or a person points at is the app. */}
            <div className="k-preview-scroll k-studio-preview">
              <App
                key={preview.build}
                runtime={preview.composed.runtime}
                provenance={preview.provenance}
                toaster={preview.toaster}
                picker={preview.picker}
                questions={preview.questions}
                onPromote={promote}
                appAccent={appAccent}
                themeScope="frame"
              />
            </div>
            <Dialogs host={preview.dialogs} />
            {pointing ? <PointMode screen={screen} def={def} onPick={onPicked} onCancel={onPointCancel} /> : null}
          </PortalRootContext.Provider>
        ) : null}
      </div>
      </div>
    </section>
  );
}
