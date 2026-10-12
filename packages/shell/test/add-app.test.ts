// @vitest-environment happy-dom
//
// Add an app (#253): what comes in from files, and what installing or updating does to the app's
// record, its folder and its first records. The card's choices are the owner's decisions of
// 2026-10-11: sealed by default; "mine" only for a file or paste; Replace keeps data and the trust
// the app had, except from a link; a shipped file the person changed is kept.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { MemoryStore, fileSpace, packAppPackage, type PackagedFile, type Store } from "@potyro/store";
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
vi.mock("../src/validate-app.js", () => ({
  inspectSource: async (source: string) => ({
    definition: source.includes("BROKEN")
      ? { id: "piano", name: "Piano", entities: { session: {} } }
      : { id: "piano", name: "Piano", icon: "🎹", permissions: { notifications: true }, entities: { session: { label: "Session" } } },
    issues: source.includes("BROKEN") ? ["pages: an app needs at least one page"] : [],
  }),
}));

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

describe("shipped files on their own", () => {
  it("a first install writes them all as shipped and removes nothing", async () => {
    const s = await opener();
    const r = await applyShippedFiles(s, [{ path: "a/b.json", data: new TextEncoder().encode("{}") }], { update: false });
    expect(r).toEqual({ written: ["a/b.json"], kept: [], removed: [] });
  });
});
