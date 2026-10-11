// @vitest-environment happy-dom
//
// Add an app (#253): what comes in from files, and what installing or updating does to the app's
// record, its folder and its first records. The card's choices are the owner's decisions of
// 2026-10-11: sealed by default; "mine" only for a file or paste; Replace keeps data and the trust
// the app had, except from a link; a shipped file the person changed is kept.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, fileSpace, packAppPackage, type Store } from "@potyro/store";

vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-store.js", () => ({ openAppStore: async () => new MemoryStore(), syncAllowedFor: async () => false }));
vi.mock("../src/validate-app.js", () => ({
  inspectSource: async (source: string) => ({
    definition: source.includes("BROKEN")
      ? { id: "piano", name: "Piano", entities: { session: {} } }
      : { id: "piano", name: "Piano", icon: "🎹", permissions: { notifications: true }, entities: { session: { label: "Session" } } },
    issues: source.includes("BROKEN") ? ["pages: an app needs at least one page"] : [],
  }),
}));

const { gatherFromFiles, inspectPackage, installPackage, applyShippedFiles } = await import("../src/add-app.js");
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

beforeEach(() => {
  localStorage.clear();
  stores = [];
  byApp.clear();
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

  it("an app with structure problems is refused, and nothing is saved", async () => {
    const pkg = await gatherFromFiles([file("piano.app.tsx", SOURCE + "BROKEN")]);
    const inspected = await inspectPackage(pkg);
    await expect(installPackage(pkg, inspected, { source: "file", mine: false, mode: "replace", openStore: openFor })).rejects.toThrow(/at least one page/);
    expect(getUserApp("piano")).toBeUndefined();
  });
});

describe("shipped files on their own", () => {
  it("a first install writes them all as shipped and removes nothing", async () => {
    const s = await opener();
    const r = await applyShippedFiles(s, [{ path: "a/b.json", data: new TextEncoder().encode("{}") }], { update: false });
    expect(r).toEqual({ written: ["a/b.json"], kept: [], removed: [] });
  });
});
