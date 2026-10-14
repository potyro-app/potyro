// A shared app's space is full (#255). Its budget is what it may put on the relay, which keeps every
// byte ever written — so removing earlier copies, or files, would not make room, and the question says
// so rather than offer a way out that does nothing. What it does offer: keep the file on THIS device
// only, in a folder of its own beside the shared one (`device-files:<app>`, never synced). It stays in
// the app's Files here; the app's code and the people it is shared with do not see it.

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type { FileInfo } from "potyro";
import type { SpaceFullError, Store } from "@potyro/store";
import { formatSize } from "@potyro/views";
import { bringIn } from "./app-folder.js";
import { openStore } from "./open-store.js";
import { shellDialogs } from "./dialog.js";
import { FilesPanel } from "./files-panel.js";
import { shellCaps } from "./shell-caps.js";

/** The never-synced folder for a shared app's files kept on this device only. */
export const deviceFilesNamespace = (appId: string): string => `device-files:${appId}`;

async function withDeviceFiles<T>(appId: string, use: (store: Store) => Promise<T>): Promise<T> {
  const store = await openStore(deviceFilesNamespace(appId), { sync: false });
  try {
    return await use(store);
  } finally {
    await store.close();
  }
}

/** Keep files on this device only, beside the shared folder. */
export function keepOnDevice(appId: string, files: readonly File[]): Promise<FileInfo[]> {
  return withDeviceFiles(appId, (store) => bringIn(store, files));
}

/** Changed when files are kept on this device, so a Files tab showing them reads again. */
export const DEVICE_FILES_CHANGED = "potyro:device-files-changed";

/**
 * Say the space is full — how full, and that removing earlier copies would not help — and offer to
 * keep the files on this device only. True when they were kept.
 */
export async function offerDeviceOnly(err: SpaceFullError, files: readonly File[], appId: string, appName: string): Promise<boolean> {
  const used = formatSize(err.used);
  const budget = formatSize(err.budget);
  const needed = formatSize(err.needed);
  const ok = await shellDialogs.confirm(t`${appName}’s shared space is full`, {
    detail: t`${used} of ${budget} is used, and this needs ${needed} more. Removing files or earlier copies would not make room: the relay keeps every version ever shared. You can keep it on this device only — it stays in ${appName}’s Files here, but the app and the people you share it with will not see it.`,
    ok: t({ message: "Keep it on this device only", comment: "A shared app's space is full: keep the file outside it, on this device" }),
  });
  if (!ok) return false;
  await keepOnDevice(appId, files);
  window.dispatchEvent(new Event(DEVICE_FILES_CHANGED));
  return true;
}

/** A shared app's files kept on this device only, under its shared ones. Nothing when there are none. */
export function DeviceOnlyFiles({ appId, appName }: { appId: string; appName: string }) {
  const [store, setStore] = useState<Store | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((n) => n + 1);
    window.addEventListener(DEVICE_FILES_CHANGED, bump);
    return () => window.removeEventListener(DEVICE_FILES_CHANGED, bump);
  }, []);
  useEffect(() => {
    let live = true;
    let opened: Store | null = null;
    void openStore(deviceFilesNamespace(appId), { sync: false }).then((s) => {
      opened = s;
      if (live) setStore(s);
      else void s.close();
    });
    return () => {
      live = false;
      void opened?.close().catch(() => {});
    };
  }, [appId, version]);
  if (!store) return null;
  return (
    <div className="k-files-device">
      <FilesPanel
        key={version}
        store={store}
        appName={appName}
        scope="all"
        caps={shellCaps()}
        hideWhenEmpty
        heading={
          <>
            <h3>
              <Trans comment="Files tab of a shared app: files kept outside its shared space">Only on this device</Trans>
            </h3>
            <p>
              <Trans>Kept here because {appName}’s shared space was full. The app and the people you share it with do not see these.</Trans>
            </p>
          </>
        }
      />
    </div>
  );
}
