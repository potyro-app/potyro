// The relay that files platform requests as GitHub issues (#263, #288).
//
// People who use Potyro have no GitHub account, so the Studio cannot open an issue itself; this
// small service does, with a token that never leaves the server. It is the only thing between
// anyone on the internet and the repository's issue list, so it is deliberately narrow:
//
//   - one route, `POST /platform-requests`, taking exactly the payload `readPayload` accepts;
//   - a size cap checked before parsing, and per-part caps after (request.ts);
//   - a rate limit per device AND per address — a fresh device id per request does not get past it;
//   - duplicates grouped: a request whose normalized title matches an open `platform-request` issue
//     becomes a comment on it instead of a new issue, so many people asking for one thing is one
//     issue with a crowd on it;
//   - a retry of the same request (same id) is answered with what it got the first time.
//
// The relay keeps its index and its limits in memory. A restart forgets them: the index is read
// again from GitHub on the next request, and the limits start afresh — acceptable for a service
// behind the same gate as the site (docs/16).
//
// Pure apart from `IssueTracker`: the HTTP server (server.ts) and the GitHub client (github.ts) are
// thin, and everything here is tested with a fake tracker.

import { LIMITS, issueBody, normalizeTitle, readPayload } from "./request.ts";

export interface Issue {
  number: number;
  title: string;
  url: string;
}

/** What the relay needs from GitHub. */
export interface IssueTracker {
  /** The open issues with the label. */
  listOpen(label: string): Promise<Issue[]>;
  create(issue: { title: string; body: string; labels: string[] }): Promise<Issue>;
  comment(number: number, body: string): Promise<void>;
}

export interface Limits {
  /** Requests a device may send in a window. */
  perDevice: number;
  /** Requests one address may send in a window, whatever device ids it uses. */
  perAddress: number;
  windowMs: number;
}

export const DEFAULT_LIMITS: Limits = { perDevice: 5, perAddress: 20, windowMs: 24 * 60 * 60 * 1000 };
export const LABEL = "platform-request";
/** How long the index of open issues is trusted before it is read again. */
const INDEX_TTL_MS = 10 * 60 * 1000;
/** Request ids remembered, for retries. */
const REMEMBERED = 5000;

export interface RelayDeps {
  issues: IssueTracker;
  now: () => number;
  limits?: Limits;
  label?: string;
  /** Called with what went wrong talking to GitHub — the server logs it; the client only hears 502. */
  onError?: (e: unknown) => void;
}

export interface RelayRequest {
  method: string;
  path: string;
  body: string;
  /** The sender's address, as the proxy in front reports it. */
  ip: string;
}

export interface RelayResponse {
  status: number;
  body: Record<string, unknown>;
}

/** A sliding count per key: how many in the last `windowMs`. */
function limiter(windowMs: number, now: () => number) {
  const seen = new Map<string, number[]>();
  return {
    allows(key: string, max: number): boolean {
      const since = now() - windowMs;
      const times = (seen.get(key) ?? []).filter((t) => t > since);
      seen.set(key, times);
      return times.length < max;
    },
    note(key: string): void {
      seen.set(key, [...(seen.get(key) ?? []), now()]);
    },
  };
}

export function createRelay(deps: RelayDeps): { handle: (req: RelayRequest) => Promise<RelayResponse> } {
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const label = deps.label ?? LABEL;
  const rate = limiter(limits.windowMs, deps.now);
  const answered = new Map<string, RelayResponse>();
  let index: { at: number; byKey: Map<string, Issue> } | null = null;

  const openIssues = async (): Promise<Map<string, Issue>> => {
    if (!index || deps.now() - index.at > INDEX_TTL_MS) {
      const byKey = new Map<string, Issue>();
      for (const issue of await deps.issues.listOpen(label)) byKey.set(normalizeTitle(issue.title), issue);
      index = { at: deps.now(), byKey };
    }
    return index.byKey;
  };

  const remember = (id: string, res: RelayResponse): RelayResponse => {
    if (answered.size >= REMEMBERED) answered.delete(answered.keys().next().value as string);
    answered.set(id, res);
    return res;
  };

  const file = async (raw: string, ip: string): Promise<RelayResponse> => {
    if (Buffer.byteLength(raw, "utf8") > LIMITS.bytes) return { status: 413, body: { ok: false, error: "too big" } };
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { status: 400, body: { ok: false, error: "not JSON" } };
    }
    const read = readPayload(json);
    if (!read.ok) return { status: 400, body: { ok: false, error: read.error } };
    const p = read.payload;
    const before = answered.get(p.id);
    if (before) return before;
    const device = `device:${p.device}`;
    const address = `address:${ip}`;
    if (!rate.allows(device, limits.perDevice) || !rate.allows(address, limits.perAddress)) {
      return { status: 429, body: { ok: false, error: "too many requests — try again tomorrow" } };
    }
    try {
      const open = await openIssues();
      const key = normalizeTitle(p.title);
      const same = key ? open.get(key) : undefined;
      rate.note(device);
      rate.note(address);
      if (same) {
        await deps.issues.comment(same.number, issueBody(p, { again: true }));
        return remember(p.id, { status: 201, body: { ok: true, grouped: true, issue: same.number, url: same.url } });
      }
      const made = await deps.issues.create({ title: p.title, body: issueBody(p), labels: [label] });
      if (key) open.set(key, made);
      return remember(p.id, { status: 201, body: { ok: true, grouped: false, issue: made.number, url: made.url } });
    } catch (e) {
      deps.onError?.(e);
      return { status: 502, body: { ok: false, error: "could not reach GitHub" } };
    }
  };

  return {
    handle: async (req) => {
      if (req.path === "/health") return req.method === "GET" ? { status: 200, body: { ok: true } } : { status: 405, body: { ok: false } };
      if (req.path !== "/platform-requests") return { status: 404, body: { ok: false, error: "not found" } };
      if (req.method !== "POST") return { status: 405, body: { ok: false, error: "POST only" } };
      return file(req.body, req.ip);
    },
  };
}
