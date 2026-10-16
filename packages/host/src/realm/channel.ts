// One port the host answers ops on (realm-host.ts `answer`): the app's logic port, or a mounted view's
// (#267). Both go through the same op table, on a ctx `buildCtx` made; what differs is only which
// ctx a ctx id names, where a live connection's events go, and — for a view — the few `Runtime`
// calls a view has beyond ctx (`VIEW_OPS`).

import type { Ctx } from "potyro";
import type { SocketBridge } from "../socket-bridge.js";
import type { Op, ViewOp } from "./protocol.js";

export interface Channel {
  post(message: unknown): void;
  /** Still the port it was: an answer for a port that is gone is dropped. */
  alive(): boolean;
  /** The ctx a ctx id from this port names, if it names one. */
  ctx(ctxId: number): Ctx | undefined;
  /** Live connections opened from this port: their events go back on it. */
  sockets: SocketBridge;
  /** A ctx a connection was opened through stays nameable while it is open. */
  pinnedBy: Map<number, number>;
  /** Prefix of this port's progress ids in the host's table. */
  progress: string;
  /** A view's port only: the `Runtime` calls of `ViewProps.runtime` that are not ctx methods. */
  viewOp?(op: ViewOp, args: unknown[]): Promise<unknown>;
  /** What an answer becomes before it crosses (a view's file and picture URLs: their bytes). */
  adapt?(op: Op, value: unknown): Promise<unknown>;
}
