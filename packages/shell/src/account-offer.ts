// Which of your account's apps to offer this device, and when to stop asking.
//
// "Load your apps?" is an offer, and an offer that comes back every time you open Potyro is nagging.
// It came back for two reasons. An app you DELETED here stayed on the account, so the next boot found
// an app on your account that this device did not have, and offered it back. And "Not now" was not
// written down anywhere, so the same list was offered again on the next boot, and the next.
//
// So this device remembers two things, both keyed by app AND space (an app id is a name slug and can
// be reused by an unrelated app; the space is what makes it the same app):
//
// - what it LEFT: an app deleted here is never offered back here. Getting back into a shared app
//   takes a new invite, which is what the delete dialog says.
// - what it was OFFERED and did not take: asked once. Asked again only when an app it has not been
//   offered appears on the account — and then the new one is ticked and the old ones are not.

import type { AccountApp } from "@potyro/store";

const DECLINED = "potyro:account:declined";
const LEFT = "potyro:account:left";

/** One app on the account, as THIS app in THIS space. */
type Keyed = Pick<AccountApp, "id" | "root">;
const keyOf = (app: Keyed): string => `${app.id}\u0000${app.root}`;

function readSet(key: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

function addTo(key: string, keys: readonly string[]): void {
  if (keys.length === 0) return;
  try {
    const next = readSet(key);
    for (const k of keys) next.add(k);
    globalThis.localStorage?.setItem(key, JSON.stringify([...next]));
  } catch {
    /* storage refused: the worst case is being asked again */
  }
}

export interface AccountOffer {
  apps: AccountApp[];
  /** Ticked when the offer opens: the apps not offered here before. */
  ticked: ReadonlySet<string>;
}

/**
 * What to offer, or null when there is nothing to ask.
 *
 * `syncingHere` says whether this device already syncs an app of that id — those are not offered
 * (see main.tsx for why a seeded example of the same id still is).
 */
export function accountOffer(account: readonly AccountApp[], syncingHere: (id: string) => boolean): AccountOffer | null {
  const left = readSet(LEFT);
  const declined = readSet(DECLINED);
  const apps = account.filter((a) => !syncingHere(a.id) && !left.has(keyOf(a)));
  const fresh = apps.filter((a) => !declined.has(keyOf(a)));
  if (fresh.length === 0) return null;
  return { apps, ticked: new Set(fresh.map((a) => a.id)) };
}

/** The offer was answered: whatever was not loaded is not asked about again. */
export function recordDeclined(apps: readonly Keyed[]): void {
  addTo(DECLINED, apps.map(keyOf));
}

/** This device deleted (or left) the app in that space: never offer it back here. */
export function recordLeft(app: Keyed): void {
  addTo(LEFT, [keyOf(app)]);
}
