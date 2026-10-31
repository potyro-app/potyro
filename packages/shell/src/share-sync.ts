// Sharing a synced app with another person (minimal KA-17).
//
// The link carries only the SPACE COORDINATES — not the app source.
//
// It used to carry the source too, because the guest had no other way to get the app. Now the
// source syncs through the space (`app-sync.ts`), so the link can drop several KB of base64 and
// let the app arrive over sync like any later update. Two things fall out of that:
//
//   - **Deep links become viable.** A native build receives invites through Android App Links /
//     iOS Universal Links, and URL handling there gets unreliable past a few KB. A full app source
//     blew that budget; ~200 bytes does not.
//   - **Updates work from the moment of joining**, because the guest is reading the same published
//     source everyone else is, rather than a snapshot frozen at share time.
//
// The whole payload lives in the URL **fragment**, which browsers never send to a server. That is
// what keeps the invite secret off the relay: the relay stores ciphertext and must never see the
// key material that would decrypt it.
//
// Trust is unchanged by sharing (CLAUDE.md rule 3): an app that arrived from someone else is saved
// `trusted: false` and runs in the isolate. Being invited to someone's DATA says nothing about
// whether their CODE should run with ambient authority — those are two different axes.

import { t } from "@lingui/core/macro";
import { createSpaceInvite, joinSpace, openJazzStore } from "@potyro/store";
import { linkedDevice, syncRelayUrl } from "./open-store.js";
import { freeAppId, getUserApp, listUserApps, saveUserApp, setUserAppTrusted } from "./user-apps.js";
import { currentSite } from "./site.js";

interface InvitePayload {
  appId: string;
  name: string;
  group: string;
  root: string;
  secret: string;
  /**
   * Whether the app renders any screen with its own code.
   *
   * One boolean rather than the whole source: the trust prompt has to be accurate BEFORE joining
   * (an app whose screens are custom code shows nothing untrusted), and re-embedding the source
   * just to answer that question would undo the point of slimming the link.
   */
  custom?: boolean;
  /** Legacy links (which embedded the source) still open — they simply carry an extra field. */
  source?: string;
}

/** A joined app's name when the person already has one by that name: it says where it came from. */
const sharedName = (name: string): string => t({ message: `${name} (shared)`, comment: "The name of an app someone shared with you, when you already have one with that name" });

const encode = (p: InvitePayload): string => btoa(encodeURIComponent(JSON.stringify(p)));
const decode = (raw: string): InvitePayload => JSON.parse(decodeURIComponent(atob(raw))) as InvitePayload;

/** Build a `#join=…` link for a synced app. Throws if the app is not synced — there is no space yet. */
/** A link that invites someone into the app: `writer` can edit, `reader` can only view (#58). */
export async function createShareLink(appId: string, role: "writer" | "reader" = "writer"): Promise<string> {
  const app = getUserApp(appId);
  if (!app) throw new Error("app not found");
  if (!app.sync) throw new Error(t`Turn sync on for this app first — sharing needs a space to invite into.`);

  const { identityAccount, peekIdentity } = await import("@potyro/identity");
  // `identityAccount()` first, THEN the name: it is what mints the identity on a device that has
  // never had one, and `peekIdentity` answers null until it has. See `acceptInvite` for the bug this
  // ordering fixes.
  const account = await identityAccount();
  const handle = await openJazzStore(`user:${appId}`, {
    relay: syncRelayUrl(),
    account,
    profileName: peekIdentity()?.name,
    // The page's node may be opened here first; a linked device's account is on the relay.
    expectExisting: linkedDevice(),
  });

  // Publish before minting the link: the guest fetches the source from the space, so a link handed
  // out before anything was published would open an app with no code.
  // With its code beyond the source (#281): the lock and the app's own modules, so the guest's copy
  // can open — its libraries fetched there, once, with consent, and checked against this lock.
  const [{ publishAppSource }, { codeToCarry }] = await Promise.all([import("./app-sync.js"), import("./app-modules.js")]);
  await publishAppSource(handle.store, { ...(await codeToCarry(app, handle.store)), source: app.source, name: app.name, updatedAt: app.updatedAt });

  const secret = createSpaceInvite(handle, role);
  const payload: InvitePayload = {
    appId,
    name: app.name,
    group: handle.groupID,
    root: handle.store.rootId,
    secret,
    custom: usesCustomViews(app.source),
  };
  // On a phone the page is the phone (`capacitor://localhost`): the link is the site's (site.ts).
  const site = currentSite();
  const at = site?.configured ? `${site.origin}${site.path}` : `${location.origin}${location.pathname}`;
  return `${at}#join=${encode(payload)}`;
}

/**
 * The `#join=…` payload on a URL, if any.
 *
 * Defaults to the address bar (web) but takes an explicit URL because on a device the link arrives
 * as an OS event and never touches `location`.
 */
export function pendingInvite(url?: string): InvitePayload | null {
  const m = /[#&]join=([^&]+)/.exec(url ?? location.hash);
  if (!m) return null;
  try {
    return decode(m[1]!);
  } catch {
    return null;
  }
}

/** Does this app render any of its screens with its own code? Those need trust to display. */
export function usesCustomViews(source: string): boolean {
  return /type:\s*["']custom["']/.test(source);
}

/**
 * Accept an invite: save the app (untrusted — it came from someone else), join the space, and
 * return the local app id to open.
 *
 * `trust` is the answer to a prompt the CALLER shows before this runs. Deciding up front is the
 * point: an app whose screens are custom code opened untrusted shows nothing at all, so the old
 * flow dropped people into an empty app and asked them to find the trust control afterwards.
 * Asking first is better UX and a better consent moment — it is asked while the user is deciding
 * whether to accept a stranger's app, which is when the question actually means something.
 */
export async function acceptInvite(payload: InvitePayload, trust = false): Promise<string> {
  // Where this app is going to live on THIS device — decided before joining, because the space is
  // remembered under `user:<id>` and the decision cannot wait until the record is written.
  //
  // The collision is not hypothetical: every device that has ever opened the PWA owns the seeded
  // examples under their declared ids, so a shared "split" lands on top of the Split its recipient
  // already has, with their own records in it. That used to overwrite the record in place and flip
  // `sync` — which strands those records in the local database the app no longer opens, the one
  // thing `setUserAppSync` says must never be done on its own ("silently showing an empty app reads
  // as data loss").
  //
  // So: the same id only when nothing is there, or when what is there is already THIS space (the
  // same link opened twice must not breed a second copy). Otherwise the shared app arrives beside
  // the one you have, and yours is untouched.
  const { peekAppSpace } = await import("@potyro/store");
  const existing = listUserApps().find((a) => a.id === payload.appId);
  const here = existing ? peekAppSpace(`user:${payload.appId}`) : null;
  const rejoining = Boolean(here && here.group === payload.group && here.root === payload.root);
  const appId = !existing || rejoining ? payload.appId : freeAppId(payload.name || payload.appId);

  // Join first, then read the source out of the space. A legacy link carries it inline; a modern
  // one does not, so the space is the source of truth either way.
  // You join a space AS someone: the same device identity every other app uses, so the inviter sees
  // one person rather than a new stranger per app.
  const { identityAccount, peekIdentity } = await import("@potyro/identity");
  // Your NAME goes with you, not just your account.
  //
  // Joining is where a guest's account CoValue is first materialised, and without this it was
  // created with the default profile name — so to the person who invited you, you appeared as "Me"
  // until you happened to reload, which is when `openStore` publishes the real one. Everyone's first
  // sight of a new member was the wrong name, on the one path every invited user takes.
  //
  // `identityAccount()` is awaited first because it MINTS the identity on a device that has never
  // had one; `peekIdentity` answers null before that.
  const account = await identityAccount();
  const joined = await joinSpace(`user:${appId}`, payload, {
    relay: syncRelayUrl(),
    account,
    profileName: peekIdentity()?.name,
    // An invite accepted at boot can open the page's node before the account reader does; on a
    // linked device that opening must still ask the relay for the account before minting it.
    expectExisting: linkedDevice(),
  });
  const { readPublishedApp } = await import("./app-sync.js");
  const published = await readPublishedApp(joined.store);
  const source = published?.source ?? payload.source;
  if (!source) {
    throw new Error(t`This invite has no app in it yet. Ask the sender to open the app once, then share a fresh link.`);
  }

  // Its own modules, checked against the lock that came with them (#281). Its libraries are fetched
  // when it first opens, with consent — never their bytes through the space.
  const { receiveCode } = await import("./app-modules.js");
  await receiveCode(appId, published ?? {});

  const saved = await saveUserApp(
    {
      ...(published?.lock ? { lock: published.lock } : {}),
      // ALWAYS the shared app's id, never a slug of its name.
      //
      // The space was joined under `user:${payload.appId}`, and every later open goes through the
      // saved app's id — so letting `saveUserApp` derive one from the name pointed the guest at a
      // different, empty namespace whenever `slug(name) !== appId`. It looked like sync had failed:
      // the app opened, and none of the shared records were in it.
      //
      // Invisible for a long time because the fixtures were named so their slug matched their id
      // ("Sync Pair" -> `sync-pair`). "Share Flow" -> `share-flow` does not match `shareflow`, which
      // is what finally exposed it.
      id: appId,
      // Two apps called "Split" in one launcher is a puzzle every time it is opened. The one that
      // arrived says where it came from.
      name: appId === payload.appId ? (published?.name ?? payload.name) : sharedName(published?.name ?? payload.name),
      source,
      trusted: false, // arrived from someone else — runs in the isolate (rule 3)
      // Both written HERE rather than in a call afterwards: `saveUserApp` records a version, which
      // is a write to another database, and a second call lands behind it. An app that opened
      // before its `sync` flag arrived would open the empty local copy instead of the space it just
      // joined — and one that opened before `joined` arrived would seed the owner's space.
      sync: true,
      joined: true,
      origin: "imported",
      note: "shared with you",
    },
    new Date().toISOString(),
  );

  // Joining answered the sync question (KA-23): the join dialog says the data syncs with the people
  // sharing it, so the boot guard must not ask again and refuse to open the app they just joined.
  const { rememberSyncConsent } = await import("./sync-consent.js");
  rememberSyncConsent(saved.id, true);
  // Promotion stays an explicit, recorded act (CLAUDE.md rule 3) — it is just asked at a moment
  // where the user has the context to answer, instead of after a blank screen.
  if (trust) setUserAppTrusted(saved.id, true, new Date().toISOString());
  return saved.id;
}
