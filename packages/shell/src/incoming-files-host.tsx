// Files arriving from outside, on screen (#254): the drop target that covers Potyro's window, and the
// two questions that follow — Add an app, for an app; "Add to which app?", for anything else.
//
// Mounted once around every route (main.tsx `mount`), like the dialogs. A Files panel that is on
// screen takes a drop on itself first (files-panel.tsx stops it here): dropping onto an app's own
// Files tab means that app, so nothing is asked.

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatSize, Glyph } from "@potyro/views";
import { AddAppDialog } from "./add-app-dialog.js";
import { fitsFor, isAppArrival, landFiles, offerFiles, onOffer, takeOffer } from "./incoming-files.js";
import { useInstalledApps, type InstalledApp } from "./launcher-store.js";
import { tileIdentity } from "./tile-identity.js";
import { TileGlyph } from "./tile-glyph.js";
import { openAppStore, syncAllowedFor } from "./app-store.js";
import { navigateTo } from "./router.js";
import { totalSize } from "./app-folder.js";
import { confirmLargeForSharing } from "./files-panel.js";
import { offerDeviceOnly } from "./device-files.js";
import { SpaceFullError } from "@potyro/store";

type Arrival = { kind: "app"; files: File[] } | { kind: "files"; files: File[] };

const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** The app on screen, if any: files dropped inside an app most likely belong to it. */
function currentAppId(): string | null {
  return new URLSearchParams(location.search).get("user");
}

export function IncomingFiles() {
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [dragging, setDragging] = useState(false);
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What arrives is sorted once, then asked about.
  useEffect(() => {
    const handle = (): void => {
      const files = takeOffer();
      if (!files) return;
      void isAppArrival(files)
        .catch(() => false)
        .then((app) => setArrival({ kind: app ? "app" : "files", files }));
    };
    handle(); // an offer made before this mounted (a share on a cold start)
    return onOffer(handle);
  }, []);

  // The window as a drop target. `dragover` keeps arriving while files are held over it; when it
  // stops — they left the window, or a Files panel took them — the cover goes.
  useEffect(() => {
    const settle = (): void => {
      if (quiet.current) clearTimeout(quiet.current);
      quiet.current = setTimeout(() => setDragging(false), 160);
    };
    const over = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragging(true);
      settle();
    };
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      offerFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", over);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", over);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      if (quiet.current) clearTimeout(quiet.current);
    };
  }, []);

  return (
    <>
      {dragging ? <DropCover /> : null}
      {arrival?.kind === "app" ? <AddAppDialog initialFiles={arrival.files} onClose={() => setArrival(null)} /> : null}
      {arrival?.kind === "files" ? <ChooseApp files={arrival.files} onClose={() => setArrival(null)} /> : null}
    </>
  );
}

function DropCover() {
  return (
    <div className="k-dropcover" aria-hidden>
      <div className="k-dropcover-card">
        <span className="k-dropcover-mark" aria-hidden><Glyph icon="download" size={48} /></span>
        <strong>
          <Trans>Drop to add to Potyro</Trans>
        </strong>
        <span>
          <Trans>An app is added to your apps. Any other file goes into the app you choose.</Trans>
        </span>
      </div>
    </div>
  );
}

/** "Add to which app?" — the share page's question, for files. */
function ChooseApp({ files, onClose }: { files: File[]; onClose: () => void }) {
  const { t } = useLingui();
  const installed = useInstalledApps();
  const [fits, setFits] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const here = currentAppId();

  useEffect(() => {
    let live = true;
    void fitsFor(
      files,
      installed.map((a) => ({ id: a.id, source: a.user.source })),
    ).then((f) => live && setFits(f));
    return () => {
      live = false;
    };
    // The installed list is rebuilt on every registry write; the apps' ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, installed.map((a) => a.id).join()]);

  const apps = useMemo(() => {
    const rank = (a: InstalledApp): number => (a.id === here ? 0 : fits.includes(a.id) ? 1 : 2);
    return [...installed].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [installed, fits, here]);

  const choose = async (app: InstalledApp): Promise<void> => {
    if (!(await confirmLargeForSharing(files, app.name, app.sync === true))) return;
    setBusy(app.id);
    setFailed(null);
    try {
      const store = await openAppStore(app.user, { sync: await syncAllowedFor(app.user) });
      try {
        await landFiles(store, app.id, files);
      } catch (e) {
        // The app's shared space is full (#255): what fitted landed; offer to keep the rest here.
        if (!(e instanceof SpaceFullError)) throw e;
        const rest = (e as SpaceFullError & { rest?: File[] }).rest ?? files;
        await offerDeviceOnly(e, rest, app.id, app.name);
      } finally {
        await store.close?.();
      }
      onClose();
      navigateTo({ kind: "data", id: app.id, files: true });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const count = files.length;
  const heading = plural(count, { one: "Add this file to", other: "Add these # files to" });
  return (
    <div className="k-modal-scrim" onClick={busy ? undefined : onClose}>
      <section
        className="k-modal k-incoming"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <p className="k-ask-eyebrow">
          <Trans comment="Over the question of which app some files go into">From outside Potyro</Trans>
        </p>
        <h2 className="k-incoming-title">{heading}</h2>
        <ul className="k-incoming-files" aria-label={t`Files`}>
          {files.slice(0, 4).map((f, i) => (
            <li key={`${f.name}:${i}`}>
              <span className="k-incoming-file-name">{f.name}</span>
              <span className="k-incoming-file-size">{formatSize(f.size)}</span>
            </li>
          ))}
          {count > 4 ? (
            <li className="k-incoming-more">
              {plural(count - 4, { one: "and # more", other: "and # more" })} · {formatSize(totalSize(files))}
            </li>
          ) : null}
        </ul>
        {failed ? (
          <p className="k-files-error" role="alert">
            {failed}
          </p>
        ) : null}
        <ul className="k-share-apps" aria-label={t`Your apps`}>
          {apps.map((app) => {
            const identity = tileIdentity({ key: app.key, name: app.name, icon: app.icon, image: app.image, accent: app.accent, hue: app.entry.hue });
            const badge = app.id === here ? t({ message: "This app", comment: "Badge: the app you were in when files arrived" }) : fits.includes(app.id) ? t({ message: "Takes these files", comment: "Badge: an app with a file field for this kind of file" }) : null;
            return (
              <li key={app.key}>
                <button
                  type="button"
                  className="k-share-app"
                  data-best={badge ? true : undefined}
                  disabled={busy !== null}
                  style={{ "--tile-accent": identity.accent } as CSSProperties}
                  onClick={() => void choose(app)}
                >
                  <span className="k-launch-avatar" data-kind={identity.kind} aria-hidden>
                    <TileGlyph identity={identity} size={24} />
                  </span>
                  <span className="k-share-app-name">{app.name}</span>
                  {busy === app.id ? (
                    <span className="k-muted">
                      <Trans>Adding</Trans>
                    </span>
                  ) : badge ? (
                    <span className="k-ask-badge" data-tone="good">
                      {badge}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="k-ask-off" disabled={busy !== null} onClick={onClose}>
          {plural(count, { one: "Don’t add it", other: "Don’t add them" })}
        </button>
      </section>
    </div>
  );
}
