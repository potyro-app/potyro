// A link to ONE record (docs/24 §12): what it carries, and what a page load keeps to finish the job.
//
//   <demo link>&app=<line>&to=<page>&p.<param>=<id>&rec=<payload>
//
// The demo link brings the app to someone who does not have it; `app=…&to=…` says where to land
// (app-link.ts); `rec=` carries the record's invite — its entity and id, its group and CoValue, and
// the secret that lets the holder in, as a writer or only to read. All of it in the fragment, which
// never reaches a server: the secret is between the two people, as a space invite's is.
import type { RecordInvite } from "@potyro/store";

export const RECORD_KEY = "rec";

/** What a record's link carries: the invite, the role it grants, and the app it belongs to. */
export interface RecordLinkPayload extends RecordInvite {
  role: "writer" | "reader";
  /** The app's declared id and name, for the words before anything opens. */
  appId?: string;
  name?: string;
}

const encode = (p: RecordLinkPayload): string => btoa(encodeURIComponent(JSON.stringify(p))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (raw: string): RecordLinkPayload | null => {
  try {
    const text = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const p = JSON.parse(decodeURIComponent(text)) as Partial<RecordLinkPayload>;
    if (!p || typeof p !== "object") return null;
    const strings = [p.entity, p.id, p.group, p.map, p.secret];
    if (!strings.every((s) => typeof s === "string" && s.length > 0 && s.length <= 512)) return null;
    return {
      entity: p.entity!,
      id: p.id!,
      group: p.group!,
      map: p.map!,
      secret: p.secret!,
      role: p.role === "reader" ? "reader" : "writer",
      ...(typeof p.appId === "string" ? { appId: p.appId.slice(0, 120) } : {}),
      ...(typeof p.name === "string" ? { name: p.name.slice(0, 120) } : {}),
    };
  } catch {
    return null;
  }
};

/** The record a link opens, if it is one. Nothing in it is believed past its shape; the secret is tried, not trusted. */
export function readRecordLink(hash: string): RecordLinkPayload | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  const raw = params.get(RECORD_KEY);
  return raw ? decode(raw) : null;
}

/** `link` with the record put on it (replacing any it had). */
export function withRecordLink(link: string, payload: RecordLinkPayload): string {
  const at = link.indexOf("#");
  const base = at < 0 ? link : link.slice(0, at);
  const kept = at < 0 ? [] : link.slice(at + 1).split("&").filter((part) => part && !part.startsWith(`${RECORD_KEY}=`));
  return `${base}#${[...kept, `${RECORD_KEY}=${encode(payload)}`].join("&")}`;
}

// ---- across a page load ----
//
// Joining a record happens where its store is open: inside the app being opened. A link read at
// boot, or a demo kept, holds the record here for THAT app, taken once, like an arrival (app-link.ts).

const JOIN_KEY = "potyro:record-join";

export function holdRecordJoin(appId: string, payload: RecordLinkPayload): void {
  try {
    sessionStorage.setItem(JOIN_KEY, JSON.stringify({ appId, payload }));
  } catch {
    // Nothing to hold it in: the app opens without the record, and the link can be opened again.
  }
}

export function takeRecordJoin(appId: string): RecordLinkPayload | null {
  try {
    const raw = sessionStorage.getItem(JOIN_KEY);
    if (!raw) return null;
    const held = JSON.parse(raw) as { appId?: string; payload?: RecordLinkPayload };
    if (held.appId !== appId) return null;
    sessionStorage.removeItem(JOIN_KEY);
    return held.payload ?? null;
  } catch {
    return null;
  }
}

/** What the app asked `ctx.ui.share` for, held across the page load that turning sync on costs. */
const SHARE_KEY = "potyro:record-share";

export interface HeldShare {
  text?: string;
  title?: string;
  record: { entity: string; id: string; role: "writer" | "reader"; page?: string; param?: string };
}

export function holdRecordShare(appId: string, share: HeldShare): void {
  try {
    sessionStorage.setItem(SHARE_KEY, JSON.stringify({ appId, share }));
  } catch {
    // The person taps Invite again after the reload; nothing is lost but a tap.
  }
}

export function takeRecordShare(appId: string): HeldShare | null {
  try {
    const raw = sessionStorage.getItem(SHARE_KEY);
    if (!raw) return null;
    const held = JSON.parse(raw) as { appId?: string; share?: HeldShare };
    if (held.appId !== appId) return null;
    sessionStorage.removeItem(SHARE_KEY);
    return held.share ?? null;
  } catch {
    return null;
  }
}
