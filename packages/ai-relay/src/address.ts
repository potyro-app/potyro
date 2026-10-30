// Whose request this is, for the per-address limits — and which proxy is believed about it.
//
// The relay listens on loopback and is reached only through the proxy in front of it, so the socket's
// own peer is always that proxy. The client's address has to come from a header the proxy writes, and
// only from the part of it the proxy wrote: anything else in the header is whatever the client sent.
//
// `caddy` (production, potyro.app). Caddy's `reverse_proxy` "sets or augments" X-Forwarded-For, and
// "by default, the proxy will ignore their values from incoming requests, to prevent spoofing"
// (caddyserver.com/docs/caddyfile/directives/reverse_proxy, Headers → Defaults, read 2026-10-30).
// With no `trusted_proxies` configured, which is the case here, the header the relay receives is
// therefore exactly one entry: the peer Caddy saw. If `trusted_proxies` is ever set (a CDN in front),
// Caddy appends the peer to what the trusted hop sent, so the peer Caddy saw is still the LAST entry.
// The last entry is right in both cases; an entry a client forged is never last.
//
// `none`: no proxy is believed. The socket's peer is the address: for a relay reached directly.

export type TrustProxy = "caddy" | "none";

export const TRUST_PROXIES: readonly TrustProxy[] = ["caddy", "none"];

/** `TRUST_PROXY` from the environment; unset is `caddy`, anything unknown stops the relay starting. */
export function readTrustProxy(raw: string | undefined): TrustProxy {
  if (raw === undefined || raw === "") return "caddy";
  if ((TRUST_PROXIES as readonly string[]).includes(raw)) return raw as TrustProxy;
  throw new Error(`TRUST_PROXY must be one of ${TRUST_PROXIES.join(", ")}, got "${raw}"`);
}

/** The client's address as the trusted proxy reports it, or the socket's peer. */
export function clientAddress(forwardedFor: string | string[] | undefined, peer: string | undefined, trust: TrustProxy): string {
  if (trust === "caddy") {
    // Two X-Forwarded-For headers are joined, as one list, in the order they came.
    const list = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : (forwardedFor ?? "")).split(",");
    const last = list[list.length - 1]!.trim();
    if (last) return last;
  }
  return peer || "unknown";
}
