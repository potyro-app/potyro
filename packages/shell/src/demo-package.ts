// The package a demo link carries (docs/24 §2–§3): the app, its own code, the files it shipped
// with, and demo records — never the sharer's records.
//
// It is an ordinary `potyro-app/1` zip (#253), so the device that opens the link reads it with the
// same `readAppPackage` as any package, and "Keep this app" puts it through the same Add-an-app card.
//
// What is left out on purpose:
//   - the app's records, and every file the person added or the app wrote: only `origin: shipped`
//     files travel, by path;
//   - its libraries' bytes: the lock says where each comes from and what it must hash to, and the
//     device that opens the link fetches it from there, with consent, as on any install (#266).
import { fileSpace, isReservedPath, MemoryStore, packAppPackage, SRC_DIR, type AppCredit, type PackagedFile, type Store } from "@potyro/store";
import type { UserApp } from "./user-apps.js";
import { hasSeeder, seedIfEmpty } from "./seed.js";
import { creditToShare } from "./credit-words.js";
import { plainSeedRow as plainRow, seedRows, seedThatFits, type AppSeed, type Entities } from "./app-seed.js";

export type DemoSeed = AppSeed;

/**
 * Demo records for an app (docs/24 §3): its own first-run sample data, written into a throwaway store
 * and read back. Without anyone's account id, so no record names a person. An app with no sample data
 * of its own gets none: it opens empty, as it would for anyone who adds it.
 *
 * Never reads the app's own store.
 *
 * An app added from a package has no seeder here: its sample data is the `seed.json` its package came
 * with, kept beside it (`packageSeed`), and that is what travels — only for the entities it keeps. So
 * is an app made in the Studio's: the sample records the create loop asked for (app-seed.ts, #486).
 * With the app's definition at hand (`defined`), that seed is fitted to it first: only the rows the
 * app as it is now would take travel, and the kept seed itself is left as it is.
 */
export async function demoSeed(appId: string, entities: readonly string[], packageSeed?: DemoSeed, defined?: Entities): Promise<DemoSeed | undefined> {
  if (!hasSeeder(appId)) return fromPackage(defined ? seedThatFits(packageSeed, defined) : packageSeed, entities);
  const scratch = new MemoryStore();
  await scratch.open(`demo:${appId}`);
  try {
    // A photo stays the path of the file it is: the link carries the file, and the device that opens
    // it makes the record's copy (seed-files.ts).
    await seedIfEmpty(scratch, appId, undefined, async (file) => ({ file }));
    const seed: DemoSeed = {};
    for (const entity of entities) {
      const rows = await scratch.all(entity);
      if (rows.length) seed[entity] = rows.map((r) => plainRow(r as unknown as Record<string, unknown>));
    }
    return Object.keys(seed).length ? seed : undefined;
  } finally {
    await scratch.close();
  }
}

/** A package's seed as demo records: its rows for the entities the app keeps, as plain JSON. */
function fromPackage(seed: DemoSeed | undefined, entities: readonly string[]): DemoSeed | undefined {
  const out: DemoSeed = {};
  for (const entity of entities) {
    const rows = seed?.[entity];
    if (rows?.length) out[entity] = rows.map((r) => plainRow(r));
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The entities an app as saved declares, read in the sealed box and never run with authority
 * (validate-app.ts), its libraries standing in as the run check has them: what its kept seed is fitted
 * to when a link is made (#486). Undefined when it cannot be read here — then the seed travels as
 * kept, and the device that opens the link fits it to the app as it loads there (demo.tsx).
 */
export async function savedEntities(app: Pick<UserApp, "id" | "source">): Promise<Entities> {
  // A link made without its pictures, after one with them was too long, reads the same app again.
  const key = `${app.id}\n${app.source}`;
  if (lastRead?.key !== key) lastRead = { key, entities: readEntities(app) };
  return lastRead.entities;
}

let lastRead: { key: string; entities: Promise<Entities> } | null = null;

async function readEntities(app: Pick<UserApp, "id" | "source">): Promise<Entities> {
  try {
    const [{ loadDefinition }, { modulesOf }, { withLibrariesStoodIn }] = await Promise.all([import("./validate-app.js"), import("./app-modules.js"), import("./package-modules.js")]);
    const def = await loadDefinition(app.source, withLibrariesStoodIn(await modulesOf(app.id)));
    return def.entities as unknown as Entities;
  } catch (e) {
    console.warn("[potyro] the app's sample records go as kept; its definition could not be read:", e);
    return undefined;
  }
}

/**
 * Whether a demo link of this app would open on sample records (#486): its own seeder's, or the rows of
 * its kept seed that fit the app as it is now. What the share sheet says before the link is made.
 */
export async function linkHasSamples(app: UserApp): Promise<boolean> {
  if (hasSeeder(app.id)) return true;
  if (!app.seed) return false;
  const defined = await savedEntities(app);
  return seedRows(defined ? seedThatFits(app.seed, defined) : app.seed) > 0;
}

/** The files an app shipped with, from its folder, by path. Never a file the person added. */
export async function shippedFiles(store: Store, paths: readonly string[]): Promise<PackagedFile[]> {
  const space = fileSpace(store);
  const out: PackagedFile[] = [];
  for (const path of paths) {
    if (isReservedPath(path)) continue;
    const info = await space.find(path);
    if (!info || info.origin !== "shipped") continue;
    const blob = await space.read({ id: info.id });
    if (blob) out.push({ path: info.path, data: new Uint8Array(await blob.arrayBuffer()), ...(info.mime ? { mime: info.mime } : {}) });
  }
  return out;
}

export interface DemoPackageInput {
  app: Pick<UserApp, "id" | "name" | "source" | "lock" | "line">;
  /** The entities the app keeps, by id: what the demo records may fill. */
  entities: readonly string[];
  /** The app's own modules and libraries (`appCode`): only its own modules travel. */
  code: ReadonlyArray<{ path: string; data: Uint8Array }>;
  /** The files it shipped with. */
  files: PackagedFile[];
  seed?: DemoSeed;
  /** Who made it (docs/24 §6): the app's name, and the sharer's when they chose to show it. */
  credit?: AppCredit;
}

/** The demo package, as zip bytes. */
export function packDemo(input: DemoPackageInput): Uint8Array {
  const modules: PackagedFile[] = input.code.filter((c) => c.path.startsWith(SRC_DIR)).map((c) => ({ path: c.path.slice(SRC_DIR.length), data: c.data }));
  return packAppPackage({
    source: input.app.source,
    sourceName: "app.tsx",
    files: input.files,
    modules,
    lock: input.app.lock,
    seed: input.seed,
    chat: undefined,
    ...(input.credit ? { credit: input.credit } : {}),
    // Which app it is (docs/24 §11): kept, the copy opens from the same links as this one.
    ...(input.app.line ? { line: input.app.line } : {}),
  });
}

/** A demo package, and what a preview of it may show: the app's look and its demo records. */
export interface DemoPackage {
  zip: Uint8Array;
  /** The same package without its demo records, when it has some: an inline link too long with them still works without. */
  bare?: Uint8Array;
  entities: string[];
  seed?: DemoSeed;
  icon?: string;
  accent?: string;
  /** Who the link says made it. */
  credit: AppCredit;
  /** Whether it carries files the app shipped with (pictures, mostly): what an inline link can drop. */
  pictures: boolean;
}

/** Everything `packDemo` needs, read from this device for a saved app. */
export async function demoPackageFor(
  app: UserApp,
  /** `entitiesOf`: how the app's definition is read for fitting its kept seed (`savedEntities`); a seam for tests. */
  opts: { by?: string; pictures?: boolean; entitiesOf?: (app: UserApp) => Promise<Entities> } = {},
): Promise<DemoPackage> {
  const [{ inspect }, { appCode, modulesOf }] = await Promise.all([import("./app-source.js"), import("./app-modules.js")]);
  const shape = await inspect(app.source);
  const entities = shape.entities.map((e) => e.key);
  let files: PackagedFile[] = [];
  let code: Array<{ path: string; data: Uint8Array }> = [];
  // A bundled example's files reach its folder when its store opens (example-files.ts), so one that
  // has never been opened on this device still shares its pictures.
  const bundled = (await import("./example-files.js")).exampleFilePaths(app.id);
  const needsStore = Boolean(app.shipped?.length) || bundled.length > 0 || Boolean(app.lock && Object.keys(app.lock).length);
  if (needsStore) {
    const { openAppStore, syncAllowedFor } = await import("./app-store.js");
    const store = await openAppStore(app, { sync: await syncAllowedFor(app) });
    try {
      // `pictures: false`: a link that has to carry the app in itself, and would not fit with them.
      if (opts.pictures !== false) files = await shippedFiles(store, [...new Set([...(app.shipped ?? []), ...bundled])]);
      code = await appCode((await modulesOf(app.id)) ?? store, app.lock);
    } finally {
      await store.close();
    }
  }
  const credit = creditToShare(app, opts.by);
  // A kept seed (a package's, or a Studio app's) is fitted to the app as it is now (#486): a version
  // whose shape no longer takes a row carries fewer, and the seed itself is left as it was.
  const defined = app.seed && !hasSeeder(app.id) ? await (opts.entitiesOf ?? savedEntities)(app) : undefined;
  const seed = await demoSeed(app.id, entities, app.seed, defined);
  // What its first screens show come first: that is what the app is for, at a glance (preview-card.ts).
  const shown = shape.pages.filter((p) => !p.hidden && p.entity).map((p) => p.entity!);
  const byScreen = [...new Set([...shown, ...entities])];
  return {
    zip: packDemo({ app, entities, code, files, seed, credit }),
    ...(seed ? { bare: packDemo({ app, entities, code, files, credit }) } : {}),
    entities: byScreen,
    seed,
    icon: shape.icon,
    accent: shape.accent,
    credit,
    pictures: files.length > 0,
  };
}
