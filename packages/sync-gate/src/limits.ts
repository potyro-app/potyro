// What the gate holds each address, and the whole relay, to. Every number is the operator's to change
// (server.ts reads them from the environment); these are the defaults.

export const GATE_LIMITS = {
  /** Connections one address may hold at once (a classroom behind one address is many people). */
  connectionsPerAddress: 64,
  /** New connections a second from one address, and the burst on top. Refused past it (429). */
  connectsPerSecond: 10,
  connectBurst: 300,
  /** Bytes a second one address may send towards the relay, all its connections together, and the burst. Slowed past it. */
  bytesPerSecond: 1024 * 1024,
  byteBurst: 8 * 1024 * 1024,
  /** Frames a second one address may send, all its connections together, and the burst. Slowed past it. */
  framesPerSecond: 1000,
  frameBurst: 20_000,
  /**
   * Bytes one address may send towards the relay in a calendar day (UTC). Closed and refused past it.
   * A twentieth of `bytesPerDay`: what closes sync for everyone is twenty addresses at their limit,
   * not five (docs/16 "What the gate cannot do" says why this is a ratio and not a protection).
   */
  bytesPerAddressDay: 512 * 1024 * 1024,
  /** Bytes every /64 of one IPv6 /48 together may send in a day: twice one address's. */
  bytesPerNetDay: 1024 * 1024 * 1024,
  /** Bytes every address together may send in a calendar day (UTC): what the relay's disk can grow by. */
  bytesPerDay: 10 * 1024 * 1024 * 1024,
  /** The longest single message, all its frames together. Longer closes with 1009. */
  messageBytes: 8 * 1024 * 1024,
  /** Connections at once, from every address together. */
  connections: 5000,
  /** Addresses remembered at once: the limiter's own memory. */
  addresses: 100_000,
  /** No writes while the relay's disk has less than this free (only when the gate is told where it is). */
  minFreeBytes: 2 * 1024 * 1024 * 1024,
  /** How long the relay behind may take to answer a new connection. */
  dialMs: 10_000,
  /** A client that takes nothing for this long while data waits for it is cut. */
  stallMs: 60_000,
} as const;

export type GateLimits = { -readonly [K in keyof typeof GATE_LIMITS]: number };

/** Close codes the gate writes itself. 4000–4999 are its own; the rest are RFC 6455's. */
export const CLOSE = {
  /** The gate or the relay behind it is restarting. */
  goingAway: 1001,
  /** Not a websocket stream the gate passes on. */
  protocol: 1002,
  /** A message over `messageBytes`. */
  tooBig: 1009,
  /** This address sent `bytesPerAddressDay` today. */
  overToday: 4021,
  /** The whole relay took `bytesPerDay` today, or its disk is under `minFreeBytes`. */
  relayFull: 4022,
} as const;

export const CLOSE_REASON: Record<number, string> = {
  [CLOSE.goingAway]: "relay restarting",
  [CLOSE.protocol]: "not a websocket stream",
  [CLOSE.tooBig]: "message too big",
  [CLOSE.overToday]: "too much from this address today",
  [CLOSE.relayFull]: "sync is closed for now",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day (UTC) a time is in, as a number. */
export const dayOf = (now: number): number => Math.floor(now / DAY_MS);

/** Seconds until the next calendar day (UTC): what `Retry-After` says for a day's limit. */
export const secondsLeftToday = (now: number): number => Math.max(1, Math.ceil(((dayOf(now) + 1) * DAY_MS - now) / 1000));
