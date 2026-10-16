// The `ctx` app code gets inside the realm. Plain data and formatting answer locally; everything that
// reaches the store, a capability, the person or the shell is a message to the host, which runs it
// through the real mediated ctx (realm-host.ts `route`).
//
// Formatting is the host's own `format.ts`, bundled into the realm: same code, real `Intl`, so a date
// reads the same as in a trusted app — without a round trip.
//
// Values cross by structured clone, so a Blob, a Uint8Array or a Date arrives as itself; a function
// does not cross at all (a query's `filter` runs here, over the rows the host resolved).

import type { Ctx, CtxFiles, FileInfo, FileRef, MediaRef, QuerySpec, Resolved, UiProgress } from "potyro";
import { makeFormat, translate, type WordsContext } from "../format.js";
import type { Transport } from "./port-transport.js";
import type { CtxBase, FetchAnswer, Op } from "./protocol.js";
import { realmSocket, type RealmSocketInfo } from "./realm-sockets.js";
import { plainTimer, timerHandle, type TimerVerb } from "../timers.js";
import { realmSpeech, type RealmSpeechInfo } from "./realm-speech.js";

let progressSeq = 0;
let awakeSeq = 0;

/** A file argument as plain data: a path, or a FileRef's own fields (never a getter or a method). */
const fileArg = (f: string | FileRef): string | FileRef =>
  typeof f === "string" ? f : f && typeof f === "object" ? { id: f.id, path: f.path, name: f.name, mime: f.mime } as FileRef : f;

/** A picture as data that clones: a Blob or bytes as themselves, a reference by its fields only. */
function aiImage(img: unknown): unknown {
  if (img instanceof Blob || img instanceof Uint8Array || typeof img === "string") return img;
  if (img && typeof img === "object") {
    const r = img as Record<string, unknown>;
    return r.key !== undefined ? { key: r.key, mime: r.mime } : { id: r.id, path: r.path, name: r.name, mime: r.mime };
  }
  return img;
}
const aiImages = (img: unknown): unknown => (Array.isArray(img) ? img.map(aiImage) : img == null ? undefined : aiImage(img));

function applySpec(rows: Resolved[], spec?: QuerySpec): Resolved[] {
  let out = rows;
  if (spec?.filter) out = out.filter((r) => spec.filter!(r));
  if (spec?.sort) out = [...out].sort(spec.sort);
  const offset = spec?.offset ?? 0;
  const end = spec?.limit != null ? offset + spec.limit : undefined;
  return offset || end != null ? out.slice(offset, end) : out;
}

/** `RequestInit` as plain data: what `fetch` would send, never a signal or a stream. */
function plainInit(init?: RequestInit): Record<string, unknown> | undefined {
  if (!init) return undefined;
  const headers = init.headers instanceof Headers ? [...init.headers.entries()] : init.headers;
  return { method: init.method, headers, body: init.body as unknown };
}

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export function makeRealmCtx(base: CtxBase, tx: Transport): Ctx {
  const id = base.ctxId;
  const call = <T = unknown>(op: Op, ...args: unknown[]): Promise<T> => tx.call(id, op, args) as Promise<T>;
  const send = (op: Op, ...args: unknown[]): void => tx.send(id, op, args);
  const fixedNow = new Date(base.nowIso);
  const words: WordsContext = {
    language: base.locale,
    app: { language: base.language, languages: base.languages },
    formatLocale: base.formatLocale,
    now: () => fixedNow,
  };
  const has = (n: string) => base.capsAvailable.includes(n);
  const timerControl = async (tid: string, verb: TimerVerb): Promise<void> => {
    await call("ui.timer.control", String(tid), verb);
  };

  const files: CtxFiles = {
    list: (folder) => call<FileInfo[]>("files.list", folder == null ? undefined : String(folder)),
    stat: (f) => call("files.stat", fileArg(f)),
    text: (f) => call("files.text", fileArg(f)),
    async json<T = unknown>(f: string | FileRef): Promise<T | null> {
      const t = await call<string | null>("files.text", fileArg(f));
      if (t == null) return null;
      try {
        return JSON.parse(t) as T;
      } catch (e) {
        const name = typeof f === "string" ? f : (f.path ?? f.name ?? f.id);
        throw new Error(`"${name}" is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    bytes: (f) => call("files.bytes", fileArg(f)),
    url: (f) => call("files.url", fileArg(f)),
    write: (path, data, opts) => call("files.write", String(path), data, opts ? { mime: opts.mime } : undefined),
    rename: (f, to) => call("files.rename", fileArg(f), String(to)),
    remove: async (f) => {
      await call("files.remove", fileArg(f));
    },
    import: (opts) => call("files.import", opts ? { folder: opts.folder, accept: opts.accept, multiple: opts.multiple } : undefined),
    export: async (f) => {
      await call("files.export", fileArg(f));
    },
  };

  // Always present, as the mediated caps are — the host refuses unless the manifest asked and the
  // person agreed (`mediateCaps`). The others exist only where the host's ctx has them.
  const caps: Ctx["caps"] = {
    network: {
      fetch: async (input: string, init?: RequestInit) => {
        const r = await call<FetchAnswer>("caps.network.fetch", String(input), plainInit(init));
        return new Response(r.status === 204 || r.status === 304 ? null : r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
      },
      // The host opens and holds the connection (the realm connects nowhere); this is its handle.
      socket: async (url, o) => {
        const p = o?.protocols;
        const keep = o?.keepWhileHidden == null ? {} : { keepWhileHidden: String(o.keepWhileHidden) };
        const opts = p == null && o?.keepWhileHidden == null ? undefined : { ...(p == null ? {} : { protocols: Array.isArray(p) ? p.map(String) : String(p) }), ...keep };
        return realmSocket(await call<RealmSocketInfo>("caps.network.socket", String(url), opts), call, tx);
      },
      room: async (rid, o) => {
        const opts = o?.name == null && o?.keepWhileHidden == null ? undefined : { ...(o?.name == null ? {} : { name: String(o.name) }), ...(o?.keepWhileHidden == null ? {} : { keepWhileHidden: String(o.keepWhileHidden) }) };
        return realmSocket(await call<RealmSocketInfo>("caps.network.room", rid == null ? undefined : String(rid), opts), call, tx) as never;
      },
    },
    filesystem: {
      pick: () => call<Blob>("caps.filesystem.pick"),
      save: async (name, data) => {
        await call("caps.filesystem.save", String(name), data);
      },
    },
  };
  if (has("camera")) caps.camera = { capture: (o) => call<Blob>("caps.camera.capture", o ? { source: o.source } : undefined) };
  if (has("geo")) caps.geo = { current: () => call("caps.geo.current") };
  if (has("haptics"))
    caps.haptics = {
      vibrate: async (p) => {
        send("caps.haptics.vibrate", p);
      },
    };
  if (has("ai"))
    caps.ai = {
      // The host checks the shape, asks the person, sends and validates (ai.ts); nothing of that is here.
      extract: (req) =>
        call("caps.ai.extract", {
          schema: req?.schema,
          instructions: req?.instructions,
          text: req?.text,
          image: aiImages(req?.image),
        }) as never,
      ask: (prompt, o) => call<string>("caps.ai.ask", String(prompt), o ? { instructions: o.instructions, image: aiImages(o.image) } : undefined),
    };
  if (has("speech"))
    caps.speech = {
      // The host asks the person and holds the microphone (speech.ts); this is the listening's handle.
      listen: async (o) =>
        realmSpeech(await call<RealmSpeechInfo>("caps.speech.listen", o ? { language: o.language == null ? undefined : String(o.language), interim: o.interim == null ? undefined : o.interim !== false } : undefined), call),
    };
  if (has("notifications"))
    caps.notifications = {
      supportsExactScheduling: false,
      schedule: async (n) => {
        await call("caps.notifications.schedule", { id: n.id, at: new Date(n.at).toISOString(), title: n.title, body: n.body });
      },
      cancel: async (nid) => {
        await call("caps.notifications.cancel", String(nid));
      },
    };

  const ctx: Ctx = {
    me: { ...base.me },
    ...(base.space
      ? {
          // `invite` is not there at all (KA-18), as through the isolate: minting an invite is host
          // UI, never an app call, and the host has no op for it.
          space: { ...base.space, members: base.space.members.map((m) => ({ ...m })) } as unknown as NonNullable<Ctx["space"]>,
        }
      : {}),
    people: Object.freeze((base.people ?? []).map((p) => ({ ...p }))),
    guests: {
      add: (name) => call("guests.add", String(name)),
      rename: async (gid, name) => {
        await call("guests.rename", String(gid), String(name));
      },
      remove: async (gid) => {
        await call("guests.remove", String(gid));
      },
    },
    async query(entity, spec) {
      // The host resolves the rows (relations, computed); the app's own functions filter and sort here.
      return applySpec(await call<Resolved[]>("query", String(entity)), spec);
    },
    get: (entity, rid) => call("get", String(entity), String(rid)),
    create: (entity, data) => call("create", String(entity), data),
    patch: (entity, rid, data) => call("patch", String(entity), String(rid), data),
    increment: (entity, rid, field, delta) => call("increment", String(entity), String(rid), String(field), Number(delta)),
    delete: async (entity, rid) => {
      await call("delete", String(entity), String(rid));
    },
    // As through the isolate: the steps run in order, but not as one store transaction.
    transaction: async (fn) => fn(ctx),
    now: () => new Date(fixedNow),
    today: () => new Date(fixedNow.getFullYear(), fixedNow.getMonth(), fixedNow.getDate()),
    locale: base.locale,
    t: (w, vars) => translate(w, vars, words),
    format: makeFormat(base.formatLocale, () => fixedNow),
    params: Object.freeze({ ...base.params }),
    scope: Object.freeze({ ...base.scope }),
    storage: {
      get: (k) => call("storage.get", String(k)),
      set: async (k, v) => {
        await call("storage.set", String(k), v);
      },
      delete: async (k) => {
        await call("storage.delete", String(k));
      },
      keys: (prefix) => call("storage.keys", prefix == null ? undefined : String(prefix)),
    },
    caps,
    media: {
      put: (bytes) => call<MediaRef>("media.put", bytes),
      url: (ref) => call("media.url", ref ? { key: ref.key, mime: ref.mime } : ref),
    },
    files,
    ui: {
      toast: (m) => send("ui.toast", m),
      confirm: (m, o) => call("ui.confirm", m, o),
      prompt: (m, o) => call("ui.prompt", m, o),
      // `opts.label` is a function and cannot cross: the host labels items its default way.
      pick: (items, o) => call("ui.pick", items, o ? { multi: o.multi } : undefined),
      sheet: (o) => call("ui.sheet", o),
      menu: (o) => call("ui.menu", o),
      form: (o) => call("ui.form", o),
      // A file to share crosses as a picture does: a Blob as itself, a reference by its fields only.
      share: (o) => call("ui.share", o && Array.isArray(o.files) ? { ...o, files: o.files.map(aiImage) } : o),
      keepAwake: () => {
        const hid = `w${++awakeSeq}`;
        send("ui.keepAwake", hid, "hold");
        return { release: () => send("ui.keepAwake", hid, "release") };
      },
      timer: async (o) => timerHandle(plainTimer(await call("ui.timer", o ? { label: o.label, seconds: o.seconds, id: o.id } : o)), timerControl),
      timers: async () => ((await call<unknown[]>("ui.timers")) ?? []).map((t) => timerHandle(plainTimer(t), timerControl)),
      progress: (label): UiProgress => {
        const pid = `p${++progressSeq}`;
        send("ui.progress", pid, "open", label);
        return {
          update: (f, d) => send("ui.progress", pid, "update", Number(f), d == null ? undefined : String(d)),
          done: () => send("ui.progress", pid, "done"),
        };
      },
    },
    views: {
      map: (page) => ({
        flyTo: (to) => call("views.call", String(page), "map.flyTo", to),
        fit: () => call("views.call", String(page), "map.fit"),
      }),
    },
    navigate: (page, params) => send("navigate", String(page), params ? { ...params } : undefined),
    log: (...args) => send("log", ...args.map(safeString)),
  };
  return ctx;
}
