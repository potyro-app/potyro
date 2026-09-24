// Data sources for Ask (#213): where outside data comes from, and the keys that open it.
//
// Two kinds, one shape. An APP's source is declared in its definition (`sources`, never with a key);
// the person supplies the key. A PERSON's source is one they added themselves: a name, a key, and an
// endpoint or a link to the API's documentation. Karta ships none.
//
// THE KEY RULES — each one has a test in test/ask-sources.test.ts:
//
//   Where a key lives   In the device's secret vault (@karta/identity: the platform keystore on
//                       Android, a non-extractable AES key on the web). With no vault, in memory for
//                       this page only. NEVER localStorage: unlike the identity, a source key has no
//                       plain-storage fallback, because losing it costs a re-paste, not an account.
//   Where it goes       Only where this module sends it. An app's source: URLs under its declared
//                       endpoint. The person's own: origins they allowed.
//   Asked first         Every source, keyed or not, the app's or the person's: the first request to a
//                       host asks the person ("Send your Maps key to maps.example.com?", "Let Ask read
//                       from overpass-api.de?"), and a yes is remembered for that source. A shared app
//                       cannot make Ask call its own server behind the person's back.
//   Who sees it         Nobody else. The model is told a source's id, label, endpoint and docs link
//                       (`AskSource`); app code is never involved. A key echoed back by an API is
//                       scrubbed before the response reaches the model.
//   How it is sent      GET, no cookies, no referrer, and a redirect is an error rather than a hop to
//                       wherever the server points.
//
// The settings of a person's source (name, endpoint, docs, allowed origins) are not secret and sit in
// localStorage on this device. Nothing here syncs or exports.
//
// The honest limit on the web, same as the identity's (vault.ts): code running on Karta's own origin
// can still ask the vault to decrypt. What this removes is a key lying around in the clear.

import type { AppDefinition, SourceDef } from "karta";
import type { SecretVault } from "@karta/identity";
import type { AskSource, SourceFetch, SourceRequest } from "@karta/generator/agent";

export type SourceAuth = NonNullable<SourceDef["auth"]>;

/** A source the person added. Holds no key; the key is in the vault under `keyIdOf`. */
export interface PersonSource {
  id: string;
  label: string;
  description?: string;
  endpoint?: string;
  docs?: string;
  auth?: SourceAuth;
  /** Origins the person allowed requests (and so their key) to go to. */
  origins: string[];
}

// ── the person's sources ────────────────────────────────────────────────────

const MINE = "karta:ask-sources";

export function listMySources(): PersonSource[] {
  try {
    const raw = globalThis.localStorage?.getItem(MINE);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as PersonSource[]).filter((s) => s && typeof s.id === "string") : [];
  } catch {
    return [];
  }
}

function writeMine(list: PersonSource[]): void {
  try {
    globalThis.localStorage?.setItem(MINE, JSON.stringify(list));
  } catch {
    // Storage refused: the source lasts as long as this page.
  }
}

export function saveMySource(source: PersonSource): void {
  writeMine([...listMySources().filter((s) => s.id !== source.id), source]);
}

export function removeMySource(id: string): void {
  writeMine(listMySources().filter((s) => s.id !== id));
}

/** Hosts the person allowed for an app's declared sources, per app, on this device. */
const APP_OK = (appId: string): string => `karta:ask-source-ok:${appId}`;

function appApprovals(appId: string): Record<string, string[]> {
  try {
    const raw = globalThis.localStorage?.getItem(APP_OK(appId));
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export function approveAppSource(appId: string, name: string, origin: string): void {
  const all = appApprovals(appId);
  const list = Array.isArray(all[name]) ? all[name]! : [];
  if (list.includes(origin)) return;
  try {
    globalThis.localStorage?.setItem(APP_OK(appId), JSON.stringify({ ...all, [name]: [...list, origin] }));
  } catch {
    // Not remembered: the person is asked again next time, which is the safe side.
  }
}

export function allowOrigin(id: string, origin: string): void {
  const src = listMySources().find((s) => s.id === id);
  if (src && !src.origins.includes(origin)) saveMySource({ ...src, origins: [...src.origins, origin] });
}

// ── keys ────────────────────────────────────────────────────────────────────

export type KeyPlace = "vault" | "session";

export interface KeyStore {
  get(id: string): Promise<string | null>;
  /** Where it went: the vault, or this page's memory when there is no vault. */
  set(id: string, key: string): Promise<KeyPlace>;
  remove(id: string): Promise<void>;
  /** Where a key set now would go. */
  place(): Promise<KeyPlace>;
}

/** Keys in `vault`, or in memory when there is none. Never in plain storage. */
export function keyStore(vault: SecretVault | undefined): KeyStore {
  const session = new Map<string, string>();
  const usable = async (): Promise<boolean> => {
    try {
      return Boolean(vault && (await vault.available()));
    } catch {
      return false;
    }
  };
  return {
    async get(id) {
      if (session.has(id)) return session.get(id)!;
      return (await usable()) ? ((await vault!.get(id)) ?? null) : null;
    },
    async set(id, key) {
      if (await usable()) {
        try {
          await vault!.set(id, key);
          session.delete(id);
          return "vault";
        } catch {
          // fall through: memory, never plain storage
        }
      }
      session.set(id, key);
      return "session";
    },
    async remove(id) {
      session.delete(id);
      if (await usable()) await vault!.remove(id);
    },
    place: async () => ((await usable()) ? "vault" : "session"),
  };
}

// ── resolution: what Ask may use right now ──────────────────────────────────

export interface ResolvedSource {
  /** What the model is told. */
  ask: AskSource;
  keyId: string;
  auth?: SourceAuth;
  endpoint?: string;
  docs?: string;
  /** "endpoint": requests must stay under `endpoint` (an app's source). "origins": the person allows each origin. */
  pin: "endpoint" | "origins";
  origins: string[];
}

export const appKeyId = (appId: string, name: string): string => `karta:source-key:app:${appId}:${name}`;
export const myKeyId = (id: string): string => `karta:source-key:mine:${id}`;

/** An app's and the person's sources, split into those Ask can use and those waiting for a key. */
export async function resolveSources(
  def: AppDefinition,
  appId: string,
  mine: PersonSource[],
  keys: KeyStore,
): Promise<{ usable: ResolvedSource[]; needKey: ResolvedSource[] }> {
  const approved = appApprovals(appId);
  const all: ResolvedSource[] = [
    ...Object.entries(def.sources ?? {}).map(([name, s]): ResolvedSource => ({
      ask: { id: `app:${name}`, label: s.label ?? name, description: s.description, endpoint: s.endpoint, docs: s.docs },
      keyId: appKeyId(appId, name),
      auth: s.auth,
      endpoint: s.endpoint,
      docs: s.docs,
      pin: "endpoint",
      origins: Array.isArray(approved[name]) ? approved[name]! : [],
    })),
    ...mine.map((s): ResolvedSource => ({
      ask: { id: `mine:${s.id}`, label: s.label, description: s.description, endpoint: s.endpoint, docs: s.docs },
      keyId: myKeyId(s.id),
      auth: s.auth,
      endpoint: s.endpoint,
      docs: s.docs,
      pin: "origins",
      origins: s.origins,
    })),
  ];
  const usable: ResolvedSource[] = [];
  const needKey: ResolvedSource[] = [];
  for (const s of all) {
    if (s.auth && !(await keys.get(s.keyId))) needKey.push(s);
    else usable.push(s);
  }
  return { usable, needKey };
}

// ── fetching ────────────────────────────────────────────────────────────────

/** Enough for a page of results; a model does not need a whole API dump. */
const MAX_CHARS = 12_000;
const TIMEOUT_MS = 20_000;

/** Readable text from HTML documentation: scripts, styles and tags out, whitespace folded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function under(url: URL, endpoint: string): boolean {
  const base = new URL(endpoint);
  const path = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return url.origin === base.origin && (url.pathname === base.pathname || url.pathname.startsWith(path));
}

export interface SourceFetcherDeps {
  sources: ResolvedSource[];
  keys: KeyStore;
  fetch: typeof fetch;
  /** Ask the person: may requests for this source go to `origin`? `sendsKey`: this one carries their key. */
  confirmOrigin: (source: ResolvedSource, origin: string, sendsKey: boolean) => Promise<boolean>;
  /** A yes, to remember for next time. */
  onAllowed: (sourceId: string, origin: string) => void;
  /** Each URL actually requested, before any key is added to it — for the person to see. */
  onFetched?: (sourceId: string, url: string) => void;
}

/** The key as a response might echo it: as sent, URL-encoded, or base64. */
function keyForms(key: string): string[] {
  const forms = new Set([key, encodeURIComponent(key), encodeURIComponent(key).replace(/%20/g, "+")]);
  try {
    forms.add(btoa(key));
  } catch {
    // not Latin-1: no base64 form to look for
  }
  return [...forms].filter((f) => f.length >= 4);
}

/** The host's `SourceFetch` for Ask: every rule in the file header, and never a thrown error. */
export function makeSourceFetcher(deps: SourceFetcherDeps): SourceFetch {
  const allowed = new Map(deps.sources.map((s) => [s.ask.id, new Set(s.origins)]));

  const target = async (src: ResolvedSource, req: SourceRequest): Promise<URL | string> => {
    let url: URL;
    if (req.kind === "docs") {
      if (!src.docs) return `${src.ask.label} has no documentation link.`;
      url = new URL(src.docs);
    } else {
      try {
        url = src.endpoint ? new URL(req.url, src.endpoint) : new URL(req.url);
      } catch {
        return `"${req.url}" is not a URL${src.endpoint ? "" : " (this source has no endpoint, so give a full https URL)"}.`;
      }
      if (src.pin === "endpoint" && (!src.endpoint || !under(url, src.endpoint))) return `${src.ask.label} only answers under ${src.endpoint}.`;
    }
    if (url.protocol !== "https:") return "Only https URLs.";
    const origins = allowed.get(src.ask.id)!;
    if (!origins.has(url.origin)) {
      const yes = await deps.confirmOrigin(src, url.origin, req.kind === "data" && Boolean(src.auth));
      if (!yes) return `The person did not allow requests to ${url.origin} for ${src.ask.label}.`;
      origins.add(url.origin);
      deps.onAllowed(src.ask.id, url.origin);
    }
    return url;
  };

  return async (req) => {
    const src = deps.sources.find((s) => s.ask.id === req.source);
    if (!src) return { ok: false, detail: `No source "${req.source}".` };
    const url = await target(src, req);
    if (typeof url === "string") return { ok: false, detail: url };
    deps.onFetched?.(src.ask.id, url.toString());

    const headers = new Headers({ Accept: req.kind === "docs" ? "text/html, text/plain, */*" : "application/json, text/*;q=0.9, */*;q=0.5" });
    const key = req.kind === "data" && src.auth ? await deps.keys.get(src.keyId) : null;
    if (req.kind === "data" && src.auth && !key) return { ok: false, detail: `${src.ask.label} needs a key, and none is saved.` };
    if (key && src.auth && "header" in src.auth) headers.set(src.auth.header, `${src.auth.prefix ?? ""}${key}`);
    if (key && src.auth && "query" in src.auth) url.searchParams.set(src.auth.query, key);

    const forms = key ? keyForms(key) : [];
    const scrub = (text: string): string => forms.reduce((t, f) => t.split(f).join("[key]"), text);
    try {
      const res = await deps.fetch(url.toString(), {
        method: "GET",
        headers,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const type = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      const text = type.includes("html") ? htmlToText(raw) : raw;
      const body = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(cut at ${MAX_CHARS} characters)` : text;
      return { ok: res.ok, detail: scrub(`HTTP ${res.status}\n${body}`) };
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      // In a browser a refused cross-origin request looks exactly like this; say what it probably is.
      const hint = /failed to fetch|networkerror|load failed/i.test(why) ? " (the API may not accept requests from a browser, or the device is offline)" : "";
      return { ok: false, detail: scrub(`Request failed: ${why}${hint}.`) };
    }
  };
}
