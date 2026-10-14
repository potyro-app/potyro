// Build the `ctx` handed to app functions (docs/04). Data/time/storage/media/ui/nav are always
// real (namespaced to the app via its own Store); `caps` are trust-mediated. Time is fixed at
// construction so computed values are deterministic within an evaluation pass.

import type { Ctx, CtxFiles, Field, FileRef, Id, PotyroRecord, MediaRef, Person, QuerySpec, Resolved, UiItem, Value, Words } from "potyro";
import { checkFormFields, localize, localizeFields, word } from "potyro";
import { formatLocaleFor, makeFormat, translate, type WordsContext } from "./format.js";
import { assertCountable, assertPatchFits, assertValuesFit, currentPeople, everyone } from "./values-gate.js";
import { fileInfo, fileSpace, isReservedPath, mimeOf, type FileSpace, type FileTarget, type Store } from "@potyro/store";
import type { Capabilities } from "@potyro/capabilities";
import { mediateCaps } from "./mediate.js";
import { assertNotAuthor, stampAuthor, stripAuthor } from "./authorship.js";
import { prefetchRelated, resolveRecord, type ResolveDeps } from "./resolve.js";
import type { LoadedApp, MakeCtxBase, ShownUiItem } from "./types.js";

const KV_PREFIX = "kv:";

/**
 * A sheet or menu's items, checked — each needs an id and a label, or there is nothing to choose —
 * and with their words in the language the app is shown in (#302).
 */
function checkItems<T>(opts: { title?: Words; items: UiItem<T>[] }, say: (w: Words | undefined) => string) {
  const items = opts?.items;
  if (!Array.isArray(items) || !items.length) throw new Error("ui.sheet / ui.menu need `items`: at least one { id, label }");
  for (const it of items) if (it == null || (typeof it.label !== "string" && (it.label == null || typeof it.label !== "object")) || it.id === undefined) throw new Error("every ui.sheet / ui.menu item needs an `id` and a `label`");
  return {
    ...(opts.title === undefined ? {} : { title: say(opts.title) }),
    items: items.map((it): ShownUiItem<T> => ({ ...it, label: say(it.label), detail: it.detail === undefined ? undefined : say(it.detail) })),
  };
}

/** The longest text `ui.share` hands on: a result, a message — never a document. */
const SHARE_MAX = 10_000;

/**
 * What `ui.share` hands the shell, checked: something to send, a link only if it is http(s) — the
 * share sheet opens it, so a `javascript:` or `file:` address must never get there — and words in
 * the language the app is shown in.
 */
export function checkShare(opts: { text?: Words; url?: string; title?: Words } | undefined, say: (w: Words | undefined) => string): { text?: string; url?: string; title?: string } {
  if (opts == null || typeof opts !== "object") throw new Error("ui.share needs { text } or { url }");
  const text = opts.text === undefined || opts.text === null ? undefined : say(opts.text);
  let url: string | undefined;
  if (opts.url !== undefined && opts.url !== null) {
    let parsed: URL;
    try {
      parsed = new URL(String(opts.url));
    } catch {
      throw new Error("ui.share: `url` must be a whole http(s) address");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("ui.share: `url` must be http(s)");
    url = parsed.href;
  }
  if (!text && !url) throw new Error("ui.share needs { text } or { url }");
  if (text && text.length > SHARE_MAX) throw new Error(`ui.share: \`text\` is longer than ${SHARE_MAX} characters`);
  return { ...(text ? { text } : {}), ...(url ? { url } : {}), ...(opts.title === undefined ? {} : { title: say(opts.title) }) };
}

/** The base language of a tag: "pt-BR" → "pt". */
const baseOf = (tag: string): string => tag.split("-")[0]!.toLowerCase();

/**
 * Stand-in identity for hosts built without one (tests, fakes, the Studio preview).
 *
 * `ctx.me` is always *present* — that is the contract app code is written against, and the reason
 * it never has to branch on whether sync exists. The composition root supplies the real person from
 * `@potyro/identity`; this only keeps a `MemoryStore` test from having to mint an account.
 */
const ANONYMOUS: Person = { id: "local", name: "Me" };

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function mediaUrl(store: Store, ref: MediaRef): Promise<string> {
  const blob = await store.getBlob(ref);
  if (!blob) return "";
  const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
  if (g.URL?.createObjectURL) return g.URL.createObjectURL(blob);
  // Node / non-DOM fallback: inline data URL.
  const bytes = Buffer.from(await blob.arrayBuffer());
  return `data:${ref.mime};base64,${bytes.toString("base64")}`;
}

/** `folder` + `name`, for a file arriving from outside. */
function joinPath(folder: string | undefined, name: string): string {
  const f = (folder ?? "").trim().replace(/^\/+|\/+$/g, "");
  return f ? `${f}/${name}` : name;
}

/**
 * The app's folder as the APP sees it: without `.modules/` and `.src/`, which hold its own code
 * (#266, #258). Those are checked against a lock before they run; an app that could write them
 * could not change what runs (the check refuses it), but it could break itself, and listing them
 * would show a person's notes app a folder of minified libraries.
 *
 * Earlier copies (#255) are the shell's, not the app's: the app sees one file per path.
 */
type AppFolder = Pick<FileSpace, "list" | "find" | "read" | "write" | "rename" | "remove">;

function appFolder(space: FileSpace): AppFolder {
  const refuse = (path: string): void => {
    if (isReservedPath(path)) throw new Error(`"${path}" is kept for the app's own code`);
  };
  const find = async (target: FileTarget) => {
    const f = await space.find(target);
    return f && !isReservedPath(f.path) ? f : null;
  };
  const mustFind = async (target: FileTarget) => {
    const f = await find(target);
    if (!f) throw new Error(`No file ${typeof target === "string" ? `"${target}"` : `"${target.path ?? target.name ?? target.id}"`} in this app`);
    return f;
  };
  return {
    list: async (folder) => (await space.list(folder)).filter((f) => !isReservedPath(f.path)),
    find,
    read: async (target) => space.read({ id: (await mustFind(target)).id }),
    write: async (path, data, opts) => {
      refuse(path);
      return space.write(path, data, opts);
    },
    rename: async (target, to) => {
      refuse(to);
      return space.rename({ id: (await mustFind(target)).id }, to);
    },
    remove: async (target) => space.remove({ id: (await mustFind(target)).id }),
  };
}

/**
 * `ctx.files` (#252): the app's own folder, over its own Store.
 *
 * `import` and `export` use the platform's file dialogs directly, NOT the trust-mediated `caps`: the
 * person picks every file in a system dialog, which is the consent, and what comes in lands only in
 * this app's folder. So they work the same for an app in the sealed box.
 */
export function filesFor(store: Store, caps: Capabilities): CtxFiles {
  const space = appFolder(fileSpace(store));
  const toBlob = (path: string, data: string | Uint8Array | Blob, mime?: string): Blob =>
    data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeOf(path, mime) });
  const name = (f: string | FileRef) => (typeof f === "string" ? f : (f.path ?? f.name ?? f.id));

  return {
    list: (folder) => space.list(folder),
    async stat(f) {
      const e = await space.find(f);
      return e ? fileInfo(e) : null;
    },
    async text(f) {
      const b = await space.read(f);
      return b ? b.text() : null;
    },
    async json<T = unknown>(f: string | FileRef): Promise<T | null> {
      const b = await space.read(f);
      if (!b) return null;
      try {
        return JSON.parse(await b.text()) as T;
      } catch (e) {
        throw new Error(`"${name(f)}" is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    async bytes(f) {
      const b = await space.read(f);
      return b ? new Uint8Array(await b.arrayBuffer()) : null;
    },
    async url(f) {
      const e = await space.find(f);
      if (!e) throw new Error(`No file "${name(f)}" in this app`);
      const url = await mediaUrl(store, { key: e.blob, mime: e.mime });
      return url || null;
    },
    write: (path, data, opts) => space.write(path, toBlob(path, data, opts?.mime), { mime: opts?.mime }),
    rename: (f, to) => space.rename(f, to),
    remove: (f) => space.remove(f),
    async import(opts) {
      const pick = caps.filesystem.pickFiles;
      if (!pick) throw new Error("This device cannot open files from outside the app");
      const chosen = await pick({ accept: opts?.accept, multiple: opts?.multiple });
      const landed = [];
      for (const file of chosen) {
        landed.push(await space.write(joinPath(opts?.folder, file.name), file, { origin: "imported", mime: file.type || undefined }));
      }
      return landed;
    },
    async export(f) {
      const e = await space.find(f);
      if (!e) throw new Error(`No file "${name(f)}" in this app`);
      const bytes = await space.read({ id: e.id });
      if (!bytes) throw new Error(`"${e.name}" has not reached this device yet`);
      await caps.filesystem.save(e.name, bytes);
    },
  };
}

export function buildCtx(app: LoadedApp, base: MakeCtxBase): Ctx {
  const { store, caps, ui, nav, views } = base;
  const fixedNow = base.now ?? new Date();
  const me = base.me ?? ANONYMOUS;

  // The app's words and the person's formats (#302). `language` comes from the runtime, which picked
  // it from the person's languages; an app that declares none is shown in the person's own.
  const formatLocale = base.formatLocale ?? formatLocaleFor(undefined, base.language ?? app.definition.language);
  const locale = base.language ?? app.definition.language ?? baseOf(formatLocale);
  const words: WordsContext = { language: locale, app: app.definition, formatLocale, now: () => fixedNow };
  const say = (w: Words | undefined): string => word(w, locale, app.definition);
  // The definition as the person reads it: messages about a value ("Amount must be a number.") name
  // the field the way the form does. Cached per definition and language, so this is free per pass.
  const shown = localize(app.definition, base.language);

  // Resolver dependencies. `ctx` is filled in after construction (computed fns receive it).
  // memo/computing are per-ctx → per evaluation pass (docs/04: now() is fixed per pass too).
  const deps: ResolveDeps = {
    definition: shown,
    store,
    callComputed: (entity, key, record, c) => app.callComputed(entity, key, record, c),
    ctx: undefined as unknown as Ctx,
    memo: new Map(),
    computing: new Set(),
    records: new Map(),
  };
  // Data changed: nothing this pass has read may be served again.
  const forget = (): void => {
    deps.memo.clear();
    deps.records?.clear();
  };

  // Resolve rows sequentially (not Promise.all): computed may call ctx.query and resolve shared
  // records, so a single-threaded resolution chain keeps the cycle guard's `computing` set a
  // valid stack (concurrent resolution of the same computed would look like a false cycle).
  // Memoization makes the repeated work cheap; personal scale makes the lost parallelism moot.
  const resolveMany = async (entity: string, rows: PotyroRecord[]): Promise<Resolved[]> => {
    await prefetchRelated(deps, entity, rows);
    const out: Resolved[] = [];
    for (const r of rows) out.push(await resolveRecord(deps, entity, r));
    return out;
  };

  const applySpec = (rows: Resolved[], spec?: QuerySpec): Resolved[] => {
    let out = rows;
    if (spec?.filter) out = out.filter((r) => spec.filter!(r));
    if (spec?.sort) out = [...out].sort(spec.sort);
    const offset = spec?.offset ?? 0;
    const end = spec?.limit != null ? offset + spec.limit : undefined;
    return offset || end != null ? out.slice(offset, end) : out;
  };

  const ctx: Ctx = {
    me,
    ...(base.space ? { space: base.space } : {}),

    async query(entity, spec) {
      const rows = await store.all(entity);
      const resolved = await resolveMany(entity, rows);
      return applySpec(resolved, spec);
    },

    async get(entity, id) {
      const raw = await store.get(entity, id);
      return raw ? resolveRecord(deps, entity, raw) : null;
    },

    async create(entity, data) {
      // `createdBy` is stamped HERE and the app's own value is dropped first (KA-18, authorship.ts).
      // Who entered a record is not who it is about (spike F5): that is a `member` field.
      const clean = stampAuthor(data, me.id);
      assertValuesFit(deps.definition, entity, clean, currentPeople(base.space, me));
      const row = await store.insert(entity, clean as Partial<PotyroRecord>);
      forget(); // data changed → invalidate memoized computed and related rows for this pass
      return resolveRecord(deps, entity, row);
    },

    async patch(entity, id, data) {
      // Authorship is a fact about the insert, so an edit can never change it (authorship.ts).
      const clean = stripAuthor(data);
      assertPatchFits(deps.definition, entity, clean, (await store.get(entity, id)) as Record<string, unknown> | null, {
        now: currentPeople(base.space, me),
        ever: everyone(store),
      });
      const row = await store.update(entity, id, clean as Partial<PotyroRecord>);
      forget();
      return resolveRecord(deps, entity, row);
    },

    async increment(entity, id, field, delta) {
      assertNotAuthor(field);
      assertCountable(deps.definition, entity, field);
      // Falls back rather than failing: only a CRDT store can add deltas up, and a local-only app is
      // single-writer anyway, so read-modify-write there is correct and has nothing to race with.
      if (store.increment) {
        await store.increment(entity, id, field, delta);
      } else {
        const current = await store.get(entity, id);
        const base = Number((current as Record<string, unknown> | null)?.[field] ?? 0);
        await store.update(entity, id, { [field]: base + delta } as Partial<PotyroRecord>);
      }
      forget();
      const row = await store.get(entity, id);
      if (!row) throw new Error(`increment: ${entity}/${id} not found`);
      return resolveRecord(deps, entity, row);
    },

    async delete(entity, id) {
      await store.delete(entity, id);
      forget();
    },

    async transaction(fn) {
      return store.transaction(async () => fn(ctx));
    },

    now() {
      return fixedNow;
    },
    today() {
      return startOfDay(fixedNow);
    },

    locale,
    t: (w, vars) => translate(w, vars, words),
    format: makeFormat(formatLocale, () => fixedNow),

    params: Object.freeze({ ...(base.params ?? {}) }),
    // Fixed per pass like `now()`: a filter must see the same selection for every row it judges.
    scope: Object.freeze({ ...(base.scope ?? {}) }),

    storage: {
      async get<T = unknown>(k: string): Promise<T | null> {
        const raw = await store.kvGet(KV_PREFIX + k);
        return raw == null ? null : (JSON.parse(raw) as T);
      },
      async set(k, v) {
        await store.kvSet(KV_PREFIX + k, JSON.stringify(v));
      },
      async delete(k) {
        await store.kvDelete(KV_PREFIX + k);
      },
      async keys(prefix) {
        const all = (await store.kvKeys?.(KV_PREFIX)) ?? [];
        return all
          .map((k) => k.slice(KV_PREFIX.length))
          .filter((k) => (prefix ? k.startsWith(prefix) : true));
      },
    },

    caps: mediateCaps({
      caps,
      provenance: app.provenance,
      permissions: app.permissions,
      ui,
      appName: say(app.definition.name),
    }),

    media: {
      put: (bytes) => store.putBlob(bytes),
      url: (ref) => mediaUrl(store, ref),
    },

    files: filesFor(store, caps),

    ui: {
      // Words in, strings out: a map shows in `ctx.locale`, so `toast({ en, pl })` never reads
      // "[object Object]" (#302).
      toast: (msg) => ui.toast(say(msg)),
      confirm: (msg, opts) =>
        ui.confirm(say(msg), opts && { ...opts, detail: opts.detail === undefined ? undefined : say(opts.detail), ok: opts.ok === undefined ? undefined : say(opts.ok), cancel: opts.cancel === undefined ? undefined : say(opts.cancel) }),
      prompt: (msg, opts) => ui.prompt(say(msg), opts),
      pick: (items, opts) => ui.pick(items, opts),
      sheet: async <T,>(opts: { title?: Words; items: UiItem<T>[] }) => (ui.sheet ? ui.sheet(checkItems(opts, say)) : null),
      menu: async <T,>(opts: { title?: Words; items: UiItem<T>[] }) => (ui.menu ? ui.menu(checkItems(opts, say)) : null),
      form: async <T,>(opts: { title: Words; fields: Record<string, Field>; initial?: Partial<T>; submit?: Words }) => {
        // Checked like an entity's fields, and before anything renders: a typo in a form is the app's
        // bug, and it should read as one rather than as a form that silently shows nothing.
        const issues = checkFormFields(opts?.fields, Object.keys(app.definition.entities));
        if (issues.length) throw new Error(issues.join("\n"));
        const form = {
          title: say(opts.title),
          fields: localizeFields(opts.fields, locale, app.definition),
          initial: opts.initial as Record<string, unknown> | undefined,
          ...(opts.submit === undefined ? {} : { submit: say(opts.submit) }),
        };
        return ((await ui.form?.(form)) ?? null) as T | null;
      },
      progress: (label) => ui.progress?.(say(label)) ?? { update: () => {}, done: () => {} },
      share: async (opts) => {
        const shared = checkShare(opts, say);
        return ui.share ? ui.share(shared) : false;
      },
    },

    // `camera` says where a map OPENS; this is the only thing that can move one afterwards, which is
    // why a "centre on me" button could not be written by an app before it existed.
    //
    // The page is resolved when the method is called, never held: a view is a thing on screen, and
    // an app that kept a handle would be holding a reference to something that has since been
    // unmounted. Nobody listening is `false` — a page that is not open cannot be moved, and that is
    // an answer rather than a crash in the middle of someone's action.
    views: {
      map: (pageId: string) => ({
        flyTo: (to) => views?.call?.(pageId, "map.flyTo", to) ?? Promise.resolve(false),
        fit: () => views?.call?.(pageId, "map.fit") ?? Promise.resolve(false),
      }),
    },

    navigate: (pageId, params) => nav.navigate(pageId, params),

    log: (...args) => {
      // Namespaced diagnostic; the shell may route this elsewhere.
      // eslint-disable-next-line no-console
      console.log(`[${app.definition.id}]`, ...args);
    },
  };

  deps.ctx = ctx;
  return ctx;
}

export type { Id, Value };
