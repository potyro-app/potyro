// The place a plan token will be checked (#11, item 5). Nothing is checked today: sync is free, and
// every connection is let through. What is fixed now is WHERE a token travels and where it is looked
// at, so the gate for a plan is a function handed to the gate, not a new protocol.
//
// A token travels in `Sec-WebSocket-Protocol`, the one request header a browser lets a page set on a
// websocket. Never in the address: a query string ends up in proxy logs, in history and in whatever
// a person pastes. A client that has a token offers two subprotocols:
//
//   new WebSocket(url, ["potyro.sync.v1", "potyro.token.<token>"])
//
// The gate answers with `potyro.sync.v1` (a browser that offered subprotocols drops the connection
// when the server picks none) and never repeats the token: not in the answer, not to the relay
// behind it, not in a log.

/** The subprotocol the gate picks when a client offers it. */
export const SYNC_PROTOCOL = "potyro.sync.v1";

/** A subprotocol that begins with this carries a token: base64url, at most 512 characters. */
export const TOKEN_PREFIX = "potyro.token.";

const TOKEN = /^[A-Za-z0-9_-]{1,512}$/;

export interface Offer {
  /** The gate will answer with {@link SYNC_PROTOCOL}: the client offered it. */
  named: boolean;
  /** The token the client offered, or null: none, or one that is not a token. */
  token: string | null;
}

/** What a client offered in `Sec-WebSocket-Protocol`. */
export function readOffer(header: string | string[] | undefined): Offer {
  const offered = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const carried = offered.find((p) => p.startsWith(TOKEN_PREFIX))?.slice(TOKEN_PREFIX.length);
  return { named: offered.includes(SYNC_PROTOCOL), token: carried !== undefined && TOKEN.test(carried) ? carried : null };
}

/**
 * Whether a connection may go on to the relay. Asked once per connection, after the per-address
 * limits (a refused address never costs a token check) and before the relay is dialled.
 */
export type TokenGate = (ask: { token: string | null; address: string }) => boolean | Promise<boolean>;

/** Today's gate: everyone is let through, with a token or without. */
export const openGate: TokenGate = () => true;
