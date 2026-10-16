// The files a bundled example ships with (`examples/files/<id>/…`): its sample records' photos and
// its backdrops — what a package carries in its `files/`, for the apps that come with Potyro.
//
// An example is seeded as source alone (examples.ts), so its files reach its folder here, the first
// time its store opens: written as `shipped`, listed on the app as `shipped`, exactly as a package's
// are. From then on everything that reads an app's files treats them alike — `ctx.files`, a page's
// background, the demo link (which carries `shipped` files by path, docs/24 §2), the remix.
//
// A file that cannot be fetched (the first open was offline) is left out, never an error: the app
// opens without that picture, and the next open tries again.

import { fileSpace, type Store } from "@potyro/store";
import { getUserApp, setUserAppShipped, type UserApp } from "./user-apps.js";

/** Each bundled file's URL, loaded only when one is needed. Never evaluated. */
const FILES = import.meta.glob("../../../examples/files/*/**/*.{webp,jpg,png,svg,json}", { query: "?url", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

const PREFIX = "../../../examples/files/";

/** The paths, in the app's own folder, that example `appId` ships with: `photos/pancakes.webp`. */
export function exampleFilePaths(appId: string): string[] {
  const own = `${PREFIX}${appId}/`;
  return Object.keys(FILES)
    .filter((k) => k.startsWith(own))
    .map((k) => k.slice(own.length))
    .sort();
}

const MIME: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml", json: "application/json" };

/** A bundled file's bytes, or null when it cannot be fetched (offline on a first open). */
export async function exampleFile(appId: string, path: string): Promise<Blob | null> {
  const load = FILES[`${PREFIX}${appId}/${path}`];
  if (!load) return null;
  try {
    const res = await fetch(await load());
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    return new Blob([bytes], { type: MIME[path.split(".").pop() ?? ""] ?? "application/octet-stream" });
  } catch {
    return null;
  }
}

/**
 * Put example `app`'s files in its folder, and list them as what it shipped with.
 *
 * Only files that are not there yet are written: a shipped file the person replaced is theirs (it is
 * then `imported`, add-app.ts), and one already there is not fetched again. Never for a space this
 * device joined — the owner's device ships them, and they arrive with the space.
 */
export async function ensureExampleFiles(store: Store, app: Pick<UserApp, "id" | "joined" | "shipped">): Promise<void> {
  if (app.joined) return;
  const paths = exampleFilePaths(app.id);
  if (!paths.length) return;
  const space = fileSpace(store);
  const here: string[] = [];
  for (const path of paths) {
    if (await space.find(path)) {
      here.push(path);
      continue;
    }
    const blob = await exampleFile(app.id, path);
    if (!blob) continue;
    await space.write(path, blob, { origin: "shipped", mime: blob.type });
    here.push(path);
  }
  // Listed: what is here now, and whatever else it shipped that is not ours. A bundled file that
  // could not be fetched is left off, so the open is not refused for a missing picture.
  const ours = new Set(paths);
  const listed = getUserApp(app.id)?.shipped ?? app.shipped ?? [];
  const next = [...new Set([...listed.filter((p) => !ours.has(p)), ...here])].sort();
  if (next.join("\n") !== [...listed].sort().join("\n")) setUserAppShipped(app.id, next);
}
