// Sharing a synced app with another person (minimal KA-17).
//
// The link carries the app SOURCE plus the space coordinates, because the guest almost certainly
// does not have the app yet — a link that only shared data would open to nothing.
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
  source: string;
  group: string;
  root: string;
  secret: string;
}

const encode = (p: InvitePayload): string => btoa(encodeURIComponent(JSON.stringify(p)));
const decode = (raw: string): InvitePayload => JSON.parse(decodeURIComponent(atob(raw))) as InvitePayload;

/** Build a `#join=…` link for a synced app. Throws if the app is not synced — there is no space yet. */
export async function createShareLink(appId: string): Promise<string> {
  const app = getUserApp(appId);
  if (!app) throw new Error("app not found");
  if (!app.sync) throw new Error("Turn sync on for this app first — sharing needs a space to invite into.");

  const handle = await openJazzStore(`user:${appId}`, { relay: syncRelayUrl() });
  const secret = createSpaceInvite(handle, "writer");
  const payload: InvitePayload = {
    appId,
    name: app.name,
    source: app.source,
    group: handle.groupID,
    root: handle.store.rootId,
    secret,
  };
  return `${location.origin}${location.pathname}#join=${encode(payload)}`;
}

/** The `#join=…` payload on this URL, if any. */
export function pendingInvite(): InvitePayload | null {
  const m = /[#&]join=([^&]+)/.exec(location.hash);
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
  const saved = await saveUserApp(
    {
      id: existing ? payload.appId : undefined,
      name: payload.name,
      source: payload.source,
      trusted: false, // arrived from someone else — runs in the isolate (rule 3)
      origin: "imported",
      note: "shared with you",
    },
    new Date().toISOString(),
  );

  await joinSpace(`user:${saved.id}`, payload, { relay: syncRelayUrl() });
  setUserAppSync(saved.id, true, new Date().toISOString());
  // Promotion stays an explicit, recorded act (CLAUDE.md rule 3) — it is just asked at a moment
  // where the user has the context to answer, instead of after a blank screen.
  if (trust) setUserAppTrusted(saved.id, true, new Date().toISOString());
  return saved.id;
}
