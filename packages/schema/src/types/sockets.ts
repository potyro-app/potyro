// Live connections (docs/28): `ctx.caps.network.socket(url)` — a WebSocket to a server — and
// `ctx.caps.network.room(id)` — a room on Potyro's own rooms relay (docs/26), where every member
// hears what the others send. The same API for your own apps and for shared (sealed) ones; a shared
// app may reach only the hosts its `permissions.network` names, after the person agrees once.
//
// Outside the model's core reference (#341): read through `lookup("ctx.caps.network.socket")`, and
// beside a request that asks for something live.

/**
 * Why `socket()` or `room()` did not connect: the `code` of the Error it rejects with, for the app to
 * word. `"offline"` — the device has no connection; `"denied"` — the person said Not now (asked again
 * next time); `"refused"` — the server answered no, or closed at once (browsers do not say more);
 * `"unreachable"` — no answer in time; `"not-allowed-host"` — a shared app asked for a host its
 * `permissions.network.hosts` does not name (refused without asking anyone); `"insecure"` — `ws://`
 * where only `wss://` can work (the web, except a local address); `"too-many"` — this app already
 * has 4 connections open; `"hidden"` — Potyro is in the background, where nothing opens (try again:
 * the first try after the person comes back opens).
 */
export type SocketFailure = "offline" | "denied" | "refused" | "unreachable" | "not-allowed-host" | "insecure" | "too-many" | "hidden";

/**
 * Why a `send` was refused: the `code` of its Error. `"closed"` — the connection is not open;
 * `"too-big"` — one message over the limit (1 MiB; a room's is 64 KiB); `"full"` — more than 1 MiB is
 * still waiting to go out: slow down and send again later.
 */
export type SocketSendFailure = "closed" | "too-big" | "full";

/**
 * Why a connection ended. `"app"` — the app closed it; `"server"` — the server closed it (`code`,
 * `reason` say why); `"network"` — the connection dropped; `"left"` — the person left the app;
 * `"hidden"` — Potyro was in the background for a while (30 s); `"too-big"` — the server sent one
 * message over 1 MiB; `"slow"` — messages piled up faster than the app took them; `"stopped"` — the
 * shared app's box was stopped. Potyro never reconnects by itself: open a new one when it makes sense.
 */
export type SocketCloseWhy = "app" | "server" | "network" | "left" | "hidden" | "too-big" | "slow" | "stopped";

export interface SocketClose {
  /** The WebSocket close code: 1000 normal, 1006 dropped without a close frame, 4000–4999 the server's own. */
  code: number;
  reason: string;
  why: SocketCloseWhy;
}

/** A message: text arrives as a string, binary as bytes. */
export type SocketData = string | Uint8Array;

/** `socket(url, opts)`: the WebSocket subprotocols to offer, in order of preference. */
export interface SocketOptions {
  protocols?: string | string[];
}

/**
 * An open connection. `socket()` resolves only once it is open, so it starts `"open"`. Messages that
 * arrive before `onMessage` is called are held and handed to the first callback, never lost. Inside a
 * callback `ctx` still works (`ctx.create`, `ctx.patch`…), but `ctx.now()` is the time of the call
 * that opened it: use `new Date()` for the time a message came.
 */
export interface Socket {
  readonly url: string;
  /** The subprotocol the server chose, or "". */
  readonly protocol: string;
  readonly readyState: "open" | "closing" | "closed";
  /** Resolves once the message is on its way; rejects with a `code` (SocketSendFailure). */
  send(data: SocketData): Promise<void>;
  /** Every message, in order. Returns the unsubscribe. */
  onMessage(cb: (data: SocketData) => void): () => void;
  /** Once, when it ends, however it ends (called at once if it already has). Returns the unsubscribe. */
  onClose(cb: (close: SocketClose) => void): () => void;
  /** Close it (code 1000 unless given). `onClose` hears `why: "app"`. */
  close(code?: number, reason?: string): void;
}

/** Someone in a room: `id` is new on every connection and made by the relay; `name` is what they chose. */
export interface RoomMember {
  id: string;
  name: string;
}

/** Someone came in or went. */
export interface RoomPresence {
  type: "join" | "leave";
  member: RoomMember;
}

/** `room(id, opts)`: the name the others see (display only, at most 40 characters; none by default). */
export interface RoomOptions {
  name?: string;
}

/**
 * A room on Potyro's rooms relay (docs/26). Anyone who has the room's `id` can join, so the id is the
 * invitation: put it in a share link (`ctx.ui.share`). `onMessage` hears the OTHER members' messages
 * exactly as they sent them (never your own); who sent one is not said — put your `me.id` in it if
 * that matters. At most 16 members, 64 KiB a message, about 30 messages a second each.
 */
export interface Room extends Socket {
  /** The room's id: 22–64 characters of A–Z a–z 0–9 _ -. `room()` without one makes a new one. */
  readonly id: string;
  /** You in this room, as the others see you. */
  readonly me: RoomMember;
  /** Everyone else here now, oldest first (the first is a natural host for a game); kept current. */
  readonly members: readonly RoomMember[];
  /** Someone joined or left. Returns the unsubscribe. */
  onPresence(cb: (event: RoomPresence) => void): () => void;
}
