// The rooms relay's wire protocol (docs/26), browser-safe: no Node, no `ws`, no Potyro package.
//
// A room is `wss://<host>/rooms/<roomId>`. Every frame a member sends — text or binary — goes as-is
// to every OTHER member of the room. The relay never reads app data. The only frames it writes
// itself are the presence envelope below, and those are always text frames that begin with the
// exact bytes `{"potyro-rooms":` (SERVER_PREFIX). A member's own text frame that begins with those
// bytes is refused (CLOSE.reservedPrefix), so the prefix cannot be forged by a peer and
// `isServerEvent` is the whole test an app needs.

/** The envelope's version. A change to an event's shape bumps it; a new optional field does not. */
export const ROOMS_PROTOCOL = 1;

/** Every server frame starts with exactly these characters; no member frame may. */
export const SERVER_PREFIX = '{"potyro-rooms":';

/**
 * A room id: 22–64 characters of base64url. 22 is 128 random bits, the least an app should make
 * (`newRoomId`). Anyone holding the id can join: the share link IS the invitation.
 */
export const ROOM_ID = /^[A-Za-z0-9_-]{22,64}$/;

/** A display name from `?name=`: trimmed, control characters dropped, at most this many characters. */
export const NAME_MAX = 40;

/** The defaults the relay runs with (each can be changed by its operator; docs/16). */
export const ROOM_LIMITS = {
  /** Largest single message, text or binary, in bytes. Bigger closes with 1009. */
  messageBytes: 64 * 1024,
  /** Members at once in one room. The next one is closed with CLOSE.roomFull. */
  membersPerRoom: 16,
  /** Distinct rooms one address may be in at once. */
  roomsPerAddress: 8,
  /** Connections one address may hold at once (a classroom behind one NAT is many people). */
  connectionsPerAddress: 64,
  /** Sustained messages a second per connection, and the burst allowed on top. */
  messagesPerSecond: 30,
  messageBurst: 60,
  /** Sustained bytes a second per connection, and the burst allowed on top (≥ messageBytes). */
  bytesPerSecond: 64 * 1024,
  byteBurst: 256 * 1024,
  /** A room where nobody has sent anything for this long is closed (CLOSE.idle). */
  idleMs: 30 * 60_000,
  /** The relay pings every member this often; one that has not answered the last ping is dropped. */
  pingMs: 30_000,
  /** Bytes queued to one slow member before it is closed (CLOSE.tooSlow) instead of holding memory. */
  bufferedBytes: 1024 * 1024,
  /** The whole relay: rooms and connections at once. Past either, a newcomer is closed with 1013. */
  rooms: 2000,
  connections: 5000,
} as const;

export type RoomLimits = { -readonly [K in keyof typeof ROOM_LIMITS]: number };

/** Close codes the relay uses. 4000–4999 are the relay's own; the rest are RFC 6455's. */
export const CLOSE = {
  /** The relay is restarting. Reconnect after a moment. */
  goingAway: 1001,
  /** A message over `messageBytes` (sent by the `ws` library itself). */
  tooBig: 1009,
  /** The relay is at its limit of rooms or connections. Try again later. */
  busy: 1013,
  /** The path is not `/rooms/<roomId>` with a valid id. */
  badRoomId: 4001,
  /** The room already has `membersPerRoom` members. */
  roomFull: 4002,
  /** This address is already in `roomsPerAddress` rooms, or holds `connectionsPerAddress` connections. */
  tooManyRooms: 4003,
  /** Over the per-connection rate (`messagesPerSecond` / `bytesPerSecond` with their bursts). */
  tooFast: 4004,
  /** A text frame that begins with SERVER_PREFIX: only the relay may send those. */
  reservedPrefix: 4005,
  /** Too much queued for this member: it was not reading fast enough. */
  tooSlow: 4006,
  /** Nobody in the room sent anything for `idleMs`. */
  idle: 4007,
} as const;

/** The reason string sent with each close code (≤ 123 bytes, as the protocol requires). */
export const CLOSE_REASON: Record<number, string> = {
  [CLOSE.goingAway]: "relay restarting",
  [CLOSE.busy]: "relay busy, try again later",
  [CLOSE.badRoomId]: "bad room id",
  [CLOSE.roomFull]: "room full",
  [CLOSE.tooManyRooms]: "too many rooms from this address",
  [CLOSE.tooFast]: "too many messages",
  [CLOSE.reservedPrefix]: "reserved prefix",
  [CLOSE.tooSlow]: "not reading fast enough",
  [CLOSE.idle]: "room idle",
};

export interface Member {
  /** Random, per connection, made by the relay. Unforgeable within the envelope. */
  id: string;
  /** What the member passed as `?name=`, cleaned. Display only, self-chosen, not unique. */
  name: string;
}

/** The first frame every member gets: who it is, who else is here, and the limits in force. */
export interface WelcomeEvent {
  "potyro-rooms": typeof ROOMS_PROTOCOL;
  type: "welcome";
  room: string;
  you: Member;
  /** Everyone else in the room, oldest first. */
  members: Member[];
  limits: Pick<RoomLimits, "messageBytes" | "membersPerRoom" | "messagesPerSecond" | "bytesPerSecond" | "idleMs">;
}

export interface JoinEvent {
  "potyro-rooms": typeof ROOMS_PROTOCOL;
  type: "join";
  member: Member;
}

export interface LeaveEvent {
  "potyro-rooms": typeof ROOMS_PROTOCOL;
  type: "leave";
  member: Member;
}

export type ServerEvent = WelcomeEvent | JoinEvent | LeaveEvent;

/** True when a received frame was written by the relay, not by a peer. */
export function isServerEvent(data: unknown): data is string {
  return typeof data === "string" && data.startsWith(SERVER_PREFIX);
}

/** The relay's event in a frame, or null for a peer's message. */
export function readServerEvent(data: unknown): ServerEvent | null {
  if (!isServerEvent(data)) return null;
  try {
    return JSON.parse(data) as ServerEvent;
  } catch {
    return null;
  }
}

/** Cleans a `?name=`: control characters out, whitespace collapsed, at most NAME_MAX characters. */
export function cleanName(raw: string | null | undefined): string {
  if (!raw) return "";
  // eslint-disable-next-line no-control-regex
  // Whitespace first, so a line break between two words still leaves a space between them.
  const flat = raw
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return Array.from(flat).slice(0, NAME_MAX).join("");
}

/** A fresh room id: 128 random bits as 22 characters of base64url. */
export function newRoomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
