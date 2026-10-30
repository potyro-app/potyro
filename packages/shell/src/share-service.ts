// The share service, from the shell's side (docs/24 §2, §4): hosted demo links.
//
// The package is sealed on this device with a fresh key; the service gets the ciphertext and, beside
// it, what a link preview shows — the app's name, a line of description and a picture drawn from the
// demo records (preview-card.ts). The key goes in the link's fragment, which never reaches a server.
import { canSeal, openPackage, sealPackage, toBase64, type ShareCreated, type ShareMeta } from "@potyro/share-links";
import { siteBase } from "./demo-link.js";
import { currentSite } from "./site.js";

/** Where the service is: beside the site (`/share-api`), or where the build says. */
export function shareServiceUrl(): string {
  const configured = (import.meta.env.VITE_POTYRO_SHARE as string | undefined)?.replace(/\/+$/, "");
  const site = currentSite();
  return configured || (site ? `${site.origin}${site.path}share-api` : `${location.origin}${siteBase(location.pathname)}share-api`);
}

/** Whether the service answers here, within a moment. A static site without it answers with its page, or not at all. */
export async function shareServiceUp(timeoutMs = 2500): Promise<boolean> {
  if (!canSeal()) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${shareServiceUrl()}/health`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return false;
    return ((await res.json()) as { ok?: unknown }).ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const SHARES_KEY = "potyro:shares";

/** A link this device made, and the token that takes it down again. Kept here only. */
export interface MadeShare {
  id: string;
  appId: string;
  link: string;
  deleteToken: string;
  at: string;
}

export function madeShares(): MadeShare[] {
  try {
    const raw = globalThis.localStorage?.getItem(SHARES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as MadeShare[]) : [];
  } catch {
    return [];
  }
}

function remember(share: MadeShare): void {
  try {
    globalThis.localStorage?.setItem(SHARES_KEY, JSON.stringify([...madeShares(), share].slice(-200)));
  } catch {
    // the link still works; only taking it down later from here would not
  }
}

/** Put a demo package on the service and return the hosted link. */
export async function hostDemo(opts: { appId: string; zip: Uint8Array; meta: ShareMeta; image?: Uint8Array }): Promise<string> {
  const { key, sealed } = await sealPackage(opts.zip);
  const res = await fetch(`${shareServiceUrl()}/shares`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ meta: opts.meta, payload: toBase64(sealed), ...(opts.image ? { image: toBase64(opts.image) } : {}) }),
  });
  const out = (await res.json().catch(() => ({}))) as Partial<ShareCreated> & { error?: string };
  if (!res.ok || !out.id || !out.deleteToken) throw new Error(out.error ?? `the share service answered ${res.status}`);
  // The link is on the site the service serves pages for: this one, or — in a build that names the
  // service elsewhere (the Android app) — that one.
  const link = `${shareServiceUrl().replace(/share-api$/, "")}s/${out.id}#k=${key}`;
  remember({ id: out.id, appId: opts.appId, link: link.split("#")[0]!, deleteToken: out.deleteToken, at: new Date().toISOString() });
  return link;
}

/** The package behind a hosted link. Throws `GoneError` when the service no longer has it. */
export class GoneError extends Error {}
/** The operator took the link down (a 410, docs/16 "Taking a link down"), not its sharer. */
export class TakenDownError extends GoneError {}

export async function fetchHostedPackage(id: string, key: string): Promise<Uint8Array> {
  const res = await fetch(`${shareServiceUrl()}/shares/${encodeURIComponent(id)}/payload`, { cache: "no-cache" });
  if (res.status === 410) throw new TakenDownError(id);
  if (res.status === 404) throw new GoneError(id);
  if (!res.ok) throw new Error(`the share service answered ${res.status}`);
  return openPackage(new Uint8Array(await res.arrayBuffer()), key);
}

