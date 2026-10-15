// A scripted ctx for the app's live logic: records in memory, `ctx.storage`, the bits of `ctx.ui` the
// app uses, and `ctx.caps.network.socket` answering from a script — a socket the test drives, or a
// refusal with a code — so the connection's whole life is tested without a network.
import type { Ctx, Resolved, Socket, SocketClose, SocketData } from "potyro";
import { sayIn } from "./say.js";

export class FakeSocket implements Socket {
  readonly url: string;
  readonly protocol = "";
  readyState: Socket["readyState"] = "open";
  sent: string[] = [];
  private messages: Array<(d: SocketData) => void> = [];
  private closes: Array<(c: SocketClose) => void> = [];
  constructor(url: string) {
    this.url = url;
  }
  async send(d: SocketData): Promise<void> {
    if (this.readyState !== "open") throw Object.assign(new Error("closed"), { code: "closed" });
    this.sent.push(String(d));
  }
  onMessage(cb: (d: SocketData) => void): () => void {
    this.messages.push(cb);
    return () => void (this.messages = this.messages.filter((c) => c !== cb));
  }
  onClose(cb: (c: SocketClose) => void): () => void {
    this.closes.push(cb);
    return () => void (this.closes = this.closes.filter((c) => c !== cb));
  }
  close(): void {
    this.end("app", 1000);
  }
  /** The server sends a text message. */
  push(text: string): void {
    for (const cb of this.messages) cb(text);
  }
  /** It ends, for this reason. */
  end(why: SocketClose["why"], code = 1006): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    for (const cb of this.closes) cb({ code, reason: "", why });
  }
}

export type SocketAnswer = "open" | "denied" | "hidden" | "offline" | "unreachable" | "refused" | "not-allowed-host";

export interface Fake {
  ctx: Ctx;
  records: Map<string, Map<string, Record<string, unknown>>>;
  rows(entity: string): Array<Record<string, unknown>>;
  sockets: FakeSocket[];
  /** What each `socket()` call is answered with, in turn; "open" once they run out. */
  answers: SocketAnswer[];
  opened: string[];
  toasts: string[];
  fetched: string[];
  storage: Map<string, unknown>;
  /** The answer `ctx.ui.menu` / `form` gives. */
  menu: unknown;
  form: Record<string, unknown> | null;
  notified: Array<{ title: string; body?: string }>;
}

export function fakeCtx(o: { language?: string; fetch?: (url: string) => unknown; notifications?: boolean; geo?: { lat: number; lng: number } | null; now?: Date } = {}): Fake {
  const say = sayIn(o.language ?? "en");
  const records = new Map<string, Map<string, Record<string, unknown>>>();
  let seq = 0;
  const table = (e: string) => {
    let t = records.get(e);
    if (!t) records.set(e, (t = new Map()));
    return t;
  };
  const w = (x: unknown) => (typeof x === "string" ? x : say.t(x as never));
  const f: Fake = {
    ctx: null as unknown as Ctx,
    records,
    rows: (e) => [...table(e).values()],
    sockets: [],
    answers: [],
    opened: [],
    toasts: [],
    fetched: [],
    storage: new Map(),
    menu: null,
    form: null,
    notified: [],
  };
  const ctx = {
    ...say,
    now: () => o.now ?? new Date(),
    today: () => new Date(),
    params: {},
    async query(entity: string, spec?: { filter?: (r: Resolved) => boolean; limit?: number }) {
      let rows = [...table(entity).values()].map((r) => ({ ...r }) as Resolved);
      if (spec?.filter) rows = rows.filter(spec.filter);
      if (spec?.limit != null) rows = rows.slice(0, spec.limit);
      return rows;
    },
    async get(entity: string, id: string) {
      const r = table(entity).get(id);
      return r ? ({ ...r } as Resolved) : null;
    },
    async create(entity: string, data: Record<string, unknown>) {
      const id = `${entity}-${++seq}`;
      const r = { ...data, id };
      table(entity).set(id, r);
      return { ...r } as Resolved;
    },
    async patch(entity: string, id: string, data: Record<string, unknown>) {
      const r = table(entity).get(id);
      if (!r) throw new Error(`no ${entity} ${id}`);
      Object.assign(r, data);
      return { ...r } as Resolved;
    },
    async delete(entity: string, id: string) {
      table(entity).delete(id);
    },
    storage: {
      get: async (k: string) => (f.storage.has(k) ? structuredClone(f.storage.get(k)) : null),
      set: async (k: string, v: unknown) => void f.storage.set(k, structuredClone(v)),
      delete: async (k: string) => void f.storage.delete(k),
      keys: async () => [...f.storage.keys()],
    },
    ui: {
      toast: (m: unknown) => void f.toasts.push(w(m)),
      menu: async () => f.menu,
      form: async () => f.form,
    },
    caps: {
      network: {
        fetch: async (url: string) => {
          f.fetched.push(url);
          const body = o.fetch?.(url);
          if (body instanceof Error) throw body;
          return new Response(JSON.stringify(body ?? {}), { status: body === undefined ? 404 : 200, headers: { "content-type": "application/json" } });
        },
        socket: async (url: string) => {
          f.opened.push(url);
          const answer = f.answers.shift() ?? "open";
          if (answer !== "open") throw Object.assign(new Error(answer), { code: answer });
          const s = new FakeSocket(url);
          f.sockets.push(s);
          return s;
        },
      },
      ...(o.notifications ? { notifications: { schedule: async (n: { title: string; body?: string }) => void f.notified.push(n), cancel: async () => {}, supportsExactScheduling: true } } : {}),
      ...(o.geo !== undefined ? { geo: { current: async () => (o.geo ? o.geo : Promise.reject(new Error("denied"))) } } : {}),
    },
  } as unknown as Ctx;
  f.ctx = ctx;
  return f;
}

/** Let queued promise callbacks run. */
export const settle = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
  // setImmediate, which the tests' fake timers leave alone.
  await new Promise((r) => setImmediate(r));
};
