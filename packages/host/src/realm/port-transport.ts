// A `Transport` over the app's MessagePort, inside the realm: ops out, replies in.

import type { HostToRealm, Op } from "./protocol.js";

export interface Transport {
  call(ctxId: number, op: Op, args: unknown[]): Promise<unknown>;
  send(ctxId: number, op: Op, args: unknown[]): void;
}

export function portTransport(port: MessagePort): Transport & { onReply(msg: HostToRealm): boolean } {
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  return {
    call(ctxId: number, op: Op, args: unknown[]) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          port.postMessage({ t: "op", id, ctxId, op, args });
        } catch (e) {
          // A function, a DOM node, a class with private state: what cannot be copied does not cross.
          pending.delete(id);
          reject(new Error(`ctx.${op}: an argument cannot leave the app (${e instanceof Error ? e.message : String(e)})`));
        }
      });
    },
    send(ctxId: number, op: Op, args: unknown[]) {
      try {
        port.postMessage({ t: "op", id: 0, ctxId, op, args });
      } catch {
        // fire-and-forget: an argument that cannot be copied is simply not sent
      }
    },
    onReply(msg: HostToRealm): boolean {
      if (msg.t !== "reply") return false;
      const p = pending.get(msg.id);
      if (!p) return true;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error ?? "the host refused"));
      return true;
    },
  };
}
