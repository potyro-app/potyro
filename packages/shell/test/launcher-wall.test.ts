import { describe, expect, it } from "vitest";
import {
  dissolve,
  emptyWall,
  groupOf,
  groupWithNeighbour,
  moveTile,
  neighbour,
  nextSize,
  pack,
  parseWall,
  pin,
  reconcile,
  setSize,
  startingSizes,
  step,
  ungroup,
  unpin,
  updateGroup,
  wallTiles,
  moveItem,
  type Wall,
  type WallApp,
} from "../src/launcher-wall.js";

// The tile wall (#96): packing, placing new apps, every edit edit mode makes, and what storage gives back.

const keys = (w: Wall): string[] => wallTiles(w).map((t) => t.tile.key);
const at = (placed: ReturnType<typeof pack>["placed"], key: string) => {
  const p = placed.find((x) => x.key === key)!;
  return [p.col, p.row];
};
const apps = (...list: Array<string | Partial<WallApp> & { key: string }>): WallApp[] =>
  list.map((a) => (typeof a === "string" ? { key: a, name: a } : { name: a.key, ...a }));

describe("pack", () => {
  it("places tiles first-fit, row by row, so four smalls fill the square beside a medium", () => {
    const { placed, rows } = pack(
      [
        { key: "m1", size: "medium" },
        { key: "s1", size: "small" },
        { key: "s2", size: "small" },
        { key: "s3", size: "small" },
        { key: "s4", size: "small" },
        { key: "w", size: "wide" },
      ],
      4,
    );
    expect(at(placed, "m1")).toEqual([0, 0]);
    expect([at(placed, "s1"), at(placed, "s2"), at(placed, "s3"), at(placed, "s4")]).toEqual([[2, 0], [3, 0], [2, 1], [3, 1]]);
    expect(at(placed, "w")).toEqual([0, 2]);
    expect(rows).toBe(4);
  });

  it("fills a hole a wide tile left with a later small one, and never overlaps", () => {
    const { placed } = pack(
      [
        { key: "s1", size: "small" },
        { key: "w", size: "wide" },
        { key: "s2", size: "small" },
      ],
      4,
    );
    expect(at(placed, "w")).toEqual([0, 1]);
    expect(at(placed, "s2")).toEqual([1, 0]); // into row 0, beside s1
    const cells = new Set<string>();
    for (const p of placed) for (let y = p.row; y < p.row + p.h; y++) for (let x = p.col; x < p.col + p.w; x++) {
      expect(cells.has(`${x},${y}`)).toBe(false);
      cells.add(`${x},${y}`);
    }
  });

  it("narrows a wide tile to a grid narrower than it, and uses more columns when there are more", () => {
    expect(pack([{ key: "w", size: "wide" }], 2).placed[0]).toMatchObject({ w: 2, h: 2 });
    const eight = pack(
      [
        { key: "a", size: "wide" },
        { key: "b", size: "wide" },
      ],
      8,
    );
    expect(at(eight.placed, "b")).toEqual([4, 0]);
    expect(eight.rows).toBe(2);
  });
});

describe("neighbour", () => {
  const { placed } = pack(
    [
      { key: "m", size: "medium" },
      { key: "s1", size: "small" },
      { key: "s2", size: "small" },
      { key: "s3", size: "small" },
      { key: "s4", size: "small" },
      { key: "w", size: "wide" },
    ],
    4,
  );
  it("moves the way the arrow points, to the nearest tile", () => {
    expect(neighbour(placed, "m", "right")).toBe("s1");
    expect(neighbour(placed, "s1", "right")).toBe("s2");
    expect(neighbour(placed, "s2", "down")).toBe("s4");
    expect(neighbour(placed, "s3", "left")).toBe("m");
    expect(neighbour(placed, "m", "down")).toBe("w");
    expect(neighbour(placed, "w", "up")).toBe("s3"); // straight above its middle
    expect(neighbour(placed, "m", "up")).toBeNull();
  });
});

describe("placing apps", () => {
  it("starts the most used live app wide, live apps medium, the rest small", () => {
    const sizes = startingSizes(apps({ key: "a", live: true }, { key: "b", live: true, score: 50 }, { key: "c" }, { key: "d", live: true }));
    expect(Object.fromEntries(sizes)).toEqual({ a: "medium", b: "wide", c: "small", d: "medium" });
  });

  it("widens an odd medium with no small tiles to share its row", () => {
    const sizes = startingSizes(apps({ key: "a", live: true }, { key: "b", live: true }, { key: "c", live: true }, { key: "d", live: true }));
    expect([...sizes.values()].filter((s) => s === "wide")).toHaveLength(2);
  });

  it("groups apps by the category they declare, proposes each group once, and places a new app once", () => {
    let wall = reconcile(emptyWall(), apps({ key: "groceries", category: "everyday" }, { key: "plants", category: "everyday" }, { key: "notes" }));
    expect(wall.items.map((i) => i.kind)).toEqual(["group", "tile"]);
    const everyday = wall.items[0]!;
    expect(everyday.kind === "group" && everyday.category).toBe("everyday");
    expect(everyday.kind === "group" && everyday.tiles.map((t) => t.key)).toEqual(["groceries", "plants"]);
    expect(reconcile(wall, apps({ key: "groceries", category: "everyday" }, { key: "plants", category: "everyday" }, { key: "notes" }))).toBe(wall); // nothing to do: the same object

    // A game arrives: a Games group appears. A later game joins it.
    wall = reconcile(wall, apps({ key: "groceries", category: "everyday" }, { key: "plants", category: "everyday" }, { key: "notes" }, { key: "breakout", category: "games" }));
    wall = reconcile(wall, apps({ key: "groceries", category: "everyday" }, { key: "plants", category: "everyday" }, { key: "notes" }, { key: "breakout", category: "games" }, { key: "daily", category: "games" }));
    expect(groupOf(wall, "daily")?.tiles.map((t) => t.key)).toEqual(["breakout", "daily"]);

    // The person takes Games apart; the next game does not bring it back.
    wall = dissolve(wall, groupOf(wall, "daily")!.id);
    wall = reconcile(wall, apps({ key: "groceries", category: "everyday" }, { key: "plants", category: "everyday" }, { key: "notes" }, { key: "breakout", category: "games" }, { key: "daily", category: "games" }, { key: "puzzle", category: "games" }));
    expect(groupOf(wall, "puzzle")).toBeNull();
  });

  it("leaves one of a kind loose, and makes the group when the second arrives, taking the first in", () => {
    let wall = reconcile(emptyWall(), apps("notes", { key: "piano", category: "music" }));
    expect(wall.items.every((i) => i.kind === "tile")).toBe(true);
    wall = reconcile(wall, apps("notes", { key: "piano", category: "music" }, { key: "drums", category: "music" }));
    expect(wall.items.map((i) => (i.kind === "tile" ? i.key : `[${i.tiles.map((t) => t.key).join(",")}]`))).toEqual(["notes", "[piano,drums]"]);
  });

  it("drops the tiles of apps that are gone, and a group they leave empty", () => {
    let wall = reconcile(emptyWall(), apps({ key: "a", category: "games" }, "b"));
    wall = reconcile(wall, apps("b"));
    expect(wall.items).toEqual([{ kind: "tile", key: "b", size: "small" }]);
    expect(wall.placed).toEqual(["b"]);
  });

  it("keeps an unpinned app off the wall, and pins it back at the end", () => {
    let wall = reconcile(emptyWall(), apps("a", "b"));
    wall = unpin(wall, "a");
    expect(keys(reconcile(wall, apps("a", "b")))).toEqual(["b"]);
    wall = pin(wall, "a");
    expect(keys(wall)).toEqual(["b", "a"]);
    expect(wall.unpinned).toEqual([]);
  });
});

describe("editing the wall", () => {
  const base = (): Wall => reconcile(emptyWall(), apps("a", "b", "c", "d"));

  it("resizes, and cycles small → medium → wide → small", () => {
    expect(wallTiles(setSize(base(), "c", "wide")).find((t) => t.tile.key === "c")?.tile.size).toBe("wide");
    expect([nextSize("small"), nextSize("medium"), nextSize("wide")]).toEqual(["medium", "wide", "small"]);
  });

  it("drops onto a loose tile to make a group of the two, in its place", () => {
    const wall = moveTile(base(), "d", { kind: "onto", target: "b" });
    expect(wall.items.map((i) => (i.kind === "tile" ? i.key : `[${i.tiles.map((t) => t.key).join(",")}]`))).toEqual(["a", "[b,d]", "c"]);
  });

  it("drops onto a grouped tile or into a group to join it, and out of it to leave", () => {
    let wall = moveTile(base(), "d", { kind: "onto", target: "b" });
    const id = groupOf(wall, "b")!.id;
    wall = moveTile(wall, "a", { kind: "onto", target: "b" });
    expect(groupOf(wall, "a")?.tiles.map((t) => t.key)).toEqual(["b", "a", "d"]);
    wall = moveTile(wall, "c", { kind: "into", group: id });
    expect(groupOf(wall, "c")?.tiles.map((t) => t.key)).toEqual(["b", "a", "d", "c"]);
    wall = ungroup(wall, "a");
    expect(groupOf(wall, "a")).toBeNull();
    expect(wall.items.map((i) => (i.kind === "tile" ? i.key : "G"))).toEqual(["G", "a"]);
    wall = moveTile(wall, "b", { kind: "end" });
    expect(wall.items.map((i) => (i.kind === "tile" ? i.key : "G"))).toEqual(["G", "a", "b"]);
  });

  it("drops beside a tile to reorder, within a group or on the wall", () => {
    expect(keys(moveTile(base(), "d", { kind: "beside", target: "a", after: false }))).toEqual(["d", "a", "b", "c"]);
    expect(keys(moveTile(base(), "a", { kind: "beside", target: "c", after: true }))).toEqual(["b", "c", "a", "d"]);
    const grouped = moveTile(base(), "d", { kind: "onto", target: "b" });
    expect(keys(moveTile(grouped, "d", { kind: "beside", target: "b", after: false }))).toEqual(["a", "d", "b", "c"]);
  });

  it("a group left with no tiles goes; dropping a tile on itself changes nothing", () => {
    let wall = moveTile(base(), "d", { kind: "onto", target: "b" });
    wall = ungroup(ungroup(wall, "b"), "d");
    expect(wall.items.every((i) => i.kind === "tile")).toBe(true);
    const same = base();
    expect(moveTile(same, "a", { kind: "onto", target: "a" })).toBe(same);
  });

  it("renames, recolours and folds a group, and forgets a cleared name", () => {
    let wall = moveTile(base(), "d", { kind: "onto", target: "b" });
    const id = groupOf(wall, "b")!.id;
    wall = updateGroup(wall, id, { name: "Daily", hue: 145, collapsed: true });
    expect(groupOf(wall, "b")).toMatchObject({ name: "Daily", hue: 145, collapsed: true });
    wall = updateGroup(wall, id, { name: "", collapsed: false });
    expect(groupOf(wall, "b")).not.toHaveProperty("name");
    expect(groupOf(wall, "b")).not.toHaveProperty("collapsed");
  });

  it("steps by keyboard: among a group's tiles, out past its edge, and past whole groups on the wall", () => {
    let wall = moveTile(base(), "d", { kind: "onto", target: "b" }); // a [b,d] c
    wall = step(wall, "d", -1); // a [d,b] c
    expect(groupOf(wall, "d")?.tiles.map((t) => t.key)).toEqual(["d", "b"]);
    wall = step(wall, "d", -1); // a d [b] c
    expect(groupOf(wall, "d")).toBeNull();
    expect(wall.items.map((i) => (i.kind === "tile" ? i.key : "G"))).toEqual(["a", "d", "G", "c"]);
    wall = step(wall, "c", -1); // a d c [b]
    expect(wall.items.map((i) => (i.kind === "tile" ? i.key : "G"))).toEqual(["a", "d", "c", "G"]);
    const g = groupOf(wall, "b")!.id;
    expect(moveItem(wall, g, -1).items.map((i) => (i.kind === "tile" ? i.key : "G"))).toEqual(["a", "d", "G", "c"]);
  });

  it("groups by keyboard with the next item: a tile, or a group", () => {
    let wall = groupWithNeighbour(base(), "a", 1);
    expect(groupOf(wall, "a")?.tiles.map((t) => t.key)).toEqual(["b", "a"]);
    wall = groupWithNeighbour(wall, "c", -1);
    expect(groupOf(wall, "c")?.tiles.map((t) => t.key)).toEqual(["b", "a", "c"]);
  });
});

describe("parseWall", () => {
  it("keeps what makes sense of what storage holds, and drops the rest piece by piece", () => {
    const wall = parseWall({
      items: [
        { kind: "tile", key: "a", size: "wide" },
        { kind: "tile", key: "a", size: "small" }, // twice: the second goes
        { kind: "tile", size: "small" },
        { kind: "group", id: "g1", name: "  Games ", hue: 25, collapsed: true, tiles: [{ key: "b", size: "huge" }, null] },
        { kind: "group", id: "g2", tiles: [] },
        "nonsense",
      ],
      unpinned: ["c", 4],
      placed: ["a", "b"],
    });
    expect(wall.items).toEqual([
      { kind: "tile", key: "a", size: "wide" },
      { kind: "group", id: "g1", name: "Games", hue: 25, collapsed: true, tiles: [{ key: "b", size: "small" }] },
    ]);
    expect(wall.unpinned).toEqual(["c"]);
    expect(wall.proposed).toEqual([]);
    for (const junk of [null, 3, "x", [], { items: "no" }]) expect(parseWall(junk).items).toEqual([]);
  });
});
