// "My Apps" registry — the apps a user has generated, edited, or imported, persisted locally so they
// survive reloads and can be re-opened and used (not just previewed once). This is the local library
// behind the Studio; a shared/community registry (KA-10) is a separate, later layer.
//
// Storage: a single localStorage key holding a JSON array. The app *source* lives here; each app's
// *data* lives in its own durable store namespaced `user:<id>` (see open-store.ts). Immutable ops.

const KEY = "karta:user-apps";

export interface UserApp {
  id: string;
  name: string;
  source: string;
  updatedAt: string; // ISO
  /** Runs directly (trusted) rather than in the isolate. Apps authored in the Studio are the user's
   *  own, so this defaults to TRUE; an app that arrived from someone else is saved with
   *  `trusted: false` and must be promoted explicitly. */
  trusted?: boolean;
}

function read(): UserApp[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Records written before trust defaulted to true have `trusted: undefined`. They are all
    // Studio-authored (nothing else writes here yet), so read them as the user's own rather than
    // stranding them in the isolate — where their custom views would render blank.
    return (parsed as UserApp[])
      .filter((a) => a && a.id && a.source)
      .map((a) => (a.trusted === undefined ? { ...a, trusted: true } : a));
  } catch {
    return [];
  }
}

function write(apps: UserApp[]): void {
  globalThis.localStorage?.setItem(KEY, JSON.stringify(apps));
}

function slug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return base || "app";
}

/** All saved apps, most-recently-updated first. */
export function listUserApps(): UserApp[] {
  return read().slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function getUserApp(id: string): UserApp | undefined {
  return read().find((a) => a.id === id);
}

/** Create or update a saved app. A new app gets a unique id derived from its name; passing an
 *  existing `id` updates that app in place. Returns the stored record. */
export function saveUserApp(
  input: { id?: string; name: string; source: string; trusted?: boolean },
  now: string,
): UserApp {
  const apps = read();
  const name = input.name.trim() || "Untitled app";
  let id = input.id;
  if (!id) {
    const base = slug(name);
    id = base;
    let n = 2;
    const taken = new Set(apps.map((a) => a.id));
    while (taken.has(id)) id = `${base}-${n++}`;
  }
  // An app authored here is the USER'S OWN, so it is trusted by default (CLAUDE.md rule 3:
  // provenance decides execution; trusted = user's own → direct). The isolate exists for code that
  // arrived from someone else — an importer passes `trusted: false` explicitly. Editing your own app
  // does NOT demote it; you are still the author.
  const prev = apps.find((a) => a.id === id);
  const trusted = input.trusted ?? prev?.trusted ?? true;
  const record: UserApp = { id, name, source: input.source, updatedAt: now, trusted };
  write([record, ...apps.filter((a) => a.id !== id)]);
  return record;
}

export function removeUserApp(id: string): void {
  write(read().filter((a) => a.id !== id));
}

/** Promote/demote a saved app's trust. Trusted apps run directly (not in the isolate). */
export function setUserAppTrusted(id: string, trusted: boolean, now: string): void {
  write(read().map((a) => (a.id === id ? { ...a, trusted, updatedAt: now } : a)));
}

/** Rename a saved app in place (keeps its id, source, and data namespace). */
export function renameUserApp(id: string, name: string, now: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  write(read().map((a) => (a.id === id ? { ...a, name: trimmed, updatedAt: now } : a)));
}
