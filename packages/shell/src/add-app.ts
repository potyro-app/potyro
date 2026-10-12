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
import { fileSpace, isReservedPath, isZip, MODULES_DIR, readAppPackage, sourcePackage, type AppPackage, type PackagedFile, type Store } from "@potyro/store";
import { validateDefinition } from "./validate-app.js";
import { trySealed, type Trial } from "./app-trial.js";
import { inspectLibraries, libraryChanges, prepareCode, type LibraryLine, type PackageDeps } from "./package-libraries.js";
import { memoryModules, type ModuleSource } from "./package-modules.js";
import { freeAppId, getUserApp, saveUserApp, type UserApp } from "./user-apps.js";
import { importChat, parseChatRecord } from "./studio-chat.js";
import { openAppStore, syncAllowedFor } from "./app-store.js";
import { sourceHttp } from "./ask-sources.js";

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
  if (!files.length) throw new Error("No file was chosen");
  if (files.length === 1) {
    const bytes = await bytesOf(files[0]!);
    if (isZip(bytes)) return readAppPackage(bytes);
  }
  const zips = files.filter((f) => /\.zip$/i.test(f.name));
  if (zips.length) throw new Error("Choose a package zip on its own, or the app's source with the files it uses");
  const apps = files.filter((f) => APP_SOURCE_RE.test(f.name));
  const scripts = files.filter((f) => SOURCE_RE.test(f.name));
  const source = apps.length === 1 ? apps[0] : apps.length === 0 && scripts.length === 1 ? scripts[0] : undefined;
  if (!source) {
    throw new Error(
      apps.length > 1 || scripts.length > 1
        ? "More than one of these could be the app. Name the app's own file *.app.ts or *.app.tsx."
        : "None of these is an app: choose its source (a .ts or .tsx file) or a package zip.",
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
      throw new Error(`seed.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
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
export async function gatherFromLink(url: string): Promise<AppPackage> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("That is not a link");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http and https links can be fetched");
  let bytes: Uint8Array;
  try {
    const res = await globalThis.fetch(parsed.href, { redirect: "follow" });
    if (!res.ok) throw new Error(`The link answered ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (first) {
    let text: string;
    try {
      const res = await sourceHttp(parsed.href, { method: "GET" });
      if (!res.ok) throw new Error(`The link answered ${res.status}`);
      text = await res.text();
    } catch {
      throw first instanceof Error && /answered/.test(first.message) ? first : new Error("The link could not be fetched from here");
    }
    if (text.startsWith("PK")) throw new Error("This link is a package zip, which this device can only fetch from a host that allows it. Download it and add it as a file.");
    return sourcePackage(text, parsed.pathname.split("/").pop() || "app.tsx");
  }
  if (isZip(bytes)) return readAppPackage(bytes);
  return sourcePackage(new TextDecoder().decode(bytes), parsed.pathname.split("/").pop() || "app.tsx");
}

export function gatherFromPaste(text: string): AppPackage {
  if (!text.trim()) throw new Error("Paste the app's source first");
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
}

const CAP_WORDS: Record<string, string> = {
  camera: "camera",
  notifications: "notifications",
  geo: "location",
  geolocation: "location",
  filesystem: "files outside the app",
  network: "the internet",
  haptics: "vibration",
  sync: "sharing",
};

/** The same modules with no libraries: each then stands in, so the rest of the app can be read. */
const withoutLibraries = (m: ModuleSource): ModuleSource => ({
  lock: Object.fromEntries(Object.entries(m.lock).filter(([k]) => !/^https?:\/\//.test(k))),
  read: m.read,
});

interface AppFacts {
  id?: string;
  name?: string;
  icon?: string;
  entities?: Record<string, { label?: string } | undefined>;
  permissions?: Record<string, unknown>;
}

const asksOf = (permissions: Record<string, unknown> | undefined): string[] =>
  Object.entries(permissions ?? {})
    .filter(([, v]) => v)
    .map(([k]) => CAP_WORDS[k] ?? k);

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
    const again = await trySealed(pkg.source, withoutLibraries(libs.modules), { standIns: true });
    read = again.definition as AppFacts | undefined;
    if (read) trial = { ...trial, definition: read, issues: again.issues };
  }
  const loaded = trial?.definition as AppFacts | undefined;
  const facts: AppFacts = (declared as AppFacts | undefined) ?? read ?? sketchOf(pkg.source);
  if (!facts.id) {
    throw new Error(trial?.unreadable ? `This app could not be read: ${trial.unreadable}` : "This source does not define an app (no `defineApp` with an id)");
  }
  const preview: Inspected["preview"] = declared ? "declared" : read ? "read" : "unavailable";
  const issues = [...libs.issues, ...(declared ? validateDefinition(declared) : (trial?.issues ?? []))];
  if (trial?.unreadable) issues.push(`It could not be read: ${trial.unreadable}`);
  if (declared && loaded?.id && loaded.id !== declared.id) issues.push(`Its description says it is “${declared.id}”, and its code says “${loaded.id}”, so it was not added.`);
  // What it really asks for, once it loaded, joins what it says it asks for: the card never shows less.
  const asks = [...asksOf(facts.permissions), ...asksOf(loaded?.permissions)];
  return {
    id: facts.id,
    name: facts.name ?? facts.id,
    icon: facts.icon,
    keeps: Object.entries(facts.entities ?? {}).map(([k, e]) => e?.label ?? k),
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

/** Insert a package's first records. Only entities the app declares; a row's own fields as given. */
export async function applySeed(store: Store, seed: AppPackage["seed"], entities: readonly string[]): Promise<number> {
  let n = 0;
  for (const [entity, rows] of Object.entries(seed ?? {})) {
    if (!entities.includes(entity)) continue;
    for (const row of rows) {
      await store.insert(entity, row as never);
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
  if (inspected.issues.length) throw new Error(`This app has problems and was not added:\n${inspected.issues.join("\n")}`);
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
  const app = await saveUserApp(
    {
      id: update ? existing!.id : existing ? freeAppId(inspected.name) : inspected.id,
      name: inspected.name,
      source: pkg.source,
      trusted: runsAsMine,
      link: opts.source === "link" ? opts.link : undefined,
      lock: code.lock,
      origin: "imported",
      // A library upgrade may change no line of the source: the note says what it did change.
      note: [update ? `Updated from ${from}` : `Added from ${from}`, update ? libraryChanges(existing!.lock, code.lock) : ""].filter(Boolean).join(" · "),
    },
    now,
  );
  const open = opts.openStore ?? ((a: UserApp, o: { sync: boolean }) => openAppStore(a, o));
  const store = await open(app, { sync: await syncAllowedFor(app) });
  const shipped = await applyShippedFiles(store, code.files, { update });
  // What a person reads afterwards is about THEIR files, not the app's code.
  const theirs = (paths: string[]) => paths.filter((p) => !isReservedPath(p));
  const files: ShippedResult = { written: theirs(shipped.written), kept: theirs(shipped.kept), removed: theirs(shipped.removed) };
  const seeded = update ? 0 : await applySeed(store, pkg.seed, inspected.entityIds);
  // How it was made, when its author chose to send that too (#261). Only on a first install: an
  // update must not overwrite the conversation the person has had with it since. Anything that is
  // not a conversation is ignored rather than refusing the app.
  const chat = pkg.chat === undefined || update ? null : parseChatRecord(pkg.chat);
  if (chat) await importChat(app.id, chat, now);
  return { app, updated: update, files, seeded, sealedProblem, ...(missing.length ? { missing } : {}) };
}
