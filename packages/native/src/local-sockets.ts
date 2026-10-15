// ws:// to the local network in the Android app (docs/28 §6), over Potyro's own `PotyroLocalSocket`
// plugin (android-templates/LocalSocketPlugin.java, installed by scripts/patch-android.mjs).
//
// The WebView is https://localhost and refuses ws:// from it (mixed content), so a Home Assistant on
// 192.168.1.20 could not be reached. The shell's `SocketCap` sends exactly those addresses — ws://,
// spelled as a local address — here (capabilities' `createWebSockets({ local })`); everything else
// stays the WebView's own WebSocket. The plugin checks again, on what the name resolves to.

import { SocketOpenError, type LocalOpener, type PlatformSocket, type PlatformSocketEvents, type SocketOpenFailure } from "@potyro/capabilities";

interface Handle {
  remove(): Promise<void> | void;
}

/** The slice of the plugin this uses (a Capacitor plugin: every method crosses to Java). */
export interface LocalSocketPlugin {
  open(o: { url: string; protocols?: string[] }): Promise<{ id: string; protocol?: string }>;
  send(o: { id: string; text?: string; base64?: string }): Promise<void>;
  close(o: { id: string; code?: number; reason?: string }): Promise<void>;
  addListener(event: "message", fn: (e: { id: string; text?: string; base64?: string }) => void): Promise<Handle> | Handle;
  addListener(event: "close", fn: (e: { id: string; code: number; reason?: string; clean?: boolean }) => void): Promise<Handle> | Handle;
}

const OPEN_CODES: readonly SocketOpenFailure[] = ["offline", "refused", "unreachable", "insecure"];

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Event = { kind: "message"; text?: string; base64?: string } | { kind: "close"; code: number; reason: string; clean: boolean };

/**
 * A `LocalOpener` over the plugin. One pair of listeners for every connection, dispatched by id; what
 * arrives for a connection whose open has not returned yet waits for it (the plugin's reader thread
 * can be quicker than the open's answer).
 */
export function localOpenerOver(plugin: LocalSocketPlugin): LocalOpener {
  const live = new Map<string, (e: Event) => void>();
  const early = new Map<string, Event[]>();
  const route = (id: string, e: Event): void => {
    const to = live.get(id);
    if (to) return to(e);
    const list = early.get(id) ?? [];
    if (list.length < 256) list.push(e);
    early.set(id, list);
  };
  let listening: Promise<void> | null = null;
  const listen = (): Promise<void> =>
    (listening ??= Promise.all([
      plugin.addListener("message", (e) => route(String(e.id), { kind: "message", text: e.text, base64: e.base64 })),
      plugin.addListener("close", (e) => route(String(e.id), { kind: "close", code: Number(e.code), reason: String(e.reason ?? ""), clean: e.clean === true })),
    ]).then(() => undefined));

  return async (url: string, opts: { protocols?: string[] }, events: PlatformSocketEvents): Promise<PlatformSocket> => {
    await listen();
    let opened: { id: string; protocol?: string };
    try {
      opened = await plugin.open({ url, ...(opts.protocols?.length ? { protocols: opts.protocols } : {}) });
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      throw new SocketOpenError(e instanceof Error ? e.message : String(e), OPEN_CODES.includes(code as SocketOpenFailure) ? (code as SocketOpenFailure) : "refused");
    }
    const id = String(opened.id);
    let byApp = false;
    let buffered = 0;
    let closed = false;
    const on = (e: Event): void => {
      if (closed) return;
      if (e.kind === "message") {
        events.message(typeof e.text === "string" ? e.text : fromBase64(e.base64 ?? ""));
        return;
      }
      closed = true;
      live.delete(id);
      events.close(e.code, e.reason, byApp ? "app" : e.clean ? "server" : "network");
    };
    live.set(id, on);
    for (const e of early.get(id) ?? []) on(e);
    early.delete(id);
    return {
      protocol: opened.protocol ?? "",
      get bufferedAmount() {
        return buffered;
      },
      send(d) {
        const size = typeof d === "string" ? d.length : d.byteLength;
        buffered += size;
        void plugin
          .send(typeof d === "string" ? { id, text: d } : { id, base64: toBase64(d) })
          .catch(() => {
            // a send to a connection that has just closed: its close event says so
          })
          .finally(() => (buffered -= size));
      },
      close(code, reason) {
        if (byApp || closed) return;
        byApp = true;
        void plugin.close({ id, code: code ?? 1000, reason: reason ?? "" }).catch(() => {});
      },
    };
  };
}

/**
 * The opener on a device, else `null`. Boxed, never returned bare: an awaited Capacitor plugin hangs
 * forever on Android (deep-links.ts), and a function returning one is one refactor away from that.
 */
export async function maybeLocalOpener(): Promise<{ open: LocalOpener } | null> {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== "android") return null;
  const { registerPlugin } = await import("@capacitor/core");
  const plugin = registerPlugin<LocalSocketPlugin>("PotyroLocalSocket");
  return { open: localOpenerOver(plugin) };
}
