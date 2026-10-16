// @vitest-environment happy-dom
//
// Add an app (#253): what comes in from files, and what installing or updating does to the app's
// record, its folder and its first records. The card's choices are the owner's decisions of
// 2026-10-11: sealed by default; "mine" only for a file or paste; Replace keeps data and the trust
// the app had, except from a link; a shipped file the person changed is kept.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { MemoryStore, fileSpace, packAppPackage, packBundle, readAppPackage, type AppLock, type PackagedFile, type Store } from "@potyro/store";
import type { EsbuildLike } from "../src/app-bundler.js";
import type { HttpGet } from "../src/library-fetch.js";

const history = vi.hoisted(() => ({ notes: [] as Array<string | undefined> }));
vi.mock("../src/app-history.js", () => ({
  recordVersion: async (_id: string, v: { note?: string }) => {
    history.notes.push(v.note);
  },
  clearHistory: async () => {},
}));
vi.mock("../src/app-store.js", () => ({ openAppStore: async () => new MemoryStore(), syncAllowedFor: async () => false }));
// The Studio conversation's store (#261): one in-memory store for the whole file, as a device has one.
vi.mock("../src/open-store.js", async () => {
  const { MemoryStore: Memory } = await import("@potyro/store");
  const chats = new Memory();
  await chats.open("studio-chat");
  return { openStore: async () => chats };
});
// The test load in the sealed box (#271), as its outcomes: the real one is exercised in a browser.
const trials = vi.hoisted(() => ({ calls: [] as Array<{ standIns?: boolean; smoke?: boolean }> }));
vi.mock("../src/app-trial.js", () => ({
  trySealed: async (source: string, modules?: { lock: Record<string, unknown> }, opts: { standIns?: boolean; smoke?: boolean } = {}) => {
    trials.calls.push(opts);
    // A source marked NEEDS_DOM stands for an app whose library reaches for `window` when it loads: it
    // fails in the sealed box once the library's real bytes are there, as `wrapForIsolate` says it.
    if (source.includes("NEEDS_DOM") && !opts.standIns && Object.keys(modules?.lock ?? {}).some((k) => k.startsWith("https://"))) {
      const sentence = "fancy-chart 4.4.1 needs a full web page to work ('window' is not defined). Apps in the sealed box do not get one, so this app can only run as yours.";
      return { issues: [], missing: ["a full web page (window)"], loadFailed: `Error: ${sentence}`, libraryProblem: sentence };
    }
    // Its top level makes a date formatter, which the sealed box cannot.
    if (source.includes("TOP_INTL")) return { issues: [], missing: ["date and number formatting (Intl)"], loadFailed: "ReferenceError: 'Intl' is not defined" };
    if (source.includes("THROWS")) return { issues: [], missing: [], loadFailed: "Error: not today" };
    if (source.includes("SYNTAX")) return { issues: [], missing: [], unreadable: "Expected \";\" but found \"}\"" };
    // A computed that formats dates: it loads, and the smoke run meets the missing feature.
    if (source.includes("USES_INTL") && opts.smoke) return { ...inspected(source), missing: ["date and number formatting (Intl)"] };
    // An app in two languages: its name and its entity's label are maps (#302).
    if (source.includes("TWO_LANGUAGES")) return { definition: { id: "piano", name: { en: "Piano", pl: "Pianino" }, language: "en", languages: ["en", "pl"], entities: { session: { label: { en: "Session", pl: "Sesja" } } } }, issues: [], missing: [] };
    if (source.includes("OTHER_ID")) return { ...inspected(source), definition: { ...inspected(source).definition, id: "not-piano" }, missing: [] };
    return { ...inspected(source), missing: [] };
  },
}));
const inspected = (source: string) => ({
    definition: source.includes("BROKEN")
      ? { id: "piano", name: "Piano", entities: { session: {} } }
      : { id: "piano", name: "Piano", icon: "🎹", permissions: { notifications: true }, entities: { session: { label: "Session" } } },
    issues: source.includes("BROKEN") ? ["pages: an app needs at least one page"] : [],
});

const { gatherFromFiles, inspectPackage, installPackage, applyShippedFiles } = await import("../src/add-app.js");
const { describeLibrary } = await import("../src/package-libraries.js");
const { getUserApp } = await import("../src/user-apps.js");

const SOURCE = 'import { defineApp } from "potyro"; export default defineApp({ id: "piano" } as never);';
const file = (name: string, text: string, type = "") => new File([text], name, { type });

let stores: Store[];
async function opener(): Promise<Store> {
  const s = new MemoryStore();
  await s.open("piano");
  stores.push(s);
  return s;
}
// One store per app id across installs, the way the device has one.
const byApp = new Map<string, Store>();
const openFor = async (app: { id: string }) => {
  if (!byApp.has(app.id)) byApp.set(app.id, await opener());
  return byApp.get(app.id)!;
};

beforeEach(async () => {
  localStorage.clear();
  stores = [];
  trials.calls = [];
  byApp.clear();
  await (await import("../src/studio-chat.js")).clearChat("piano");
});

describe("gathering files the person picked", () => {
  it("the *.app.tsx is the app; the rest ship with it; seed.json is the seed", async () => {
    const pkg = await gatherFromFiles([
      file("plan.json", '{"weeks":12}'),
      file("piano.app.tsx", SOURCE),
      file("seed.json", '{"session":[{"minutes":20}]}'),
      file("hands.png", "png", "image/png"),
    ]);
    expect(pkg.source).toBe(SOURCE);
    expect(pkg.files.map((f) => f.path).sort()).toEqual(["hands.png", "plan.json"]);
    expect(pkg.files.find((f) => f.path === "hands.png")!.mime).toBe("image/png");
    expect(pkg.seed).toEqual({ session: [{ minutes: 20 }] });
  });

  it("a package zip on its own is read as a package", async () => {
    const zip = packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [{ path: "plan.json", data: new TextEncoder().encode("{}") }] });
    const pkg = await gatherFromFiles([new File([zip as BlobPart], "piano.zip")]);
    expect(pkg.files.map((f) => f.path)).toEqual(["plan.json"]);
  });

  it("says which choice is ambiguous or missing", async () => {
    await expect(gatherFromFiles([file("a.app.ts", SOURCE), file("b.app.ts", SOURCE)])).rejects.toThrow(/More than one/);
    await expect(gatherFromFiles([file("plan.json", "{}")])).rejects.toThrow(/None of these is an app/);
  });
});

describe("installing", () => {
  it("a new app comes in sealed, with its files shipped and its seed applied once", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE), file("plan.json", '{"weeks":12}'), file("seed.json", '{"session":[{"minutes":20}],"nope":[{}]}')]);
    const inspected = await inspectPackage(pkg);
    expect(inspected).toMatchObject({ id: "piano", name: "Piano", keeps: ["Session"], asks: ["notifications"], seedRows: 2, installed: undefined });

    const done = await installPackage(pkg, inspected, { source: "file", mine: false, mode: "replace", openStore: openFor });

    expect(done.app.trusted).toBe(false);
    expect(done.updated).toBe(false);
    expect(done.seeded).toBe(1); // the row for an entity the app does not declare is not inserted
    const store = byApp.get("piano")!;
    expect(await (await fileSpace(store).read("plan.json"))!.text()).toBe('{"weeks":12}');
    expect((await fileSpace(store).find("plan.json"))!.origin).toBe("shipped");
    expect(await store.all("session")).toHaveLength(1);
  });

  it("keeps the package's seed beside the app, so a demo link of it opens on it (docs/24 §3) — but not a huge one", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE), file("seed.json", '{"session":[{"minutes":20}]}')]);
    await installPackage(pkg, await inspectPackage(pkg), { source: "file", mine: false, mode: "replace", openStore: openFor });
    expect(getUserApp("piano")?.seed).toEqual({ session: [{ minutes: 20 }] });

    localStorage.clear();
    byApp.clear();
    const huge = JSON.stringify({ session: Array.from({ length: 4000 }, (_, i) => ({ minutes: i, note: "a long practice note" })) });
    const big = await gatherFromFiles([file("piano.app.tsx", SOURCE), file("seed.json", huge)]);
    await installPackage(big, await inspectPackage(big), { source: "file", mine: false, mode: "replace", openStore: openFor });
    expect(getUserApp("piano")).toBeDefined();
    expect(getUserApp("piano")?.seed).toBeUndefined();
  });

  it('"mine" from a file runs it directly; from a link it never does', async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE)]);
    const mine = await installPackage(pkg, await inspectPackage(pkg), { source: "file", mine: true, mode: "replace", openStore: openFor });
    expect(mine.app.trusted).toBe(true);

    localStorage.clear();
    const linked = await installPackage(pkg, await inspectPackage(pkg), { source: "link", mine: true, mode: "replace", link: "https://x.test/piano.app.tsx", openStore: openFor });
    expect(linked.app.trusted).toBe(false);
    expect(getUserApp("piano")!.link).toBe("https://x.test/piano.app.tsx");
  });

  it("Replace updates in place: same id and data, no reseed, shipped files replaced unless the person changed them", async () => {
    const v1 = await gatherFromFiles([file("piano.app.tsx", SOURCE), file("plan.json", "v1"), file("notes.md", "v1"), file("old.txt", "v1"), file("seed.json", '{"session":[{"minutes":20}]}')]);
    await installPackage(v1, await inspectPackage(v1), { source: "file", mine: true, mode: "replace", openStore: openFor });
    const store = byApp.get("piano")!;
    await fileSpace(store).write("notes.md", new Blob(["my own notes"])); // the person changed a shipped file

    const v2 = await gatherFromFiles([file("piano.app.tsx", SOURCE + "// v2"), file("plan.json", "v2"), file("notes.md", "v2"), file("seed.json", '{"session":[{"minutes":99}]}')]);
    const inspected = await inspectPackage(v2);
    expect(inspected.installed?.id).toBe("piano");
    const done = await installPackage(v2, inspected, { source: "file", mine: false, mode: "replace", openStore: openFor });

    expect(done.updated).toBe(true);
    expect(done.app.id).toBe("piano");
    expect(done.app.trusted).toBe(true); // your own app stays yours across a rebuild
    expect(getUserApp("piano")!.source).toContain("// v2");
    expect(done.seeded).toBe(0);
    expect(await store.all("session")).toHaveLength(1);
    expect(done.files).toEqual({ written: ["plan.json"], kept: ["notes.md"], removed: ["old.txt"] });
    expect(await (await fileSpace(store).read("plan.json"))!.text()).toBe("v2");
    expect(await (await fileSpace(store).read("notes.md"))!.text()).toBe("my own notes");
  });

  it("an update from a link drops an app into the sealed box", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE)]);
    await installPackage(pkg, await inspectPackage(pkg), { source: "file", mine: true, mode: "replace", openStore: openFor });
    const again = await installPackage(pkg, await inspectPackage(pkg), { source: "link", mine: true, mode: "replace", link: "https://x.test/a", openStore: openFor });
    expect(again.app.trusted).toBe(false);
  });

  it("Install as a copy makes a second app, empty, under a new id", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE), file("seed.json", '{"session":[{"minutes":20}]}')]);
    await installPackage(pkg, await inspectPackage(pkg), { source: "file", mine: false, mode: "replace", openStore: openFor });
    const copy = await installPackage(pkg, await inspectPackage(pkg), { source: "file", mine: false, mode: "copy", openStore: openFor });

    expect(copy.app.id).not.toBe("piano");
    expect(copy.updated).toBe(false);
    expect(copy.seeded).toBe(1);
  });

  it("a package that carries how it was made lands that conversation as the app's own (#261)", async () => {
    const chat = { format: "potyro-chat/1", messages: [{ at: "2026-10-11T00:00:00.000Z", kind: "ask", text: "a piano practice log" }] };
    const { readAppPackage } = await import("@potyro/store");
    const packaged = readAppPackage(packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [], chat }));
    const done = await installPackage(packaged, await inspectPackage(packaged), { source: "file", mine: false, mode: "replace", openStore: openFor });

    const { listMessages } = await import("../src/studio-chat.js");
    const landed = await listMessages(done.app.id);
    expect(landed.map((m) => [m.kind, m.text])).toEqual([
      ["ask", "a piano practice log"],
      ["event", "how it was made, as shared by its author"],
    ]);
  });

  it("a conversation that is not one is ignored, and the app still installs", async () => {
    const packaged = (await import("@potyro/store")).readAppPackage(packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [], chat: { format: "something else" } }));
    const done = await installPackage(packaged, await inspectPackage(packaged), { source: "file", mine: false, mode: "replace", openStore: openFor });
    expect(getUserApp(done.app.id)).toBeDefined();
    const { listMessages } = await import("../src/studio-chat.js");
    expect(await listMessages(done.app.id)).toEqual([]);
  });

  it("an app with structure problems is refused, and nothing is saved", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE + "BROKEN")]);
    const inspected = await inspectPackage(pkg);
    await expect(installPackage(pkg, inspected, { source: "file", mine: false, mode: "replace", openStore: openFor })).rejects.toThrow(/at least one page/);
    expect(getUserApp("piano")).toBeUndefined();
  });

  it("remembers the files it shipped, so opening it can tell when one is missing", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE), file("levels.json", "{}"), file("seed.json", "{}")]);
    const done = await installPackage(pkg, await inspectPackage(pkg), { source: "file", mine: true, mode: "replace", openStore: openFor });
    expect(done.app.shipped).toEqual(["levels.json"]);
    expect(getUserApp("piano")?.shipped).toEqual(["levels.json"]);
    const { missingShipped } = await import("../src/shipped-files.js");
    const store = byApp.get("piano")!;
    expect(await missingShipped(store, done.app)).toEqual([]);
    await fileSpace(store).remove("levels.json");
    expect(await missingShipped(store, done.app)).toEqual(["levels.json"]);
  });

  it("a store that cannot be opened (its data held in another tab) fails the install loudly, leaves no app, and a retry installs it", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE), file("levels.json", '{"levels":[1]}')]);
    const inspected = await inspectPackage(pkg);
    const busy = async (): Promise<Store> => {
      throw new Error("This app’s data is open in another Potyro tab or window, so it cannot be opened here as well.");
    };
    await expect(installPackage(pkg, inspected, { source: "file", mine: true, mode: "replace", openStore: busy })).rejects.toThrow(/“Piano” was not added: its files could not be saved\. This app’s data is open in another Potyro tab/);
    expect(getUserApp("piano")).toBeUndefined();

    const done = await installPackage(pkg, inspected, { source: "file", mine: true, mode: "replace", openStore: openFor });
    expect(await (await fileSpace(byApp.get("piano")!).read("levels.json"))!.text()).toBe('{"levels":[1]}');
    expect(done.app.shipped).toEqual(["levels.json"]);
  });

  it("files that do not land are not taken for installed: the install fails and says which", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE), file("levels.json", "{}")]);
    // A store whose writes vanish — what a store that is not the app's own looks like from here.
    const leaky = async (): Promise<Store> => {
      const s = new MemoryStore();
      await s.open("piano");
      s.setFile = async () => {};
      return s;
    };
    await expect(installPackage(pkg, await inspectPackage(pkg), { source: "file", mine: true, mode: "replace", openStore: leaky })).rejects.toThrow(/was not added: its files could not be saved\. These files did not land in its folder: levels\.json\./);
    expect(getUserApp("piano")).toBeUndefined();
  });

  it("an update whose files cannot be saved keeps the app, says so, and trying again writes them", async () => {
    const v1 = await gatherFromFiles([file("piano.app.tsx", SOURCE), file("levels.json", '{"v":1}')]);
    await installPackage(v1, await inspectPackage(v1), { source: "file", mine: true, mode: "replace", openStore: openFor });
    const v2 = await gatherFromFiles([file("piano.app.tsx", SOURCE), file("levels.json", '{"v":2}')]);
    const inspected = await inspectPackage(v2);
    const busy = async (): Promise<Store> => {
      throw new Error("busy");
    };
    await expect(installPackage(v2, inspected, { source: "file", mine: true, mode: "replace", openStore: busy })).rejects.toThrow(/was not fully updated/);
    expect(getUserApp("piano")).toBeDefined();
    await installPackage(v2, inspected, { source: "file", mine: true, mode: "replace", openStore: openFor });
    expect(await (await fileSpace(byApp.get("piano")!).read("levels.json"))!.text()).toBe('{"v":2}');
  });

  it("the card shows an app's words in the person's language, never a map of them", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE + "TWO_LANGUAGES")]);
    const card = await inspectPackage(pkg);
    expect(card.name).toBe("Piano");
    expect(card.keeps).toEqual(["Session"]);
  });
});

describe("an app's own modules and its libraries (#258, #266)", () => {
  const esbuild = { build } as unknown as EsbuildLike;
  const ROOT = "https://esm.sh/fancy-chart@4.4.1?bundle";
  const INNER = "https://esm.sh/fancy-chart@4.4.1/es2022/fancy-chart.bundle.mjs";
  const SITE: Record<string, string> = {
    [ROOT]: `export * from "/fancy-chart@4.4.1/es2022/fancy-chart.bundle.mjs";\n`,
    [INNER]: `export const chart = (n) => "chart " + n;\n`,
  };
  const LIB_SOURCE = `import { chart } from "${ROOT}";\nimport { weeks } from "./plan.js";\n${SOURCE}\nexport const shown = chart(weeks);`;
  const net = (site: Record<string, string>) =>
    vi.fn<HttpGet>(async (url) => (site[url] === undefined ? { ok: false, status: 404, url, bytes: async () => new Uint8Array() } : { ok: true, status: 200, url, bytes: async () => new TextEncoder().encode(site[url]) }));

  it("scripts picked beside the app are its modules, not files it reads", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE), file("plan.ts", "export const weeks = 12;"), file("plan.json", "{}")]);
    expect(pkg.modules.map((m) => m.path)).toEqual(["plan.ts"]);
    expect(pkg.files.map((f) => f.path)).toEqual(["plan.json"]);
  });

  it("the card names a library still to be fetched, and nothing is fetched to draw it", async () => {
    const get = net(SITE);
    const pkg = await gatherFromFiles([file("piano.app.tsx", LIB_SOURCE), file("plan.ts", "export const weeks = 12;")]);
    const inspected = await inspectPackage(pkg, { esbuild, get });
    expect(inspected.libraries).toEqual([{ url: ROOT, label: "fancy-chart 4.4.1", host: "esm.sh", here: false, size: undefined }]);
    expect(inspected.modules).toEqual(["plan.ts"]);
    expect(get).not.toHaveBeenCalled();
  });

  it("installing fetches the library's whole graph once, keeps it with the app's modules, and locks all of it on the app's record", async () => {
    const get = net(SITE);
    const pkg = await gatherFromFiles([file("piano.app.tsx", LIB_SOURCE), file("plan.ts", "export const weeks = 12;"), file("plan.json", "{}")]);
    const done = await installPackage(pkg, await inspectPackage(pkg, { esbuild, get }), { source: "file", mine: false, mode: "replace", openStore: openFor, esbuild, get });

    expect(get.mock.calls.map((c) => c[0]).sort()).toEqual([INNER, ROOT].sort());
    const lock = getUserApp(done.app.id)!.lock!;
    expect(Object.keys(lock).sort()).toEqual([INNER, ROOT, "src/plan.ts"].sort());
    const space = fileSpace(byApp.get("piano")!);
    expect(await (await space.read(lock[INNER]!.file))!.text()).toBe(SITE[INNER]);
    expect(await (await space.read(".src/plan.ts"))!.text()).toBe("export const weeks = 12;");
    // What the person is told about is their files; the app's code is not one of them.
    expect(done.files.written).toEqual(["plan.json"]);
  });

  it("a package that already carries its library installs with no network", async () => {
    const first = net(SITE);
    const pkg = await gatherFromFiles([file("piano.app.tsx", LIB_SOURCE), file("plan.ts", "export const weeks = 12;")]);
    const done = await installPackage(pkg, await inspectPackage(pkg, { esbuild, get: first }), { source: "file", mine: false, mode: "replace", openStore: openFor, esbuild, get: first });
    const space = fileSpace(byApp.get("piano")!);
    const lock = getUserApp(done.app.id)!.lock!;
    const carried: PackagedFile[] = [];
    for (const url of [ROOT, INNER]) carried.push({ path: lock[url]!.file, data: new Uint8Array(await (await space.read(lock[url]!.file))!.arrayBuffer()) });
    const zip = packAppPackage({ source: LIB_SOURCE, sourceName: "app.tsx", files: carried, modules: pkg.modules, lock });
    const { readAppPackage } = await import("@potyro/store");
    const packaged = readAppPackage(zip);

    localStorage.clear();
    byApp.clear();
    const none = net({});
    const inspected = await inspectPackage(packaged, { esbuild, get: none });
    expect(inspected.libraries[0]).toMatchObject({ label: "fancy-chart 4.4.1", here: true, size: SITE[ROOT]!.length + SITE[INNER]!.length });
    await installPackage(packaged, inspected, { source: "file", mine: false, mode: "replace", openStore: openFor, esbuild, get: none });
    expect(none).not.toHaveBeenCalled();
    expect(getUserApp("piano")!.lock).toEqual(lock);
  });

  describe("an export bundle (#282)", () => {
    const PLAN = "export const weeks = 12;";
    type Code = Array<{ path: string; data: Uint8Array }>;
    const bundleOf = (lock: AppLock, code: Code): Uint8Array =>
      packBundle({
        sqlite: new Uint8Array([1]),
        manifest: { format: "potyro-bundle/1", appId: "piano", appVersion: "1", schemaVersion: 1, provenance: "untrusted", grantedCaps: [], mode: "snapshot", exportedAt: "2026-10-13", entities: ["session"] },
        appSource: LIB_SOURCE,
        lock,
        code,
      });
    /** Install the app from its files (fetching once), then export it the way Export does. */
    async function exported(): Promise<{ zip: Uint8Array; lock: AppLock; code: Code; tamper: (path: string, text: string) => Uint8Array }> {
      const get = net(SITE);
      const pkg = await gatherFromFiles([file("piano.app.tsx", LIB_SOURCE), file("plan.ts", PLAN)]);
      const done = await installPackage(pkg, await inspectPackage(pkg, { esbuild, get }), { source: "file", mine: false, mode: "replace", openStore: openFor, esbuild, get });
      const lock = getUserApp(done.app.id)!.lock!;
      const { appCode } = await import("../src/app-modules.js");
      const code = await appCode(byApp.get("piano")!, lock);
      localStorage.clear();
      byApp.clear();
      // The same bundle with the bytes of one of its files swapped.
      const tamper = (path: string, text: string): Uint8Array => {
        expect(code.some((f) => f.path === path)).toBe(true);
        return bundleOf(lock, code.map((f) => (f.path === path ? { ...f, data: new TextEncoder().encode(text) } : f)));
      };
      return { zip: bundleOf(lock, code), lock, code, tamper };
    }

    it("carries every file the lock names, so the app is added with no network and the same lock", async () => {
      const { zip, lock, code } = await exported();
      // Every file the lock names, and nothing else of the app's.
      expect(code.map((f) => f.path).sort()).toEqual([...new Set(Object.values(lock).map((e) => e.file))].sort());
      const none = net({});
      const pkg = readAppPackage(zip);
      const inspected = await inspectPackage(pkg, { esbuild, get: none });
      expect(inspected.issues).toEqual([]);
      expect(inspected.libraries[0]).toMatchObject({ label: "fancy-chart 4.4.1", here: true });
      expect(inspected.modules).toEqual(["plan.ts"]);
      await installPackage(pkg, inspected, { source: "file", mine: false, mode: "replace", openStore: openFor, esbuild, get: none });
      expect(none).not.toHaveBeenCalled();
      expect(getUserApp("piano")!.lock).toEqual(lock);
      const space = fileSpace(byApp.get("piano")!);
      expect(await (await space.read(lock[INNER]!.file))!.text()).toBe(SITE[INNER]);
      expect(await (await space.read(".src/plan.ts"))!.text()).toBe(PLAN);
    });

    it("a library file in it that is not what the lock says is refused by the library's name, and nothing is fetched", async () => {
      const { lock, tamper } = await exported();
      const bad = readAppPackage(tamper(lock[INNER]!.file, 'export const chart = () => "tampered";\n'));
      const get = net(SITE);
      const inspected = await inspectPackage(bad, { esbuild, get });
      expect(inspected.issues.join("\n")).toMatch(/fancy-chart 4\.4\.1 .*not the copy/);
      await expect(installPackage(bad, inspected, { source: "file", mine: false, mode: "replace", openStore: openFor, esbuild, get })).rejects.toThrow(/fancy-chart 4\.4\.1/);
      expect(get).not.toHaveBeenCalled();
      expect(getUserApp("piano")).toBeUndefined();
    });

    it("one of the app's own modules that is not what the lock says is refused by its name", async () => {
      const { tamper } = await exported();
      const bad = readAppPackage(tamper(".src/plan.ts", "export const weeks = 13;"));
      const inspected = await inspectPackage(bad, { esbuild, get: net({}) });
      expect(inspected.issues.join("\n")).toMatch(/plan\.ts .*not the copy/);
    });
  });

  it("a library fetched at install that cannot start in the sealed box is said right away, not by an app that does not open", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", `// NEEDS_DOM\n${LIB_SOURCE}`), file("plan.ts", "export const weeks = 12;")]);
    const inspected = await inspectPackage(pkg, { esbuild, get: net(SITE) });
    expect(inspected.sealedProblem).toBeUndefined(); // the card could not know: nothing was fetched
    const sealed = await installPackage(pkg, inspected, { source: "file", mine: false, mode: "replace", openStore: openFor, esbuild, get: net(SITE) });
    expect(sealed.sealedProblem).toMatch(/^fancy-chart 4\.4\.1 needs a full web page/);

    localStorage.clear();
    byApp.clear();
    const mine = await installPackage(pkg, inspected, { source: "file", mine: true, mode: "replace", openStore: openFor, esbuild, get: net(SITE) });
    expect(mine.sealedProblem).toBeUndefined();
  });

  it("a library that cannot be fetched leaves nothing behind", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", LIB_SOURCE), file("plan.ts", "export const weeks = 12;")]);
    const get = net({ [ROOT]: SITE[ROOT]! });
    await expect(installPackage(pkg, await inspectPackage(pkg, { esbuild, get }), { source: "file", mine: false, mode: "replace", openStore: openFor, esbuild, get })).rejects.toThrow(
      /fancy-chart 4\.4\.1.*404/,
    );
    expect(getUserApp("piano")).toBeUndefined();
  });

  it("a library URL without an exact version is a problem on the card, and the app is not added", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", `import x from "https://esm.sh/fancy-chart?bundle";\n${SOURCE}\nexport const y = x;`)]);
    const inspected = await inspectPackage(pkg, { esbuild, get: net(SITE) });
    expect(inspected.issues.join("\n")).toMatch(/exact version/);
    await expect(installPackage(pkg, inspected, { source: "file", mine: false, mode: "replace", openStore: openFor, esbuild })).rejects.toThrow(/exact version/);
  });
});

describe("a library upgrade (#266)", () => {
  const esbuild = { build } as unknown as EsbuildLike;
  const url = (v: string) => `https://esm.sh/fancy-chart@${v}?bundle`;
  const site = (v: string): Record<string, string> => ({ [url(v)]: `export const chart = (n) => "chart ${v} " + n;\n` });
  const src = (v: string) => `import { chart } from "${url(v)}";\n${SOURCE}\nexport const shown = chart(1);`;
  const net = (s: Record<string, string>) => vi.fn<HttpGet>(async (u) => (s[u] === undefined ? { ok: false, status: 404, url: u, bytes: async () => new Uint8Array() } : { ok: true, status: 200, url: u, bytes: async () => new TextEncoder().encode(s[u]) }));
  const add = async (v: string) => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", src(v))]);
    const get = net(site(v));
    return installPackage(pkg, await inspectPackage(pkg, { esbuild, get }), { source: "file", mine: false, mode: "replace", openStore: openFor, esbuild, get });
  };

  it("the version it makes says which library changed", async () => {
    history.notes.length = 0;
    await add("4.4.0");
    await add("4.4.1");
    expect(history.notes.at(-1)).toBe("Updated from a file · fancy-chart 4.4.1 (was 4.4.0)");
  });

  it("keeps the old library's bytes, so History can go back to the version that used them", async () => {
    const before = (await add("4.4.0")).app.lock![url("4.4.0")]!.file;
    await add("4.4.1");
    const space = fileSpace(byApp.get("piano")!);
    expect(await (await space.read(before))!.text()).toContain("chart 4.4.0");
    expect(Object.keys(getUserApp("piano")!.lock!)).toEqual([url("4.4.1")]);
  });
});

describe("what the card says about a library", () => {
  const line = { url: "https://esm.sh/chart.js@4.4.1?bundle", label: "chart.js 4.4.1", host: "esm.sh" };
  it("one still to fetch: what, how big when known, and from where", () => {
    expect(describeLibrary({ ...line, here: false, size: 194_560 })).toBe("fetches chart.js 4.4.1, 190 KB, from esm.sh");
    expect(describeLibrary({ ...line, here: false })).toBe("fetches chart.js 4.4.1 from esm.sh");
  });
  it("one that came with the app fetches nothing", () => {
    expect(describeLibrary({ ...line, here: true, size: 194_560 })).toBe("chart.js 4.4.1, 190 KB, came with the app");
  });
});

// The card never runs code, and a test load names what the sealed box lacks (#271).
describe("the card, from what a package declares", () => {
  const declared = {
    id: "piano",
    name: "Piano",
    icon: "🎹",
    version: "1.0.0",
    schemaVersion: 1,
    permissions: { camera: true },
    entities: { session: { label: "Session", displayField: "minutes", fields: { minutes: { type: "number" } }, computed: { month: "__potyro_fn__" } } },
    pages: [{ id: "all", title: "Sessions", view: { type: "list", entity: "session", display: { primary: "minutes" } } }],
  };
  const packaged = async (source: string, withDeclaration = true) =>
    (await import("@potyro/store")).readAppPackage(packAppPackage({ source, sourceName: "app.tsx", files: [], ...(withDeclaration ? { declared } : {}) }));

  it("a package whose top level throws in the sealed box shows its whole card, names what is missing, and installs", async () => {
    const pkg = await packaged(`// TOP_INTL\n${SOURCE}`);
    const inspected = await inspectPackage(pkg);
    expect(inspected).toMatchObject({ id: "piano", name: "Piano", icon: "🎹", keeps: ["Session"], asks: ["camera"], issues: [], preview: "declared" });
    expect(inspected.missing).toEqual(["date and number formatting (Intl)"]);
    expect(inspected.trialProblem).toBeUndefined(); // the missing feature IS the reason; it is not said twice
    expect(inspected.failsToOpenSealed).toBe(true);

    const done = await installPackage(pkg, inspected, { source: "file", mine: false, mode: "replace", openStore: openFor });
    expect(getUserApp(done.app.id)?.name).toBe("Piano");
  });

  it("the test load puts sample records through its logic, and what that meets is named on the card", async () => {
    const inspected = await inspectPackage(await packaged(`// USES_INTL\n${SOURCE}`));
    expect(trials.calls).toEqual([{ standIns: false, smoke: true }]);
    expect(inspected.missing).toEqual(["date and number formatting (Intl)"]);
    expect(inspected.failsToOpenSealed).toBe(false);
  });

  it("a declaration that is not a valid app is a problem on the card; one that is not the code's is refused", async () => {
    const bad = (await import("@potyro/store")).readAppPackage(
      packAppPackage({ source: SOURCE, sourceName: "app.tsx", files: [], declared: { ...declared, pages: [{ id: "all", title: "All", view: { type: "list", entity: "nope" } }] } }),
    );
    expect((await inspectPackage(bad)).issues.join("\n")).toMatch(/nope/);
    const other = await inspectPackage(await packaged(`// OTHER_ID\n${SOURCE}`));
    expect(other.issues.join("\n")).toMatch(/“piano”.*“not-piano”/);
  });

  it("without a declaration, a top level that throws gives a card that could not preview the app — never 'does not load'", async () => {
    const pkg = await packaged(`// THROWS\nimport { defineApp } from "potyro"; export default defineApp({ id: "piano", name: "Piano practice" } as never);`, false);
    const inspected = await inspectPackage(pkg);
    expect(inspected).toMatchObject({ id: "piano", name: "Piano practice", preview: "unavailable", previewProblem: "Error: not today", issues: [], keeps: [] });
    // It can still be added: run as theirs, it may be fine.
    const done = await installPackage(pkg, inspected, { source: "file", mine: true, mode: "replace", openStore: openFor });
    expect(done.app.trusted).toBe(true);
  });

  it("source that cannot be read at all is a problem on the card, and is not added", async () => {
    const pkg = await packaged(`// SYNTAX\n${SOURCE}`, false);
    const inspected = await inspectPackage(pkg);
    expect(inspected.preview).toBe("unavailable");
    expect(inspected.issues.join("\n")).toMatch(/could not be read/);
    await expect(installPackage(pkg, inspected, { source: "file", mine: true, mode: "replace", openStore: openFor })).rejects.toThrow(/could not be read/);
  });
});

describe("shipped files on their own", () => {
  it("a first install writes them all as shipped and removes nothing", async () => {
    const s = await opener();
    const r = await applyShippedFiles(s, [{ path: "a/b.json", data: new TextEncoder().encode("{}") }], { update: false });
    expect(r).toEqual({ written: ["a/b.json"], kept: [], removed: [] });
  });
});
