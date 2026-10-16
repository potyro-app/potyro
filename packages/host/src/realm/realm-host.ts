// The host half of the browser-realm runner (#272, docs/22). It plugs in where the QuickJS isolate
// does — `createHost({ loadIsolated: createRealmLoader(...) })` — and nothing else in the host
// changes: the runtime still calls `LoadedApp.call*`, still builds `ctx` with `buildCtx`.
//
// Where the isolate re-implements the data ops against the Store (isolate-host.ts `handleOp`), this
// routes every op to the `ctx` the runtime passed in — the one `buildCtx` made, with `mediateCaps`,
// the values gate and authorship inside. There is no second copy of any check: an op the realm sends
// is the same method call a trusted app makes, on a ctx whose caps are mediated.
//
// Watchdog: every call has a deadline, and the worker beats every 100 ms. A missed deadline or a
// silent heartbeat kills the realm — the frame and its worker — and rejects what was waiting. The
// next call starts a fresh realm (40–60 ms measured).

import type { AppDefinition, Ctx, PermissionManifest, Resolved, UiProgress, UiTimer, Value } from "potyro";
import type { TimerData } from "../timers.js";
import type { BindingRef, LoadedApp, Provenance } from "../types.js";
import { OPS, type CallKind, type CtxBase, type FetchAnswer, type Op, type RealmToHost } from "./protocol.js";
import { SocketBridge, type BoxSocketInfo } from "../socket-bridge.js";
import { SpeechBridge, type BoxSpeechInfo } from "../speech-bridge.js";

/**
 * The realm itself could not start on this browser — the frame did not load, or could not make its
 * Worker — as opposed to the app failing in it. The shell falls back to QuickJS on this (still
 * sealed); an app's own failure is never a reason to change boxes.
 */
export class RealmStartError extends Error {
  override name = "RealmStartError";
}

/** One started realm: the port to its worker, and a way to end it. */
export interface RealmHandle {
  port: MessagePort;
  /** End the realm now. Idempotent. */
  kill(): void;
}

/**
 * Starts a realm. The browser's is `frameSpawner()` (frame.ts); tests may run the same worker
 * runtime in a thread. `onLost` is called when the realm ends without being asked to.
 */
export type RealmSpawner = (args: { workerSource: string; onLost: (reason: string) => void }) => Promise<RealmHandle>;

export interface RealmLoaderOptions {
  /** How a realm is started (`frameSpawner()` in a browser). */
  spawn: RealmSpawner;
  /** The bundled worker runtime (`realm-build.mjs`; the shell gets it from `virtual:potyro-realm-worker`). */
  workerSource: string;
  /** Per call, like the isolate's `timeoutMs` (default 1000). Time spent on a question for the person does not count. */
  timeoutMs?: number;
  /** Starting the realm and running the bundle's top level (default 5000), like the isolate's `loadTimeoutMs`. */
  loadTimeoutMs?: number;
  /** A realm whose worker has not beaten for this long is stopped (default 1000). */
  heartbeatTimeoutMs?: number;
  /** Told every time the watchdog stops this app (for the shell's "this app stopped" and for tests). */
  onKill?: (reason: string) => void;
}

const DEFAULT_TIMEOUT = 1000;
const DEFAULT_LOAD_TIMEOUT = 5000;
const DEFAULT_HEARTBEAT_TIMEOUT = 1000;
const CHECK_MS = 50;
/**
 * Messages a realm may send between two checks (50 ms). A worker beats twice a second and every op
 * waits for its answer, so thousands means it is posting in a loop — which would keep the heartbeat
 * fed while it starves the shell's thread. It is stopped like a silent one.
 */
const MAX_BURST = 2000;
/** How many ctxs a realm can still name. Older ones answer "no such ctx": their pass is long over. */
const CTX_WINDOW = 512;

export function createRealmLoader(opts: RealmLoaderOptions) {
  const o: ResolvedOptions = {
    spawn: opts.spawn,
    workerSource: opts.workerSource,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT,
    loadTimeoutMs: opts.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT,
    heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT,
    onKill: opts.onKill,
  };
  return async function loadRealm(args: { code: string; provenance: Provenance }): Promise<LoadedApp> {
    if (args.provenance !== "untrusted") throw new Error("the realm runner is for untrusted apps");
    const app = new RealmLoadedApp(args.code, o);
    await app.start();
    return app;
  };
}

interface ResolvedOptions {
  spawn: RealmSpawner;
  workerSource: string;
  timeoutMs: number;
  loadTimeoutMs: number;
  heartbeatTimeoutMs: number;
  onKill?: (reason: string) => void;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  started: number;
  /** Time spent waiting on the person when the call began; the budget pauses while a question is open. */
  waitedBefore: number;
  label: string;
}

const now = (): number => performance.now();
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class RealmLoadedApp implements LoadedApp {
  definition!: AppDefinition;
  readonly provenance: Provenance = "untrusted";
  permissions: PermissionManifest = {};

  private realm: RealmHandle | null = null;
  private port: MessagePort | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private lastBeat = 0;
  private lastCheck = 0;
  private burst = 0;
  private watch: ReturnType<typeof setInterval> | null = null;
  private starting: Promise<void> | null = null;
  private disposed = false;

  private ctxIds = new WeakMap<Ctx, number>();
  private ctxById = new Map<number, Ctx>();
  private ctxSeq = 0;
  private progress = new Map<string, UiProgress>();
  /** Screens held on by the realm, by its number for each: let go when the realm goes. */
  private awake = new Map<string, { release(): void }>();
  private questionsOpen = 0;
  private questionSince = 0;
  private questionMs = 0;
  /**
   * Live connections (docs/28): the host holds them, the realm a number for each. A message goes in
   * as `{ t: "sock" }` and the worker acks it once the app's callback has it, so at most the bridge's
   * window is ever in the realm untaken.
   */
  private readonly sockets = new SocketBridge(
    (ev) => {
      const port = this.port;
      if (!port) return true; // the realm is gone: nothing to hold it for
      port.postMessage({ t: "sock", ev });
      return ev.kind !== "message";
    },
    (sid) => this.unpin(sid),
  );
  /** Listenings (docs/29): the host holds the microphone; `{ t: "speech" }` carries what it hears. */
  private readonly speech = new SpeechBridge(
    (ev) => this.port?.postMessage({ t: "speech", ev }),
    (lid) => {
      this.unpin(-lid);
      if (this.listening.delete(lid)) this.questionClosed();
    },
  );
  /**
   * Listenings that are on: each is the person speaking, so — like a question — the calls waiting on
   * it (an action awaiting `result`) do not use their budget meanwhile. A listening ends by itself
   * (a pause, five minutes), so this cannot hold a box open for ever.
   */
  private readonly listening = new Set<number>();
  /**
   * A ctx a connection (by its sid) or a listening (by minus its lid) was opened through stays
   * nameable while it is open: its callbacks still use it.
   */
  private pinnedBy = new Map<number, number>();

  constructor(
    private readonly code: string,
    private readonly o: ResolvedOptions,
  ) {}

  // ---------------------------------------------------------------- lifecycle

  /** Start (or restart, after a kill) the realm and load the app into it. */
  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("this app was closed"));
    this.starting ??= this.spawn().finally(() => (this.starting = null));
    return this.starting;
  }

  private async spawn(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let up = false;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(up ? new Error(`the app did not load within ${this.o.loadTimeoutMs} ms`) : new RealmStartError(`the sealed box did not start within ${this.o.loadTimeoutMs} ms`)),
        this.o.loadTimeoutMs,
      );
    });
    late.catch(() => {});
    let realm: RealmHandle | null = null;
    const spawning = this.o.spawn({ workerSource: this.o.workerSource, onLost: (why) => this.realm === realm && this.kill(why) });
    try {
      realm = await Promise.race([spawning, late]);
      const port = realm.port;
      const ready = new Promise<string>((resolve, reject) => {
        port.onmessage = (e: MessageEvent) => {
          const m = e.data as RealmToHost;
          if (m?.t === "up") up = true;
          else if (m?.t === "ready") (m.error != null ? reject(m.start ? new RealmStartError(m.error) : new Error(m.error)) : resolve(String(m.definition)));
        };
      });
      port.postMessage({ t: "load", code: this.code });
      const raw = JSON.parse(await Promise.race([ready, late])) as AppDefinition;
      if (this.disposed) throw new Error("this app was closed");
      // The same normalisation the isolate does after reading the definition out (#105).
      this.definition = { ...raw, pages: (raw.pages ?? []).map((p) => (p.view ? p : { ...p, view: p.layout!.items[0]!.view })) };
      this.permissions = this.definition.permissions ?? {};
      this.realm = realm;
      this.port = port;
      port.onmessage = (e: MessageEvent) => this.onMessage(e.data as RealmToHost);
      this.lastBeat = this.lastCheck = now();
      this.watch = setInterval(() => this.check(), CHECK_MS);
    } catch (e) {
      // Also a realm that started only after the deadline: nothing will ever adopt it.
      void spawning.then((r) => r.kill(), () => {});
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Stop the realm now; what was waiting on it is rejected. The next call starts a fresh one. */
  kill(reason: string): void {
    if (!this.realm) return;
    this.o.onKill?.(reason);
    // The new realm will not know these connections' numbers: they end with the old one.
    this.sockets.endAll("stopped", "the app was stopped");
    this.speech.endAll();
    this.teardown();
    for (const [, p] of this.pending) p.reject(new Error(`stopped: ${reason}`));
    this.pending.clear();
  }

  private teardown(): void {
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    const realm = this.realm;
    this.realm = null;
    if (this.port) this.port.onmessage = null;
    this.port?.close();
    this.port = null;
    realm?.kill();
    for (const [, bar] of this.progress) bar.done();
    this.progress.clear();
    for (const [, held] of this.awake) held.release();
    this.awake.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.sockets.endAll("left", "the app was closed");
    this.speech.endAll();
    this.teardown();
    for (const [, p] of this.pending) p.reject(new Error("this app was closed"));
    this.pending.clear();
    this.ctxById.clear();
  }

  // ---------------------------------------------------------------- watchdog

  private waitedOnPeople(): number {
    return this.questionMs + (this.questionsOpen ? now() - this.questionSince : 0);
  }

  private check(): void {
    const t = now();
    // This check itself ran late: the SHELL's thread was blocked (a heavy render, a backgrounded
    // tab). Beats queued behind it say nothing about the realm, so they are not held against it.
    const late = t - this.lastCheck - CHECK_MS;
    this.lastCheck = t;
    this.burst = 0;
    if (late > this.o.heartbeatTimeoutMs / 2) {
      this.lastBeat = t;
      return;
    }
    if (t - this.lastBeat > this.o.heartbeatTimeoutMs) return this.kill(`its logic stopped answering for ${Math.round(t - this.lastBeat)} ms`);
    const waited = this.waitedOnPeople();
    for (const [, p] of this.pending) {
      const used = t - p.started - (waited - p.waitedBefore);
      if (used > this.o.timeoutMs) return this.kill(`a ${p.label} did not finish within ${this.o.timeoutMs} ms`);
    }
  }

  // ---------------------------------------------------------------- messages

  private onMessage(m: RealmToHost): void {
    if (++this.burst > MAX_BURST) return this.kill(`it sent more than ${MAX_BURST} messages in ${CHECK_MS} ms`);
    if (!m || typeof m !== "object") return;
    if (m.t === "hb") {
      this.lastBeat = now();
      return;
    }
    if (m.t === "sockack") {
      this.sockets.ack(Number(m.sid), Number(m.n), Number(m.bytes));
      return;
    }
    if (m.t === "result") {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(`realm app error: ${String(m.error)}`));
      return;
    }
    if (m.t === "op") void this.answer(m);
  }

  /** One op from the realm, answered through the ctx it names. */
  private async answer(m: Extract<RealmToHost, { t: "op" }>): Promise<void> {
    const port = this.port;
    const id = Number(m.id) || 0;
    const reply = (ok: boolean, value?: unknown, error?: string, code?: string) => {
      if (!id || !port || port !== this.port) return; // fire-and-forget, or the realm is gone
      try {
        port.postMessage({ t: "reply", id, ok, value, error, ...(code ? { code } : {}) });
      } catch (e) {
        port.postMessage({ t: "reply", id, ok: false, error: `the answer cannot be sent into the app: ${message(e)}` });
      }
    };
    try {
      if (typeof m.op !== "string" || !(OPS as readonly string[]).includes(m.op)) throw new Error(`op not allowed: ${String(m.op).slice(0, 40)}`);
      const ctxId = Number(m.ctxId);
      const ctx = this.ctxById.get(ctxId);
      if (!ctx) throw new Error("no such ctx");
      const value = await this.route(ctx, m.op as Op, Array.isArray(m.args) ? m.args : []);
      const opened = (m.op === "caps.network.socket" || m.op === "caps.network.room") && port === this.port ? (value as BoxSocketInfo) : null;
      if (opened) this.pinnedBy.set(opened.sid, ctxId);
      const listening = m.op === "caps.speech.listen" && port === this.port ? (value as BoxSpeechInfo) : null;
      if (listening) {
        this.pinnedBy.set(-listening.lid, ctxId);
        this.listening.add(listening.lid);
        this.questionOpened();
      }
      reply(true, value);
      // Only now, after the realm has its number, may the connection's events follow.
      if (opened) {
        if (id) this.sockets.ready(opened.sid);
        else this.sockets.close(opened.sid);
      }
      if (listening) {
        if (id) this.speech.ready(listening.lid);
        else this.speech.stop(listening.lid);
      }
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      reply(false, undefined, message(e), typeof code === "string" ? code : undefined);
    }
  }

  /** The person is being asked something: the calls waiting on it do not use their budget meanwhile. */
  private async question<T>(run: () => Promise<T>): Promise<T> {
    this.questionOpened();
    try {
      return await run();
    } finally {
      this.questionClosed();
    }
  }

  private questionOpened(): void {
    if (this.questionsOpen++ === 0) this.questionSince = now();
  }

  private questionClosed(): void {
    if (--this.questionsOpen === 0) this.questionMs += now() - this.questionSince;
  }

  /**
   * The op table. Each line is a method call on the ctx `buildCtx` made — the same object a trusted
   * app holds, with mediated caps. No check is repeated here, so there is nothing here to keep in step.
   * Arguments are untrusted values; each is coerced to the type the method takes.
   */
  private async route(ctx: Ctx, op: Op, a: unknown[]): Promise<unknown> {
    const s = (i: number) => String(a[i]);
    const opt = (i: number) => (a[i] == null ? undefined : String(a[i]));
    const x = (i: number) => a[i] as never;
    switch (op) {
      case "log":
        return ctx.log(...a.map((v) => (typeof v === "string" ? v : String(v))));
      case "query":
        return ctx.query(s(0));
      case "get":
        return ctx.get(s(0), s(1));
      case "create":
        return ctx.create(s(0), x(1));
      case "patch":
        return ctx.patch(s(0), s(1), x(2));
      case "increment":
        return ctx.increment(s(0), s(1), s(2), Number(a[3]));
      case "delete":
        return ctx.delete(s(0), s(1));
      case "storage.get":
        return ctx.storage.get(s(0));
      case "storage.set":
        return ctx.storage.set(s(0), a[1]);
      case "storage.delete":
        return ctx.storage.delete(s(0));
      case "storage.keys":
        return ctx.storage.keys(opt(0));
      case "media.put":
        if (!(a[0] instanceof Blob)) throw new Error("ctx.media.put takes a Blob");
        return ctx.media.put(a[0]);
      case "media.url":
        return ctx.media.url(x(0));
      case "files.list":
        return ctx.files.list(opt(0));
      case "files.stat":
        return ctx.files.stat(x(0));
      case "files.text":
        return ctx.files.text(x(0));
      case "files.bytes":
        return ctx.files.bytes(x(0));
      case "files.url":
        return ctx.files.url(x(0));
      case "files.write": {
        const data = a[1];
        if (!(typeof data === "string" || data instanceof Uint8Array || data instanceof Blob)) throw new Error("ctx.files.write takes a string, a Uint8Array or a Blob");
        return ctx.files.write(s(0), data, x(2));
      }
      case "files.rename":
        return ctx.files.rename(x(0), s(1));
      case "files.remove":
        return ctx.files.remove(x(0));
      // A system dialog the person answers is the consent (make-ctx.ts filesFor): the budget pauses.
      case "files.import":
        return this.question(() => ctx.files.import(x(0)));
      case "files.export":
        return this.question(() => ctx.files.export(x(0)));
      case "ui.toast":
        return ctx.ui.toast(x(0));
      case "ui.confirm":
        return this.question(() => ctx.ui.confirm(x(0), x(1)));
      case "ui.prompt":
        return this.question(() => ctx.ui.prompt(x(0), x(1)));
      case "ui.pick":
        return this.question(() => ctx.ui.pick(Array.isArray(a[0]) ? (a[0] as unknown[]) : [], x(1)));
      case "ui.sheet":
        return this.question(() => ctx.ui.sheet(x(0)));
      case "ui.menu":
        return this.question(() => ctx.ui.menu(x(0)));
      case "ui.form":
        return this.question(() => ctx.ui.form(x(0)));
      case "ui.share":
        return this.question(() => ctx.ui.share(x(0)));
      case "ui.progress": {
        const [pid, what, arg, detail] = [s(0), s(1), a[2], a[3]];
        const bar = this.progress.get(pid);
        if (what === "open" && !bar) this.progress.set(pid, ctx.ui.progress(arg as never));
        else if (bar && what === "update") bar.update(Number(arg), detail == null ? undefined : String(detail));
        else if (bar && what === "done") {
          bar.done();
          this.progress.delete(pid);
        }
        return null;
      }
      case "ui.keepAwake": {
        const [hid, what] = [s(0), s(1)];
        if (what === "hold" && !this.awake.has(hid) && this.awake.size < 32) this.awake.set(hid, ctx.ui.keepAwake());
        else if (what === "release") {
          this.awake.get(hid)?.release();
          this.awake.delete(hid);
        }
        return null;
      }
      case "ui.timer":
        return plainTimerOf(await ctx.ui.timer(x(0)));
      case "ui.timers":
        return (await ctx.ui.timers()).map(plainTimerOf);
      case "ui.timer.control": {
        const verb = s(1);
        const timer = (await ctx.ui.timers()).find((t) => t.id === s(0));
        if (timer && (verb === "cancel" || verb === "pause" || verb === "resume")) await timer[verb]();
        return null;
      }
      case "guests.add":
        return { ...(await ctx.guests.add(s(0))) };
      case "guests.rename":
        return ctx.guests.rename(s(0), s(1));
      case "guests.remove":
        return ctx.guests.remove(s(0));
      case "navigate":
        return ctx.navigate(s(0), x(1));
      case "views.call": {
        const verb = s(1);
        if (verb === "map.flyTo") return ctx.views.map(s(0)).flyTo(x(2));
        if (verb === "map.fit") return ctx.views.map(s(0)).fit();
        return false;
      }
      // Capabilities: whatever `mediateCaps` put on this ctx — absent unless the manifest asked for it,
      // behind the person's consent. A consent prompt and a device sensor wait on the person or the
      // world, not on the app, so the budget pauses for them.
      case "caps.camera.capture": {
        const camera = ctx.caps.camera;
        if (!camera) throw new Error("Permission denied: camera");
        return this.question(() => camera.capture(x(0)));
      }
      case "caps.geo.current": {
        const geo = ctx.caps.geo;
        if (!geo) throw new Error("Permission denied: geo");
        return this.question(() => geo.current());
      }
      case "caps.haptics.vibrate":
        return ctx.caps.haptics?.vibrate(x(0));
      case "caps.notifications.schedule": {
        const n = ctx.caps.notifications;
        if (!n) throw new Error("Permission denied: notifications");
        const req = (a[0] ?? {}) as { id?: unknown; at?: unknown; title?: unknown; body?: unknown };
        return this.question(() => n.schedule({ id: String(req.id), at: new Date(String(req.at)), title: String(req.title), body: req.body == null ? undefined : String(req.body) }));
      }
      case "caps.notifications.cancel": {
        const n = ctx.caps.notifications;
        if (!n) throw new Error("Permission denied: notifications");
        return n.cancel(s(0));
      }
      case "caps.filesystem.pick": {
        const fs = ctx.caps.filesystem;
        if (!fs) throw new Error("Permission denied: filesystem");
        return this.question(() => fs.pick());
      }
      case "caps.filesystem.save": {
        const fs = ctx.caps.filesystem;
        if (!fs) throw new Error("Permission denied: filesystem");
        if (!(a[1] instanceof Blob)) throw new Error("caps.filesystem.save takes a Blob");
        const data = a[1];
        return this.question(() => fs.save(s(0), data));
      }
      // AI (docs/23): `mediateCaps` put it here only if the manifest asked; the shape is checked, the
      // person asked and the answer validated in ai.ts. The wait is the network's, not the app's.
      case "caps.ai.extract": {
        const ai = ctx.caps.ai;
        if (!ai) throw new Error("Permission denied: AI");
        return this.question(() => ai.extract(x(0)));
      }
      case "caps.ai.ask": {
        const ai = ctx.caps.ai;
        if (!ai) throw new Error("Permission denied: AI");
        return this.question(() => ai.ask(s(0), x(1)));
      }
      // Live connections (docs/28): `mediateCaps` decides as for fetch — the manifest's hosts, the
      // person's consent once — and the host holds the connection. Asking waits on the person.
      case "caps.network.socket":
        return this.question(() => this.sockets.open(ctx, s(0), x(1)));
      case "caps.network.room":
        return this.question(() => this.sockets.room(ctx, opt(0), x(1)));
      // Voice (docs/29): `mediateCaps` put it here only if the manifest asked; asking waits on the person.
      case "caps.speech.listen":
        return this.question(() => this.speech.listen(ctx, x(0)));
      case "caps.speech.stop":
        this.speech.stop(Number(a[0]));
        return null;
      case "caps.network.socket.send":
        return this.sockets.send(Number(a[0]), a[1]);
      case "caps.network.socket.close":
        this.sockets.close(Number(a[0]), a[1], a[2]);
        return null;
      case "caps.network.fetch": {
        // `mediateCaps` decides: the manifest, the host allow-list, the person's consent.
        const network = ctx.caps.network;
        if (!network) throw new Error("Permission denied: network");
        const init = (a[1] ?? undefined) as RequestInit | undefined;
        return this.question(async (): Promise<FetchAnswer> => {
          const res = await network.fetch(s(0), init && { method: init.method, headers: init.headers, body: init.body });
          return { status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body: await res.arrayBuffer() };
        });
      }
    }
  }

  // ---------------------------------------------------------------- calls

  private unpin(sid: number): void {
    this.pinnedBy.delete(sid);
  }

  private idFor(ctx: Ctx): number {
    let id = this.ctxIds.get(ctx);
    if (id === undefined) {
      id = ++this.ctxSeq;
      this.ctxIds.set(ctx, id);
      this.ctxById.set(id, ctx);
      if (this.ctxById.size > CTX_WINDOW) {
        // The oldest that no open connection still uses.
        const pinned = new Set(this.pinnedBy.values());
        for (const k of this.ctxById.keys()) {
          if (pinned.has(k)) continue;
          this.ctxById.delete(k);
          break;
        }
      }
    }
    return id;
  }

  private baseOf(ctx: Ctx): CtxBase {
    return {
      ctxId: this.idFor(ctx),
      params: { ...ctx.params },
      nowIso: ctx.now().toISOString(),
      me: { id: ctx.me.id, name: ctx.me.name },
      // Identity crosses as plain data; `invite` never does (KA-18).
      space: ctx.space ? { id: ctx.space.id, role: ctx.space.role, members: ctx.space.members.map((m) => ({ ...m })) } : undefined,
      people: ctx.people.map((p) => ({ id: p.id, name: p.name, ...(p.guest ? { guest: true as const } : {}) })),
      scope: { ...ctx.scope },
      locale: ctx.locale,
      formatLocale: ctx.format.locale,
      language: this.definition.language,
      languages: this.definition.languages,
      capsAvailable: Object.keys(ctx.caps).filter((k) => (ctx.caps as unknown as Record<string, unknown>)[k] != null),
    };
  }

  private async invoke(kind: CallKind, args: unknown[], ctx: Ctx): Promise<Value> {
    if (this.disposed) throw new Error("this app was closed");
    if (!this.port) await this.start();
    const port = this.port!;
    const id = ++this.seq;
    const base = this.baseOf(ctx);
    return new Promise<Value>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, started: now(), waitedBefore: this.waitedOnPeople(), label: `${kind} call` });
      try {
        port.postMessage({ t: "call", id, kind, args, base });
      } catch (e) {
        this.pending.delete(id);
        reject(new Error(`a ${kind} call's arguments cannot be sent into the app: ${message(e)}`));
      }
    });
  }

  callComputed(entity: string, key: string, record: Resolved, ctx: Ctx): Promise<Value> {
    return this.invoke("computed", [entity, key, record], ctx);
  }
  async callAction(entity: string, key: string, record: Resolved, ctx: Ctx, input?: unknown): Promise<void> {
    await this.invoke("action", [entity, key, record, input], ctx);
  }
  async callFilter(pageId: string, record: Resolved, ctx: Ctx): Promise<boolean> {
    return Boolean(await this.invoke("filter", [pageId, record], ctx));
  }
  async callSort(pageId: string, a: Resolved, b: Resolved, ctx: Ctx): Promise<number> {
    return Number(await this.invoke("sort", [pageId, a, b], ctx));
  }
  callBinding(ref: BindingRef, record: Resolved, ctx: Ctx): Promise<Value> {
    return this.invoke("binding", [ref, record], ctx);
  }
  callViewOption(pageId: string, key: string, ctx: Ctx): Promise<Value> {
    return this.invoke("viewOption", [pageId, key], ctx);
  }
  callPageOption(pageId: string, key: string, ctx: Ctx): Promise<Value> {
    return this.invoke("pageOption", [pageId, key], ctx);
  }
  async callPageAction(pageId: string, index: number, ctx: Ctx): Promise<void> {
    await this.invoke("pageAction", [pageId, index], ctx);
  }
  callSummary(pageId: string, index: number, rows: Resolved[], ctx: Ctx): Promise<Value> {
    return this.invoke("summary", [pageId, index, rows], ctx);
  }
  callAggregate(pageId: string, rows: Resolved[], ctx: Ctx): Promise<Value> {
    return this.invoke("aggregate", [pageId, rows], ctx);
  }
  callFold(pageId: string, path: string, rows: Resolved[], ctx: Ctx): Promise<Value> {
    return this.invoke("fold", [pageId, path, rows], ctx);
  }
  callFieldDefault(entity: string, field: string, ctx: Ctx): Promise<Value> {
    return this.invoke("fieldDefault", [entity, field], ctx);
  }
  callTile(ctx: Ctx): Promise<Value> {
    return this.invoke("tile", [], ctx);
  }
  async reminderWhen(id: string, record: Resolved, ctx: Ctx): Promise<Date | null> {
    const v = await this.invoke("reminderWhen", [id, record], ctx);
    return v == null ? null : v instanceof Date ? v : new Date(String(v));
  }
  /** docs/05: custom views of shared apps stay off in phase 1; the views fall back to built-ins. */
  customView(): null {
    return null;
  }
}

/** A timer handle as the data that crosses (its methods do not). */
function plainTimerOf(t: UiTimer): TimerData {
  return { id: t.id, label: t.label, seconds: t.seconds, endsAt: t.endsAt ? t.endsAt.toISOString() : null, left: t.left, paused: t.paused };
}
