// The files an app shipped with (`levels.json`), checked when it opens.
//
// An app reads its shipped files with `ctx.files`; one that is not in its folder makes the app fail
// in its own words ("No file levels.json in this app"), which reads like the app's bug. It is not:
// the file did not land, or this device has never had it. So opening the app looks first, says so
// in plain words, and offers to put the files back from where the app came from when that is known.

import { t } from "@lingui/core/macro";
import { fileSpace, isReservedPath, type Store } from "@potyro/store";
import type { UserApp } from "./user-apps.js";

/** The files an app shipped with that are not in its folder on this device, by path. */
export async function missingShipped(store: Store, app: Pick<UserApp, "shipped">): Promise<string[]> {
  if (!app.shipped?.length) return [];
  const space = fileSpace(store);
  const absent: string[] = [];
  for (const path of app.shipped) if (!(await space.find(path))) absent.push(path);
  return absent;
}

/** What the screen says about them. */
export function describeMissingShipped(paths: readonly string[]): string {
  const list = paths.join(", ");
  return paths.length === 1
    ? t`The file it came with, ${list}, is not on this device, so it cannot run.`
    : t`The files it came with — ${list} — are not on this device, so it cannot run.`;
}

/**
 * Fetch the app's package from the link it was installed from and put its shipped files back. A file
 * the person changed since is kept, as on any update; nothing but files is touched — not its source,
 * not its records. Only for an app that came from a link: a file or pasted source was never kept.
 */
export async function reinstallShipped(app: Pick<UserApp, "id" | "link" | "shipped">, store: Store): Promise<string[]> {
  if (!app.link) throw new Error(t`It was not added from a link, so its files can only come back from its package: add it again, and choose “Replace it, keep its data”.`);
  const [{ gatherFromLink, applyShippedFiles }, { setUserAppShipped }] = await Promise.all([import("./add-app.js"), import("./user-apps.js")]);
  const pkg = await gatherFromLink(app.link);
  const files = pkg.files.filter((f) => !isReservedPath(f.path));
  await applyShippedFiles(store, files, { update: true });
  setUserAppShipped(app.id, files.map((f) => f.path));
  return missingShipped(store, { shipped: files.map((f) => f.path) });
}
