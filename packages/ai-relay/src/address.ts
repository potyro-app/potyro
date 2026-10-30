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

/**
 * What the per-address limits count under. An IPv4 address is itself. An IPv6 address is its /64:
 * one home or phone is usually handed a whole /64, so the full address would give one sender
 * 2^64 fresh "addresses" for nothing. An IPv4 address written as IPv6 (`::ffff:1.2.3.4`) is the
 * IPv4 address. Anything that is not an address (`unknown`) is kept as it is.
 *
 * Used by every route's per-address limit (relay.ts, chat.ts, counts.ts), so they cannot disagree.
 */
export function addressKey(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return raw;
  const groups = ipv6Groups(raw);
  if (!groups) return raw;
  // ::ffff:a.b.c.d — an IPv4 client on a dual-stack socket.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(s: string): number[] | null {
  const text = s.split("%")[0]!; // a zone ("fe80::1%eth0") is not part of the address
  if (!text.includes(":")) return null;
  const parts = text.split("::");
  if (parts.length > 2) return null;
  const side = (half: string): number[] | null => {
    if (half === "") return [];
    const out: number[] = [];
    const pieces = half.split(":");
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]!;
      if (i === pieces.length - 1 && p.includes(".")) {
        const quad = p.split(".");
        if (quad.length !== 4 || !quad.every((q) => /^\d{1,3}$/.test(q) && Number(q) < 256)) return null;
        const [a, b, c, d] = quad.map(Number) as [number, number, number, number];
        out.push((a << 8) | b, (c << 8) | d);
      } else if (/^[0-9a-f]{1,4}$/.test(p)) out.push(parseInt(p, 16));
      else return null;
    }
    return out;
  };
  const head = side(parts[0]!);
  const tail = parts.length === 2 ? side(parts[1]!) : [];
  if (!head || !tail) return null;
  if (parts.length === 1) return head.length === 8 ? head : null;
  const gap = 8 - head.length - tail.length;
  if (gap < 1) return null;
  return [...head, ...new Array<number>(gap).fill(0), ...tail];
}
