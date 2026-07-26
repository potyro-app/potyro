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
}

function read(): UserApp[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as UserApp[]).filter((a) => a && a.id && a.source) : [];
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
export function saveUserApp(input: { id?: string; name: string; source: string }, now: string): UserApp {
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
  const record: UserApp = { id, name, source: input.source, updatedAt: now };
  write([record, ...apps.filter((a) => a.id !== id)]);
  return record;
}

export function removeUserApp(id: string): void {
  write(read().filter((a) => a.id !== id));
}

/** Rename a saved app in place (keeps its id, source, and data namespace). */
export function renameUserApp(id: string, name: string, now: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  write(read().map((a) => (a.id === id ? { ...a, name: trimmed, updatedAt: now } : a)));
}
