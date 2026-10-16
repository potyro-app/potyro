// Add an app (#253): from files on this device, from a link, or from pasted source.
//
// Three ways in, one way through:
//
//   gather  → an AppPackage (source + its own modules + shipped files + a one-time seed)
//   inspect → what it would install as: name, icon, what it keeps, what it asks for, the libraries
//             it uses and whether they came with it, whether it is valid — from what the package
//             declares when it does (#271), else read in the sealed box. Then a test load in the
//             sealed box names what it reaches for that the box lacks. Nothing runs with authority
//             to answer that, and nothing is fetched.
//   install → fetch what its libraries still need (the card said so), save it, put its code and
//             shipped files in its folder, seed it the first time.
//
// Trust (owner, 2026-10-11): everything comes in sealed. A file from this device or pasted source may
// be marked "I wrote this, run it as mine" on the card; a link may not, it can be promoted later.
// The same app already installed: Replace is the default, through the ordinary update path, so
// History keeps the old version and the data check runs on the next open.
import { permissionWords } from "./capability-words.js";
import { t } from "@lingui/core/macro";
import { pickLanguage, word, type Words } from "potyro";
import { languagePrefs } from "./locale.js";
import { fileSpace, isReservedPath, isZip, MODULES_DIR, readAppPackage, sourcePackage, type AppCredit, type AppPackage, type PackagedFile, type Store } from "@potyro/store";
import { validateDefinition } from "./validate-app.js";
import { trySealed, type Trial } from "./app-trial.js";
import { inspectLibraries, libraryChanges, prepareCode, type LibraryLine, type PackageDeps } from "./package-libraries.js";
import { memoryModules, withLibrariesStoodIn, type ModuleSource } from "./package-modules.js";
import { freeAppId, getUserApp, listUserApps, removeUserApp, saveUserApp, seedToKeep, setUserAppShipped, type UserApp } from "./user-apps.js";
import { importChat, parseChatRecord } from "./studio-chat.js";
import { openAppStore, syncAllowedFor } from "./app-store.js";
import { openStore } from "./open-store.js";
import { sourceHttp } from "./ask-sources.js";
import { keepCode } from "./app-modules.js";
import { resolveSeedFiles } from "./seed-files.js";
import { derivedLine, newLine } from "./app-line.js";

export type AddSource = "file" | "link" | "paste";

/** A source file, by name: the app module itself rather than something it ships with. */
const SOURCE_RE = /\.(app\.)?[jt]sx?$/i;
const APP_SOURCE_RE = /\.app\.[jt]sx?$/i;

const bytesOf = async (f: Blob): Promise<Uint8Array> => new Uint8Array(await f.arrayBuffer());

/**
 * Files the person picked, as one package. A zip is a package. Otherwise one of them is the app's
 * source — the `*.app.ts(x)` if there is one, else the only script. Other scripts beside it are its
 * own modules (#258), which the source imports as `./plan.ts`; the rest ship with it, by name; a
 * `seed.json` among them is the seed.
 */
export async function gatherFromFiles(files: File[]): Promise<AppPackage> {
  if (!files.length) throw new Error(t`No file was chosen`);
  if (files.length === 1) {
    const bytes = await bytesOf(files[0]!);
    if (isZip(bytes)) return readAppPackage(bytes);
  }
  const zips = files.filter((f) => /\.zip$/i.test(f.name));
  if (zips.length) throw new Error(t`Choose a package zip on its own, or the app's source with the files it uses`);
  const apps = files.filter((f) => APP_SOURCE_RE.test(f.name));
  const scripts = files.filter((f) => SOURCE_RE.test(f.name));
  const source = apps.length === 1 ? apps[0] : apps.length === 0 && scripts.length === 1 ? scripts[0] : undefined;
  if (!source) {
    throw new Error(
      apps.length > 1 || scripts.length > 1
        ? t`More than one of these could be the app. Name the app's own file *.app.ts or *.app.tsx.`
        : t`None of these is an app: choose its source (a .ts or .tsx file) or a package zip.`,
    );
  }
  const modules: PackagedFile[] = [];
  for (const f of files) if (f !== source && SOURCE_RE.test(f.name)) modules.push({ path: f.name, data: await bytesOf(f) });
  const rest = files.filter((f) => f !== source && !SOURCE_RE.test(f.name));
  const seedFile = rest.find((f) => f.name === "seed.json");
  let seed: AppPackage["seed"];
  if (seedFile) {
    try {
      seed = JSON.parse(await seedFile.text());
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new Error(t`seed.json is not valid JSON: ${why}`);
    }
  }
  const shipped: PackagedFile[] = [];
  for (const f of rest) if (f !== seedFile) shipped.push({ path: f.name, data: await bytesOf(f), mime: f.type || undefined });
  return { source: await source.text(), sourceName: source.name, files: shipped, modules, seed, kind: "package" };
}

/**
 * A link to a source file or a package zip.
 *
 * The browser's own fetch first: it can carry a zip's bytes. If the host refuses a browser (CORS),
 * the native app's HTTP stack is tried, which has no CORS but returns text — enough for a source,
 * not for a zip, and a zip that arrives as text is said to be one rather than misread.
 */
/** The errors that are the link's own answer, so a second attempt does not replace them with a vaguer one. */
const answeredErrors = new WeakSet<Error>();
function linkAnswered(status: number): Error {
  const e = new Error(t`The link answered ${status}`);
  answeredErrors.add(e);
  return e;
}

export async function gatherFromLink(url: string): Promise<AppPackage> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(t`That is not a link`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(t`Only http and https links can be fetched`);
  let bytes: Uint8Array;
  try {
    const res = await globalThis.fetch(parsed.href, { redirect: "follow" });
    if (!res.ok) throw linkAnswered(res.status);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (first) {
    let text: string;
    try {
      const res = await sourceHttp(parsed.href, { method: "GET" });
      if (!res.ok) throw linkAnswered(res.status);
      text = await res.text();
    } catch {
      throw first instanceof Error && answeredErrors.has(first) ? first : new Error(t`The link could not be fetched from here`);
    }
    if (text.startsWith("PK")) throw new Error(t`This link is a package zip, which this device can only fetch from a host that allows it. Download it and add it as a file.`);
    return sourcePackage(text, parsed.pathname.split("/").pop() || "app.tsx");
  }
  if (isZip(bytes)) return readAppPackage(bytes);
  return sourcePackage(new TextDecoder().decode(bytes), parsed.pathname.split("/").pop() || "app.tsx");
}

export function gatherFromPaste(text: string): AppPackage {
  if (!text.trim()) throw new Error(t`Paste the app's source first`);
  return sourcePackage(text);
}

/** What the card shows. */
export interface Inspected {
  id: string;
  name: string;
  icon?: string;
  /** The entities it keeps, by label. */
  keeps: string[];
  /** The same, by id: what a seed may fill. */
  entityIds: string[];
  /** The device capabilities it declares. */
  asks: string[];
  /** Structure problems. Non-empty means it would not install. */
  issues: string[];
  /** The installed app with the same id, if any. */
  installed?: UserApp;
  files: Array<{ path: string; size: number }>;
  seedRows: number;
  /** The libraries it imports by URL (#266), and whether they came with it or are fetched on Add. */
  libraries: LibraryLine[];
  /** Its own modules beside the source (#258), by path. */
  modules: string[];
  /**
   * Where the card's facts came from (#271): what the package declares (nothing was run to draw it),
   * the app read in the sealed box, or neither — it could not be previewed, and the card says so.
   */
  preview: "declared" | "read" | "unavailable";
  /** Why it could not be previewed, when it could not. */
  previewProblem?: string;
  /**
   * Set when one of its libraries does not start in the sealed box — it needs a full web page. The
   * app then works only once it runs as yours. Known only once the library's bytes are here.
   */
  sealedProblem?: string;
  /**
   * What the test load in the sealed box found it reaches for and the box does not have, in plain
   * words (#271): "date and number formatting (Intl)". Empty when nothing was missing or it was not tried.
   */
  missing: string[];
  /** Its top level threw in the sealed box: there it would not open at all, not just miss a part. */
  failsToOpenSealed: boolean;
  /** Its top level threw in the sealed box for another reason: it could not be tried there. */
  trialProblem?: string;
  /** It draws some of its screens itself (a custom view, #267): sealed, they run in their own sandboxed frames. */
  ownScreens: boolean;
  /** Who made it, when its package says (docs/24 §6). */
  credit?: AppCredit;
}


interface AppFacts {
  id?: string;
  /** Words (#302): a string, or a map by language for an app in several. */
  name?: Words;
  icon?: string;
  entities?: Record<string, { label?: Words } | undefined>;
  permissions?: Record<string, unknown>;
  language?: string;
  languages?: string[];
  pages?: Array<{ view?: { type?: string }; layout?: { items?: Array<{ view?: { type?: string } }> } } | undefined>;
}

/** Whether any page draws itself (`type: "custom"`): from what was read, or, failing that, the source's text. */
function drawsOwnScreens(facts: AppFacts, source: string): boolean {
  const pages = facts.pages ?? [];
  if (pages.length) return pages.some((p) => p?.view?.type === "custom" || (p?.layout?.items ?? []).some((i) => i?.view?.type === "custom"));
  return /type\s*:\s*["']custom["']/.test(source);
}

/** An app's own words, in the language the person will see it in: the card must never show `{ en, pl }`. */
function shownIn(facts: AppFacts): (w: Words | undefined) => string | undefined {
  const app = { language: facts.language, languages: facts.languages };
  const language = pickLanguage(languagePrefs(), app);
  return (w) => (w == null ? undefined : word(w, language, app));
}

const asksOf = (permissions: Record<string, unknown> | undefined): string[] => permissionWords(permissions);

/**
 * The id and name of an app that could not be read at all, from its text: enough for a card that says
 * so. The first `id:` and `name:` in a source are, in practice, the app's own — `defineApp({ id, name`.
 */
function sketchOf(source: string): AppFacts {
  const id = /\bid\s*:\s*["'`]([a-z0-9][a-z0-9-]*)["'`]/.exec(source)?.[1];
  const name = /\bname\s*:\s*["'`]([^"'`\n]{1,80})["'`]/.exec(source)?.[1];
  return { id, name };
}

/**
 * Whether the app, with its libraries really here, works in the sealed box. A library fetched only at
 * install could not be tried when the card was drawn, so an app that will run sealed is tried again
 * once it has them: the person hears it now, not from an app that does not open.
 */
async function sealedCheck(source: string, modules: ModuleSource): Promise<{ sealedProblem?: string; missing: string[] }> {
  const trial = await trySealed(source, modules, { smoke: true });
  return { sealedProblem: trial.libraryProblem, missing: trial.missing };
}

/**
 * What a package would install as (#253), for the card.
 *
 * The card never needs the code to run (#271): a package that declares what the app is (its
 * manifest) is described from that. The app is then TRIED in the sealed box — the box it will run in
 * unless the person says it is theirs — with sample records, and what it reached for that the box
 * does not have is named. A package that declares nothing is read in the sealed box instead; if that
 * fails, the card still comes up, says the app could not be previewed, and does not call it broken.
 */
export async function inspectPackage(pkg: AppPackage, deps: PackageDeps = {}): Promise<Inspected> {
  const libs = await inspectLibraries(pkg, deps);
  // With every library here the trial runs the real thing; one still to be fetched stands in as an
  // inert value, enough for the app to say what it is but not to try it.
  const allHere = libs.lines.every((l) => l.here);
  const declared = pkg.declared;
  let trial: Trial | undefined = declared && !allHere ? undefined : await trySealed(pkg.source, libs.modules, { standIns: !allHere, smoke: allHere });
  let read = trial?.definition as AppFacts | undefined;
  if (!declared && !read && trial?.libraryProblem) {
    // The app may be fine and one of its libraries not, in the sealed box: read it without them.
    const again = await trySealed(pkg.source, withLibrariesStoodIn(libs.modules), { standIns: true });
    read = again.definition as AppFacts | undefined;
    if (read) trial = { ...trial, definition: read, issues: again.issues };
  }
  const loaded = trial?.definition as AppFacts | undefined;
  const facts: AppFacts = (declared as AppFacts | undefined) ?? read ?? sketchOf(pkg.source);
  if (!facts.id) {
    const unreadable = trial?.unreadable;
    throw new Error(unreadable ? t`This app could not be read: ${unreadable}` : t`This source does not define an app (no \`defineApp\` with an id)`);
  }
  const preview: Inspected["preview"] = declared ? "declared" : read ? "read" : "unavailable";
  const issues = [...libs.issues, ...(declared ? validateDefinition(declared) : (trial?.issues ?? []))];
  if (trial?.unreadable) {
    const unreadable = trial.unreadable;
    issues.push(t`It could not be read: ${unreadable}`);
  }
  if (declared && loaded?.id && loaded.id !== declared.id) {
    const said = declared.id;
    const code = loaded.id;
    issues.push(t`Its description says it is “${said}”, and its code says “${code}”, so it was not added.`);
  }
  // What it really asks for, once it loaded, joins what it says it asks for: the card never shows less.
  const asks = [...asksOf(facts.permissions), ...asksOf(loaded?.permissions)];
  const say = shownIn(facts);
  return {
    id: facts.id,
    name: say(facts.name) || facts.id,
    icon: facts.icon,
    keeps: Object.entries(facts.entities ?? {}).map(([k, e]) => say(e?.label) || k),
    entityIds: Object.keys(facts.entities ?? {}),
    asks: [...new Set(asks)],
    issues,
    installed: getUserApp(facts.id),
    files: pkg.files.filter((f) => !isReservedPath(f.path)).map((f) => ({ path: f.path, size: f.data.byteLength })),
    seedRows: Object.values(pkg.seed ?? {}).reduce((n, rows) => n + rows.length, 0),
    libraries: libs.lines,
    modules: pkg.modules.map((m) => m.path),
    preview,
    ...(preview === "unavailable" ? { previewProblem: trial?.unreadable ?? trial?.loadFailed } : {}),
    sealedProblem: trial?.libraryProblem,
    missing: trial?.missing ?? [],
    failsToOpenSealed: !!trial?.loadFailed,
    ...(trial?.loadFailed && !trial.missing.length && !trial.libraryProblem && preview !== "unavailable" ? { trialProblem: trial.loadFailed } : {}),
    ownScreens: drawsOwnScreens(facts, pkg.source),
    ...(pkg.credit ? { credit: pkg.credit } : {}),
  };
}

export interface ShippedResult {
  written: string[];
  /** Shipped files the person changed since install: kept as they are. */
  kept: string[];
  /** Shipped files the new version no longer has. */
  removed: string[];
}

/**
 * Put a package's files in the app's folder as `shipped`. On an update, a shipped file is replaced
 * unless the person changed it since (it is then `app`, not `shipped`), and a shipped file the new
 * version dropped goes, unless the person changed it. The app's code (`.modules/`, `.src/`) is
 * never "changed by the person": it is always the new version's — and a library's old bytes stay.
 */
export async function applyShippedFiles(store: Store, files: PackagedFile[], opts: { update: boolean }): Promise<ShippedResult> {
  const space = fileSpace(store);
  const result: ShippedResult = { written: [], kept: [], removed: [] };
  const incoming = new Set<string>();
  for (const f of files) {
    const existing = await space.find(f.path);
    incoming.add(existing?.path ?? f.path);
    if (existing && existing.origin !== "shipped" && !isReservedPath(existing.path)) {
      result.kept.push(existing.path);
      continue;
    }
    const info = await space.write(f.path, new Blob([f.data as BlobPart], f.mime ? { type: f.mime } : {}), { origin: "shipped", mime: f.mime });
    result.written.push(info.path);
  }
  if (opts.update) {
    for (const f of await space.list()) {
      // A library's bytes stay when a newer version stops using them: they are named by their digest,
      // so they never clash, and History can go back to the version that ran them (#266).
      if (f.origin === "shipped" && !incoming.has(f.path) && !f.path.startsWith(MODULES_DIR)) {
        await space.remove(f.path);
        result.removed.push(f.path);
      }
    }
  }
  return result;
}

/**
 * Insert a package's first records. Only entities the app declares; a row's own fields as given —
 * except a photo named by a file the app shipped with, `{ "file": "photos/x.webp" }`, which becomes
 * the record's own copy of that picture (seed-files.ts). Its shipped files must be in its folder first.
 */
export async function applySeed(store: Store, seed: AppPackage["seed"], entities: readonly string[]): Promise<number> {
  let n = 0;
  for (const [entity, rows] of Object.entries(seed ?? {})) {
    if (!entities.includes(entity)) continue;
    for (const row of rows) {
      await store.insert(entity, (await resolveSeedFiles(store, row)) as never);
      n++;
    }
  }
  return n;
}

export interface InstallOptions extends PackageDeps {
  source: AddSource;
  /** "I wrote this, run it as mine". Ignored for a link: a link is never trusted on the way in. */
  mine: boolean;
  /** When the app is already installed. */
  mode: "replace" | "copy";
  link?: string;
  /**
   * A remix (docs/24 §6): the person's own copy to change, so its credit is "a remix of" the app it
   * came from, not that app's. Trust is the same as any app from a link: sealed. Always a new app, under
   * an id of its own: never the original's, so nothing written for the original (an example's first-run
   * records, its conversation) lands in it.
   */
  remix?: boolean;
  /**
   * Whether its first records go in (default yes). Off, it starts empty. Only ever the package's own
   * sample records (docs/24 §3) — a remix of an app on this device is made from its demo package,
   * never from its store.
   */
  seed?: boolean;
  /** Where its data opens. Injected in tests. */
  openStore?: (app: UserApp, opts: { sync: boolean }) => Promise<Store>;
  now?: string;
}

export interface Installed {
  app: UserApp;
  updated: boolean;
  files: ShippedResult;
  seeded: number;
  /** Set when it runs in the sealed box and one of its libraries, fetched just now, cannot start there. */
  sealedProblem?: string;
  /** What it reaches for that the sealed box lacks, found once the libraries fetched just now were here (#271). */
  missing?: string[];
}

export async function installPackage(pkg: AppPackage, inspected: Inspected, opts: InstallOptions): Promise<Installed> {
  if (inspected.issues.length) {
    const problems = inspected.issues.join("\n");
    throw new Error(t`This app has problems and was not added:\n${problems}`);
  }
  const now = opts.now ?? new Date().toISOString();
  const existing = inspected.installed;
  const update = !!existing && opts.mode === "replace";
  const trusted = opts.source !== "link" && opts.mine;
  const from = opts.source === "link" ? (opts.link ?? "a link") : opts.source === "file" ? "a file" : "pasted source";
  // An update from a file or paste keeps the trust the app had: replacing your own app with a newer
  // build of it must not drop it into the sealed box. From a link it never does — a link must not be
  // able to put new code into an app that runs with full authority.
  const runsAsMine = update && opts.source !== "link" ? existing!.trusted === true || trusted : trusted;
  // Before anything is saved: a library that cannot be fetched or does not match leaves nothing behind.
  const code = await prepareCode(pkg, opts);
  const { sealedProblem, missing } =
    !runsAsMine && !inspected.sealedProblem && inspected.libraries.some((l) => !l.here)
      ? await sealedCheck(pkg.source, memoryModules(code.lock, new Map(code.files.map((f) => [f.path, f.data]))))
      : { sealedProblem: undefined, missing: [] as string[] };
  const remix = !update && opts.remix ? remixOf(pkg.credit, inspected.name) : undefined;
  const app = await saveUserApp(
    {
      id: remix ? freeAppId(`${inspected.id}-remix`) : update ? existing!.id : existing ? freeAppId(inspected.name) : inspected.id,
      name: remix ? remixName(inspected.name) : inspected.name,
      source: pkg.source,
      trusted: runsAsMine,
      link: opts.source === "link" ? opts.link : undefined,
      lock: code.lock,
      origin: "imported",
      // The sample records it came with, kept for a demo link of it (docs/24 §3) — never the
      // person's own: these are the package's, not what they have added since.
      seed: seedToKeep(pkg.seed),
      // Who made it travels with it; a remix says what it remixed instead (docs/24 §6). An update keeps
      // what the app already said about itself.
      ...(update ? {} : remix ? { remixOf: remix } : pkg.credit ? { credit: pkg.credit } : {}),
      // Which app it is (docs/24 §11): a kept copy is the same app, so its links open here too. A remix
      // is an app of its own, which remembers what it remixed; a package that did not say is known by
      // its declared id. An update keeps the line the app had (`saveUserApp`), or takes the package's.
      ...(remix ? { line: newLine(), lineOf: pkg.line ?? derivedLine(inspected.id) } : pkg.line ? { line: pkg.line } : {}),
      // A library upgrade may change no line of the source: the note says what it did change. A remix's
      // says what it is a remix of, so History keeps the credit with the app's first version.
      note: remix ? remixNote(remix) : [update ? `Updated from ${from}` : `Added from ${from}`, update ? libraryChanges(existing!.lock, code.lock) : ""].filter(Boolean).join(" · "),
    },
    now,
  );
  // A package that brings its own first records is not also given the example's: the example seeders
  // are keyed on the app id, so keeping a shared Groceries listed every item twice (docs/24 §3).
  const seeds = opts.seed !== false;
  const hasSeed = !update && seeds && Object.values(pkg.seed ?? {}).some((rows) => rows.length > 0);
  // A remix opens its store as it is: whatever it starts with is what the person chose on the card.
  const open = opts.openStore ?? ((a: UserApp, o: { sync: boolean }) => (hasSeed || remix ? openStore(`user:${a.id}`, o) : openAppStore(a, o)));
  const theirs = (paths: string[]) => paths.filter((p) => !isReservedPath(p));
  let files: ShippedResult;
  let seeded: number;
  try {
    const synced = await syncAllowedFor(app);
    const store = await open(app, { sync: synced });
    // An app whose data syncs keeps its code on this device, never in its space (#281): a library's
    // bytes are megabytes, and every device fetches its own copy from where the lock says.
    const shipped = await applyShippedFiles(store, synced ? code.files.filter((f) => !isReservedPath(f.path)) : code.files, { update });
    if (synced) await keepCode(app.id, code.files.filter((f) => isReservedPath(f.path)));
    // Read back, not assumed: an app is only added once every file it shipped with is in its folder.
    await assertShipped(store, code.files.filter((f) => !synced || !isReservedPath(f.path)).map((f) => f.path));
    // What a person reads afterwards is about THEIR files, not the app's code.
    files = { written: theirs(shipped.written), kept: theirs(shipped.kept), removed: theirs(shipped.removed) };
    seeded = update || !seeds ? 0 : await applySeed(store, pkg.seed, inspected.entityIds);
  } catch (e) {
    // Never a "working" app without its files. A new app is taken away again, so trying again is a
    // first install; an update keeps the app it was, and trying again writes the files again.
    if (!update) await removeUserApp(app.id);
    const why = e instanceof Error ? e.message : String(e);
    const name = app.name;
    throw new Error(update ? t`“${name}” was not fully updated: its files could not be saved. ${why}` : t`“${name}” was not added: its files could not be saved. ${why}`);
  }
  setUserAppShipped(app.id, theirs(code.files.map((f) => f.path)));
  // How it was made, when its author chose to send that too (#261). Only on a first install: an
  // update must not overwrite the conversation the person has had with it since. Anything that is
  // not a conversation is ignored rather than refusing the app.
  const chat = pkg.chat === undefined || update ? null : parseChatRecord(pkg.chat);
  if (chat) await importChat(app.id, chat, now);
  return { app: getUserApp(app.id) ?? app, updated: update, files, seeded, sealedProblem, ...(missing.length ? { missing } : {}) };
}

/**
 * What a remix credits (docs/24 §6): the shared app's own credit, or — when it came with none, as an app
 * from a file or one made on another device by someone who did not say — just its name. Honest either
 * way: "Remix of Groceries by Ana" when the link said Ana made it, "Remix of Groceries" when nobody said.
 */
export function remixOf(credit: AppCredit | undefined, name: string): AppCredit {
  return credit ?? { name };
}

/** The remix's name: the original's, unless an app here is already called that — then "Groceries (remix)". */
export function remixName(name: string): string {
  const taken = listUserApps().some((a) => a.name === name);
  return taken ? t({ message: `${name} (remix)`, comment: "The name of a remix when an app here already has the original's name" }) : name;
}

/**
 * The note on a remix's first version, in English on purpose — notes are stored and travel, and
 * `shownNote` (version-notes.ts) recognises and translates this one where it is read.
 */
export function remixNote(of: AppCredit): string {
  return of.by ? `remix of “${of.name}” by ${of.by}` : `remix of “${of.name}”`;
}

/** Every one of these paths is in the store's file space, or this says which are not. */
async function assertShipped(store: Store, paths: readonly string[]): Promise<void> {
  const space = fileSpace(store);
  const absent: string[] = [];
  for (const path of paths) if (!(await space.find(path))) absent.push(path);
  if (absent.length) {
    const list = absent.join(", ");
    throw new Error(t`These files did not land in its folder: ${list}.`);
  }
}
