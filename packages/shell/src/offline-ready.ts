// Keeping all of Potyro for offline use (#123): the page's half of public/sw.js's `warm`.
//
// The worker keeps what the page boots with at install, and what it is asked for as it is used. The
// rest of the build (about 40 MB, mostly the bundler an app needs to open) is only fetched when this
// asks for it:
//
// - automatically, only on Wi-Fi or a cable with the browser's data saver off. Safari and Firefox
//   say nothing about the connection, and a phone on mobile data must not spend 40 MB of someone's
//   plan on a page they opened once — so "unknown" counts as no;
// - once, right after Potyro is added to the home screen;
// - whenever the person chooses "Keep Potyro ready offline" in You (install-row.tsx).
//
// It also tells the worker which build this page runs (`hello`), so the worker never drops the
// files an open page of an older build still needs (sw.js's header), and it listens for how much is
// kept, so You only says "Everything works offline" once that is true.

import { useSyncExternalStore } from "react";

/**
 * - `none`: no worker here (dev, the native app, a browser without one): nothing to offer.
 * - `partial`: Home and what has been opened are kept; the rest is not.
 * - `warming`: fetching the rest now.
 * - `ready`: every file of this build is kept.
 */
export type OfflineStatus = "none" | "partial" | "warming" | "ready";

export interface OfflineState {
  status: OfflineStatus;
  /** The last attempt finished with files still missing (the connection dropped, most likely). */
  failed: boolean;
}

/** What `navigator.connection` says, where a browser says anything. */
export interface ConnectionInfo {
  type?: string;
  saveData?: boolean;
}

/** Fetch the rest without asking? Only on a connection that is known not to be metered. */
export function shouldWarmAutomatically(connection: ConnectionInfo | undefined | null): boolean {
  if (!connection || connection.saveData === true) return false;
  return connection.type === "wifi" || connection.type === "ethernet";
}

/** The part of a ServiceWorkerContainer this uses, so a test can stand in for it. */
export interface WorkerContainer {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  startMessages?: () => void;
}

/** The part of a registration this uses. */
export interface WorkerRegistration {
  readonly active: { postMessage(message: unknown): void } | null;
}

let state: OfflineState = { status: "none", failed: false };
let registration: WorkerRegistration | null = null;
let connected = false;
const listeners = new Set<() => void>();

function set(next: OfflineState): void {
  if (next.status === state.status && next.failed === state.failed) return;
  state = next;
  for (const cb of listeners) cb();
}

function post(message: unknown): boolean {
  const worker = registration?.active;
  if (!worker) return false;
  worker.postMessage(message);
  return true;
}

function onMessage(event: MessageEvent, entry: string): void {
  const data = event.data as { type?: unknown; ready?: unknown; warming?: unknown; done?: unknown } | null;
  if (!data || typeof data !== "object") return;
  if (data.type === "potyro-build?") {
    // A new worker asking which build this page runs, before it drops any old files.
    const source = event.source as { postMessage?: (message: unknown) => void } | null;
    if (source?.postMessage) source.postMessage({ type: "hello", entry });
    else post({ type: "hello", entry });
    return;
  }
  if (data.type !== "offline") return;
  if (data.ready === true) return set({ status: "ready", failed: false });
  if (data.warming === true) return set({ status: "warming", failed: false });
  // An answer to "how much is kept" that crossed this page's own request to fetch the rest.
  if (data.done !== true && state.status === "warming") return;
  // Finished, and still not everything: say so only to the page that was waiting for it.
  set({ status: "partial", failed: data.done === true && state.status === "warming" });
}

/**
 * Once the worker is ready: say which build this page runs, ask how much is kept, and fetch the rest
 * if the connection allows it without asking. Once per page load; later calls do nothing.
 */
export function connectOffline(
  container: WorkerContainer,
  reg: WorkerRegistration,
  entry: string,
  connection?: ConnectionInfo | null,
): void {
  if (connected) return;
  connected = true;
  registration = reg;
  container.addEventListener("message", (event) => onMessage(event, entry));
  // Messages from the worker wait in a queue until this is called (or the page has loaded).
  container.startMessages?.();
  if (!post({ type: "hello", entry })) return;
  set({ status: "partial", failed: false });
  post({ type: "status" });
  if (shouldWarmAutomatically(connection)) keepOffline();
}

/** "Keep Potyro ready offline": fetch the rest now. */
export function keepOffline(): void {
  if (state.status === "none" || state.status === "warming") return;
  if (post({ type: "warm" })) set({ status: "warming", failed: false });
}

/** After Potyro is added to the home screen: fetch the rest once, unless it is all here already. */
export function keepOfflineAfterInstall(): void {
  if (state.status === "partial") keepOffline();
}

export function useOfflineState(): OfflineState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** Tests only: forget everything this module has seen. */
export function resetOfflineForTests(): void {
  state = { status: "none", failed: false };
  registration = null;
  connected = false;
  listeners.clear();
}
