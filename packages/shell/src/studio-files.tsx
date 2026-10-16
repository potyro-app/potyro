// The Studio's Files tab (#254): what an app ships with.
//
// A package is the app's source plus the files that go wherever it goes (#253): a plan to start from,
// a list of levels, a sound. Here they are added, replaced and removed, as `shipped` files in the
// app's own folder — so the preview reads them through `ctx.files` exactly as an installed copy will
// — and "Save as a package" writes the zip that Add an app installs. What the person added and what
// the app wrote stay out of it: those are someone's data, not part of the app.

import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { declareApp, type Store } from "@potyro/store";
import { FilesPanel } from "./files-panel.js";
import { shippedPackage } from "./app-folder.js";
import { openAppStore, syncAllowedFor } from "./app-store.js";
import { appCode, modulesOf } from "./app-modules.js";
import { getUserApp } from "./user-apps.js";
import { shellCaps } from "./shell-caps.js";

export interface StudioFilesProps {
  app: { id: string; name: string };
  /** The app as the preview loaded it, so the package can say what it is without being run (#271). */
  definition?: unknown;
}

/** `piano.potyro-app.zip`, as `pnpm pack:app` names one. */
export const packageName = (id: string): string => `${id}.potyro-app.zip`;

export function StudioFiles({ app, definition }: StudioFilesProps) {
  const { t } = useLingui();
  const [store, setStore] = useState<Store | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [packing, setPacking] = useState(false);
  const [packed, setPacked] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let opened: Store | null = null;
    void (async () => {
      const saved = getUserApp(app.id);
      if (!saved) throw new Error(t`This app is not saved yet`);
      opened = await openAppStore(saved, { sync: await syncAllowedFor(saved) });
      if (live) setStore(opened);
      else await opened.close?.();
    })().catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      void opened?.close?.().catch(() => {});
    };
  }, [app.id, t]);

  const savePackage = async (): Promise<void> => {
    const saved = getUserApp(app.id);
    if (!store || !saved) return;
    setPacking(true);
    setFailed(null);
    setPacked(null);
    try {
      let declared;
      try {
        declared = definition ? declareApp(definition) : undefined;
      } catch {
        declared = undefined; // the card will read the app itself
      }
      const code = await appCode((await modulesOf(saved.id)) ?? store, saved.lock);
      const zip = await shippedPackage(store, { source: saved.source, lock: saved.lock, code, declared, line: saved.line });
      const name = packageName(saved.id);
      await shellCaps().filesystem.save(name, new Blob([zip as BlobPart], { type: "application/zip" }));
      setPacked(name);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setPacking(false);
    }
  };

  const name = app.name;
  return (
    <div className="k-tools-body k-studio-files">
      <p className="k-studio-files-lede">
        <Trans>Files here go wherever {name} goes. Everyone who adds the app gets a copy, and the app reads them as its own.</Trans>
      </p>
      {failed ? (
        <p className="k-files-error" role="alert">
          {failed}
        </p>
      ) : null}
      {packed ? (
        <p className="k-studio-files-done" role="status">
          <Trans>Saved {packed}. Send it to someone, and they add it with “Add an app”.</Trans>
        </p>
      ) : null}
      {store ? (
        <FilesPanel
          store={store}
          appName={name}
          scope="shipped"
          shared={getUserApp(app.id)?.sync === true}
          caps={shellCaps()}
          extra={
            <button type="button" className="k-add" disabled={packing} onClick={() => void savePackage()} title={t`The app and the files it comes with, as one file`}>
              <span aria-hidden>⤓</span> {packing ? t`Packing…` : t({ message: "Save as a package", comment: "Studio Files tab: save the app and its files as one zip" })}
            </button>
          }
        />
      ) : !failed ? (
        <p className="k-muted">{t`Opening ${name}…`}</p>
      ) : null}
    </div>
  );
}
