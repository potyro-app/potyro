// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWall, saveWall, WALL_KEY } from "../src/wall-store.js";
import { emptyWall, moveTile, reconcile, setSize } from "../src/launcher-wall.js";
import { recordTile, getEntry, listInstalledApps, sourceHash as hashOf } from "../src/launcher-store.js";
import { runTile, tileIsStale, TILE_BUDGET_MS } from "../src/tile-runner.js";

vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-diagnoses.js", () => ({ clearDiagnoses: async () => {} }));
vi.mock("../src/app-cases.js", () => ({ clearCases: async () => {} }));

// Where the wall and the live faces are kept (#96), and how a tile is run.

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("the wall's storage", () => {
  it("keeps the arrangement across a reload — a new read of storage — exactly", () => {
    let wall = reconcile(emptyWall(), [{ key: "user:a", name: "A" }, { key: "user:b", name: "B" }, { key: "user:c", name: "C" }]);
    wall = setSize(moveTile(wall, "user:c", { kind: "onto", target: "user:a" }), "user:b", "wide");
    expect(saveWall(wall)).toBe(true);
    const back = JSON.parse(localStorage.getItem(WALL_KEY)!);
    expect(back).toEqual(wall);
    // A fresh read (what a reload does) gives the same wall.
    localStorage.setItem(WALL_KEY, JSON.stringify(back));
    expect(getWall()).toEqual(wall);
  });

  it("reads garbage as an empty wall, and the same object back while nothing changed", () => {
    localStorage.setItem(WALL_KEY, "{not json");
    expect(getWall().items).toEqual([]);
    expect(getWall()).toBe(getWall());
  });

  it("announces a write, so a launcher on screen follows", () => {
    const heard = vi.fn();
    window.addEventListener("potyro:launcher:wall:changed", heard);
    saveWall(emptyWall());
    expect(heard).toHaveBeenCalledOnce();
    window.removeEventListener("potyro:launcher:wall:changed", heard);
  });

  it("leaves the previous arrangement when storage refuses the write", () => {
    saveWall(reconcile(emptyWall(), [{ key: "user:a", name: "A" }]));
    const set = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(saveWall(emptyWall())).toBe(false);
    set.mockRestore();
    expect(getWall().items).toHaveLength(1);
  });
});

describe("live faces", () => {
  const user = { id: "plants", name: "Plants", source: "export default 1", updatedAt: "2026-10-15T00:00:00.000Z", trusted: true };

  it("shows a face only for the version it was run on, and only while the app declares a tile", () => {
    localStorage.setItem("potyro:user-apps", JSON.stringify([user]));
    recordTile("user:plants", { hash: "other-version", at: new Date().toISOString(), tile: { title: "3 to water" } });
    expect(listInstalledApps()[0]!.face).toBeUndefined();
    const app = listInstalledApps()[0]!;
    expect(tileIsStale(app, Date.now())).toBe(true);
  });

  it("is stale when never run, run on another version, or older than the refresh", () => {
    const entry = (at: number, hash = "h") => ({ key: "user:x" as const, tile: { hash, at: new Date(at).toISOString() } });
    const u = { ...user, source: "s" };
    const now = Date.parse("2026-10-15T12:00:00.000Z");
    expect(tileIsStale({ user: u, entry: getEntry("user:x") }, now)).toBe(true);
    const fresh = entry(now - 60_000, hashOf("s"));
    expect(tileIsStale({ user: u, entry: fresh }, now)).toBe(false);
    expect(tileIsStale({ user: u, entry: entry(now - 60 * 60_000, hashOf("s")) }, now)).toBe(true);
    expect(tileIsStale({ user: u, entry: entry(now - 60_000, "older") }, now)).toBe(true);
  });

  const fakeLoaded = (callTile: () => Promise<unknown>) => ({ callTile, definition: { tile: "__potyro_fn__" } }) as never;
  const fakeRuntime = { ctx: {} } as never;
  const fakeStore = {} as never;

  it("keeps what a tile says, and is silent and plain when it throws, says nothing, or runs out of time", async () => {
    expect(await runTile(fakeLoaded(async () => ({ count: 3, title: "3 to water" })), fakeRuntime, fakeStore)).toEqual({ tile: { count: 3, title: "3 to water" } });
    const errors = vi.spyOn(console, "error");
    expect(await runTile(fakeLoaded(async () => Promise.reject(new Error("boom"))), fakeRuntime, fakeStore)).toEqual({});
    expect(await runTile(fakeLoaded(async () => "nonsense"), fakeRuntime, fakeStore)).toEqual({});
    vi.useFakeTimers();
    const slow = runTile(fakeLoaded(() => new Promise(() => {})), fakeRuntime, fakeStore);
    await vi.advanceTimersByTimeAsync(TILE_BUDGET_MS + 10);
    expect(await slow).toEqual({});
    expect(errors).not.toHaveBeenCalled();
  });
});

