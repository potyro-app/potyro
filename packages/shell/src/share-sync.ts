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

import { createSpaceInvite, joinSpace, openJazzStore } from "@karta/store";
import { syncRelayUrl } from "./open-store.js";
import { getUserApp, listUserApps, saveUserApp, setUserAppSync, setUserAppTrusted } from "./user-apps.js";

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

const encode = (p: InvitePayload): string => btoa(encodeURIComponent(JSON.stringify(p)));
const decode = (raw: string): InvitePayload => JSON.parse(decodeURIComponent(atob(raw))) as InvitePayload;

/** Build a `#join=…` link for a synced app. Throws if the app is not synced — there is no space yet. */
export async function createShareLink(appId: string): Promise<string> {
  const app = getUserApp(appId);
  if (!app) throw new Error("app not found");
  if (!app.sync) throw new Error("Turn sync on for this app first — sharing needs a space to invite into.");

  const handle = await openJazzStore(`user:${appId}`, { relay: syncRelayUrl() });

  // Publish before minting the link: the guest fetches the source from the space, so a link handed
  // out before anything was published would open an app with no code.
  const { publishAppSource } = await import("./app-sync.js");
  await publishAppSource(handle.store, { source: app.source, name: app.name, updatedAt: app.updatedAt });

  const secret = createSpaceInvite(handle, "writer");
  const payload: InvitePayload = {
    appId,
    name: app.name,
    group: handle.groupID,
    root: handle.store.rootId,
    secret,
    custom: usesCustomViews(app.source),
  };
  return `${location.origin}${location.pathname}#join=${encode(payload)}`;
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
  const existing = listUserApps().find((a) => a.id === payload.appId);

  // Join first, then read the source out of the space. A legacy link carries it inline; a modern
  // one does not, so the space is the source of truth either way.
  const joined = await joinSpace(`user:${payload.appId}`, payload, { relay: syncRelayUrl() });
  const { readPublishedApp } = await import("./app-sync.js");
  const published = await readPublishedApp(joined.store);
  const source = published?.source ?? payload.source;
  if (!source) {
    throw new Error(
      "This invite has no app in it yet. Ask the sender to open the app once, then share a fresh link.",
    );
  }

  const saved = await saveUserApp(
    {
      id: existing ? payload.appId : undefined,
      name: published?.name ?? payload.name,
      source,
      trusted: false, // arrived from someone else — runs in the isolate (rule 3)
      origin: "imported",
      note: "shared with you",
    },
    new Date().toISOString(),
  );

  setUserAppSync(saved.id, true, new Date().toISOString());
  // Promotion stays an explicit, recorded act (CLAUDE.md rule 3) — it is just asked at a moment
  // where the user has the context to answer, instead of after a blank screen.
  if (trust) setUserAppTrusted(saved.id, true, new Date().toISOString());
  return saved.id;
}
