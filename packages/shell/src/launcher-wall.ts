// The tile wall (#96, owner 2026-10-15): the launcher's home is a Windows Phone Start screen — flat
// tiles in three sizes, packed tight, in the order and the groups the person gives them.
//
// Pure functions over one `Wall` value: what is on it, in which order, at which size, in which
// group; how it packs into a grid; and every edit the launcher's edit mode makes. Nothing here reads
// storage or a clock — `launcher-store.ts` keeps the wall, and the launcher renders it.
//
// The model is a list of items, each a tile or a group of tiles. A group is a named rectangle on the
// wall (Windows 8.1/10 Start's tile groups); a tile outside every group sits between them.
// Apps taken off the wall are remembered (`unpinned`) so they stay off, and every app the wall has
// placed is remembered (`placed`), so a new app is placed once — and a group the person dissolved is
// never proposed again (`proposed`).

export type TileSize = "small" | "medium" | "wide";
export const TILE_SIZES: readonly TileSize[] = ["small", "medium", "wide"];

/** Columns × rows of the small unit each size takes. */
export const SPAN: Readonly<Record<TileSize, { w: number; h: number }>> = {
  small: { w: 1, h: 1 },
  medium: { w: 2, h: 2 },
  wide: { w: 4, h: 2 },
};

export interface WallTile {
  key: string;
  size: TileSize;
}

export interface WallGroup {
  id: string;
  /** What the person called it. Absent: the name of its `category`, in their language. */
  name?: string;
  /** The category it was proposed for, when Potyro made it: new apps of that kind join it. */
  category?: string;
  /** Shown folded into one tile: a mosaic of its apps that opens in place. */
  collapsed?: boolean;
  /** A hue for its header and area, from the tile editor's wheel. Absent: the wall's own. */
  hue?: number;
  tiles: WallTile[];
}

export type WallItem = ({ kind: "tile" } & WallTile) | ({ kind: "group" } & WallGroup);

export interface Wall {
  version: 1;
  items: WallItem[];
  /** Apps the person took off the wall: they stay in All apps, and stay off. */
  unpinned: string[];
  /** Every app the wall has placed once. An app not here is new, and is placed. */
  placed: string[];
  /** Categories Potyro has proposed a group for. Dissolving one does not bring it back. */
  proposed: string[];
}

export const emptyWall = (): Wall => ({ version: 1, items: [], unpinned: [], placed: [], proposed: [] });

/** What the wall needs to know about an installed app to place it. */
export interface WallApp {
  key: string;
  /** `AppDefinition.category`, or the local rule's guess. */
  category?: string;
  /** It declares a live tile: it is worth a bigger face. */
  live?: boolean;
  /** How much it is used (`frecency`): the most used start bigger. */
  score?: number;
  name: string;
}

// ─── reading ─────────────────────────────────────────────────────────────────────────────────

/** Every tile on the wall, in reading order, with the group it is in. */
export function wallTiles(wall: Wall): { tile: WallTile; group: string | null }[] {
  const out: { tile: WallTile; group: string | null }[] = [];
  for (const item of wall.items) {
    if (item.kind === "tile") out.push({ tile: { key: item.key, size: item.size }, group: null });
    else for (const t of item.tiles) out.push({ tile: t, group: item.id });
  }
  return out;
}

export const onWall = (wall: Wall, key: string): boolean => wallTiles(wall).some((t) => t.tile.key === key);
export type GroupItem = { kind: "group" } & WallGroup;
export const groupOf = (wall: Wall, key: string): GroupItem | null => {
  for (const item of wall.items) if (item.kind === "group" && item.tiles.some((t) => t.key === key)) return item;
  return null;
};
export const sizeOf = (wall: Wall, key: string): TileSize | null => wallTiles(wall).find((t) => t.tile.key === key)?.tile.size ?? null;

// ─── packing ─────────────────────────────────────────────────────────────────────────────────

export interface Placed {
  key: string;
  /** Zero-based column and row of the tile's top-left unit. */
  col: number;
  row: number;
  w: number;
  h: number;
}

/**
 * Pack tiles into `cols` columns, in order, each into the first place it fits scanning row by row
 * from the top — so four small tiles fill the square a medium leaves beside it, the way Start does.
 * A tile wider than the grid is narrowed to it. Returns the places and the rows used.
 */
export function pack(tiles: readonly WallTile[], cols: number): { placed: Placed[]; rows: number } {
  const width = Math.max(1, Math.floor(cols));
  const filled: boolean[][] = [];
  const free = (r: number, c: number): boolean => !filled[r]?.[c];
  const fits = (r: number, c: number, w: number, h: number): boolean => {
    if (c + w > width) return false;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (!free(y, x)) return false;
    return true;
  };
  const placed: Placed[] = [];
  let rows = 0;
  for (const tile of tiles) {
    const span = SPAN[tile.size];
    const w = Math.min(span.w, width);
    const h = span.h;
    let done = false;
    for (let r = 0; !done; r++) {
      for (let c = 0; c + w <= width; c++) {
        if (!fits(r, c, w, h)) continue;
        for (let y = r; y < r + h; y++) {
          filled[y] ??= [];
          for (let x = c; x < c + w; x++) filled[y]![x] = true;
        }
        placed.push({ key: tile.key, col: c, row: r, w, h });
        rows = Math.max(rows, r + h);
        done = true;
        break;
      }
    }
  }
  return { placed, rows };
}

/**
 * The tile a spatial arrow key lands on from `from`: the nearest tile whose box lies in that
 * direction, measured centre to centre with the cross axis weighted double — what a person expects
 * from a grid of mixed sizes.
 */
export function neighbour(placed: readonly Placed[], from: string, dir: "left" | "right" | "up" | "down"): string | null {
  const a = placed.find((p) => p.key === from);
  if (!a) return null;
  const cx = (p: Placed): number => p.col + p.w / 2;
  const cy = (p: Placed): number => p.row + p.h / 2;
  let best: { key: string; d: number } | null = null;
  for (const p of placed) {
    if (p.key === from) continue;
    const dx = cx(p) - cx(a);
    const dy = cy(p) - cy(a);
    const ahead =
      dir === "left" ? p.col + p.w <= a.col : dir === "right" ? p.col >= a.col + a.w : dir === "up" ? p.row + p.h <= a.row : p.row >= a.row + a.h;
    if (!ahead) continue;
    const d = dir === "left" || dir === "right" ? Math.abs(dx) + 2 * Math.abs(dy) : Math.abs(dy) + 2 * Math.abs(dx);
    if (!best || d < best.d) best = { key: p.key, d };
  }
  return best?.key ?? null;
}

// ─── placing apps ────────────────────────────────────────────────────────────────────────────

let seq = 0;
/** A group id nobody else has: time and a counter, base 36. Ids are only compared, never shown. */
export function newGroupId(now = Date.now()): string {
  seq = (seq + 1) % 1_000;
  return `g${now.toString(36)}${seq.toString(36)}`;
}

/**
 * Starting sizes for apps placed together (a first run, a library restored): the most used app with
 * a live face is wide, other live apps and used ones medium, the rest small — and an odd medium
 * left over at the end becomes wide, so the run ends on a full row.
 */
export function startingSizes(apps: readonly WallApp[]): Map<string, TileSize> {
  const sizes = new Map<string, TileSize>();
  const ranked = [...apps].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || Number(Boolean(b.live)) - Number(Boolean(a.live)));
  const hero = ranked.find((a) => a.live) ?? (ranked[0]?.score ? ranked[0] : undefined);
  for (const app of apps) sizes.set(app.key, app.key === hero?.key && apps.length > 2 ? "wide" : app.live || (app.score ?? 0) > 0 ? "medium" : "small");
  const mediums = apps.filter((a) => sizes.get(a.key) === "medium");
  const smalls = apps.filter((a) => sizes.get(a.key) === "small");
  // Smalls come in fours to a medium's square; an odd medium with no smalls to share its row is widened.
  if (mediums.length % 2 === 1 && smalls.length === 0) sizes.set(mediums[mediums.length - 1]!.key, "wide");
  return sizes;
}

/**
 * Bring the wall in line with what is installed: tiles of apps that are gone go, groups left empty
 * go, and every app the wall has not placed yet is placed — into the group proposed for its
 * category (made now if this is the first app of that kind), or at the end. `canPlace` holds a new
 * app back (its category is not known yet) without touching it if it is already on the wall.
 */
export function reconcile(wall: Wall, apps: readonly WallApp[], canPlace: (app: WallApp) => boolean = () => true): Wall {
  const live = new Set(apps.map((a) => a.key));
  let items: WallItem[] = wall.items
    .map((item): WallItem | null => {
      if (item.kind === "tile") return live.has(item.key) ? item : null;
      const tiles = item.tiles.filter((t) => live.has(t.key));
      if (tiles.length === item.tiles.length) return item;
      return tiles.length ? { ...item, tiles } : null;
    })
    .filter((i): i is WallItem => i !== null);
  const placed = wall.placed.filter((k) => live.has(k));
  const unpinned = wall.unpinned.filter((k) => live.has(k));
  const proposed = [...wall.proposed];
  // New apps in the order a person would look for them: the used ones first, then by name.
  const fresh = apps
    .filter((a) => !placed.includes(a.key) && !unpinned.includes(a.key) && canPlace(a))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const untouched =
    items.length === wall.items.length && items.every((it, i) => it === wall.items[i]) && placed.length === wall.placed.length && unpinned.length === wall.unpinned.length;
  // Nothing changed: the same object back, so a caller can tell there is nothing to write.
  if (!fresh.length && untouched) return wall;
  // Starting sizes per destination — a group, or the loose run — so each ends on a full row.
  const groupedAs = (app: WallApp): string => (app.category ? `c:${app.category}` : "loose");
  const sizes = new Map<string, TileSize>();
  for (const dest of new Set(fresh.map(groupedAs))) for (const [k, v] of startingSizes(fresh.filter((a) => groupedAs(a) === dest))) sizes.set(k, v);
  const categoryOf = new Map(apps.map((a) => [a.key, a.category]));
  for (const app of fresh) {
    const tile: WallTile = { key: app.key, size: sizes.get(app.key) ?? "small" };
    const cat = app.category;
    const home = cat ? items.find((i): i is { kind: "group" } & WallGroup => i.kind === "group" && i.category === cat) : undefined;
    // A group is proposed for a kind once there are two of it: a group of one is just a tile in a box.
    const kin = cat ? [...fresh.filter((f) => f.category === cat), ...items.filter((i) => i.kind === "tile" && categoryOf.get(i.key) === cat)] : [];
    if (home) {
      items = items.map((i) => (i === home ? { ...home, tiles: [...home.tiles, tile] } : i));
    } else if (cat && !proposed.includes(cat) && kin.length >= 2) {
      proposed.push(cat);
      // Loose tiles of the same kind, placed before there were two, join it.
      const joining = items.filter((i): i is { kind: "tile" } & WallTile => i.kind === "tile" && categoryOf.get(i.key) === cat);
      const at = joining.length ? items.indexOf(joining[0]!) : items.length;
      const group: WallItem = { kind: "group", id: newGroupId(), category: cat, tiles: [...joining.map((j) => ({ key: j.key, size: j.size })), tile] };
      items = [...items.slice(0, at), group, ...items.slice(at)].filter((i) => !joining.includes(i as never));
    } else {
      items = [...items, { kind: "tile", ...tile }];
    }
    placed.push(app.key);
  }
  return { version: 1, items, unpinned, placed, proposed };
}

// ─── editing ─────────────────────────────────────────────────────────────────────────────────

/** Remove a tile from wherever it is; a group it leaves empty goes too. */
function lift(items: readonly WallItem[], key: string): { items: WallItem[]; tile: WallTile | null } {
  let tile: WallTile | null = null;
  const out: WallItem[] = [];
  for (const item of items) {
    if (item.kind === "tile") {
      if (item.key === key) tile = { key: item.key, size: item.size };
      else out.push(item);
      continue;
    }
    const kept = item.tiles.filter((t) => {
      if (t.key !== key) return true;
      tile = t;
      return false;
    });
    if (kept.length) out.push(kept.length === item.tiles.length ? item : { ...item, tiles: kept });
  }
  return { items: out, tile };
}

export function setSize(wall: Wall, key: string, size: TileSize): Wall {
  const resize = (t: WallTile): WallTile => (t.key === key ? { ...t, size } : t);
  return {
    ...wall,
    items: wall.items.map((i) => (i.kind === "tile" ? (i.key === key ? { ...i, size } : i) : { ...i, tiles: i.tiles.map(resize) })),
  };
}

/** small → medium → wide → small: one button that cycles, like Start's resize arrow. */
export function nextSize(size: TileSize): TileSize {
  return TILE_SIZES[(TILE_SIZES.indexOf(size) + 1) % TILE_SIZES.length]!;
}

export function unpin(wall: Wall, key: string): Wall {
  const { items } = lift(wall.items, key);
  return { ...wall, items, unpinned: wall.unpinned.includes(key) ? wall.unpinned : [...wall.unpinned, key] };
}

/** Back onto the wall, at the end, medium — where you will see it. */
export function pin(wall: Wall, key: string, size: TileSize = "medium"): Wall {
  if (onWall(wall, key)) return wall;
  return {
    ...wall,
    items: [...wall.items, { kind: "tile", key, size }],
    unpinned: wall.unpinned.filter((k) => k !== key),
    placed: wall.placed.includes(key) ? wall.placed : [...wall.placed, key],
  };
}

/** Where a dragged tile can land. */
export type Drop =
  /** Before or after another tile, in that tile's group (or between groups when it is in none). */
  | { kind: "beside"; target: string; after: boolean }
  /** On another tile: the two make a group, or the tile joins the target's group. */
  | { kind: "onto"; target: string }
  /** Into a group, at its end (its header or its empty area). */
  | { kind: "into"; group: string }
  /** Out of every group, at the end of the wall. */
  | { kind: "end" };

/**
 * Move a tile. Dropping onto a tile that is in no group makes a new group of the two, in the
 * target's place; onto a grouped tile, joins that group after it.
 */
export function moveTile(wall: Wall, key: string, drop: Drop, now = Date.now()): Wall {
  if ((drop.kind === "beside" || drop.kind === "onto") && drop.target === key) return wall;
  const { items, tile } = lift(wall.items, key);
  if (!tile) return wall;
  const insertAt = (list: WallItem[], index: number, item: WallItem): WallItem[] => [...list.slice(0, index), item, ...list.slice(index)];

  if (drop.kind === "end") return { ...wall, items: [...items, { kind: "tile", ...tile }] };
  if (drop.kind === "into") {
    if (!items.some((i) => i.kind === "group" && i.id === drop.group)) return wall;
    return { ...wall, items: items.map((i) => (i.kind === "group" && i.id === drop.group ? { ...i, tiles: [...i.tiles, tile] } : i)) };
  }
  // The target's place, after the dragged tile has been lifted out.
  const top = items.findIndex((i) => i.kind === "tile" && i.key === drop.target);
  const group = items.find((i): i is { kind: "group" } & WallGroup => i.kind === "group" && i.tiles.some((t) => t.key === drop.target));
  if (top < 0 && !group) return wall;

  if (drop.kind === "onto") {
    if (group) {
      const at = group.tiles.findIndex((t) => t.key === drop.target) + 1;
      return { ...wall, items: items.map((i) => (i === group ? { ...group, tiles: [...group.tiles.slice(0, at), tile, ...group.tiles.slice(at)] } : i)) };
    }
    const target = items[top] as { kind: "tile" } & WallTile;
    const made: WallItem = { kind: "group", id: newGroupId(now), tiles: [{ key: target.key, size: target.size }, tile] };
    return { ...wall, items: items.map((i, n) => (n === top ? made : i)) };
  }
  // beside
  if (group) {
    const at = group.tiles.findIndex((t) => t.key === drop.target) + (drop.after ? 1 : 0);
    return { ...wall, items: items.map((i) => (i === group ? { ...group, tiles: [...group.tiles.slice(0, at), tile, ...group.tiles.slice(at)] } : i)) };
  }
  return { ...wall, items: insertAt(items, top + (drop.after ? 1 : 0), { kind: "tile", ...tile }) };
}

/** Out of its group, right after it on the wall. */
export function ungroup(wall: Wall, key: string): Wall {
  const group = groupOf(wall, key);
  if (!group) return wall;
  const tile = group.tiles.find((t) => t.key === key)!;
  const out: WallItem[] = [];
  for (const item of wall.items) {
    if (item !== group) {
      out.push(item);
      continue;
    }
    const rest = group.tiles.filter((t) => t.key !== key);
    if (rest.length) out.push({ ...group, tiles: rest });
    out.push({ kind: "tile", ...tile });
  }
  return { ...wall, items: out };
}

/** Every tile of the group back on the wall, in its place; the group is gone. */
export function dissolve(wall: Wall, id: string): Wall {
  return { ...wall, items: wall.items.flatMap((i) => (i.kind === "group" && i.id === id ? i.tiles.map((t) => ({ kind: "tile" as const, ...t })) : [i])) };
}

export function updateGroup(wall: Wall, id: string, patch: Partial<Pick<WallGroup, "name" | "collapsed" | "hue">>): Wall {
  return {
    ...wall,
    items: wall.items.map((i) => {
      if (i.kind !== "group" || i.id !== id) return i;
      const next: { kind: "group" } & WallGroup = { ...i, ...patch };
      for (const k of ["name", "hue", "collapsed"] as const) if (next[k] === undefined || next[k] === "" || next[k] === false) delete next[k];
      return next;
    }),
  };
}

/** The key a wall item is reordered by: a tile's app key, a group's id. */
export const itemId = (item: WallItem): string => (item.kind === "tile" ? item.key : item.id);

/**
 * Move a tile one step earlier or later in reading order (the keyboard's Alt+arrows). Inside a group
 * it moves among the group's tiles, and past the group's edge it steps out of it; on the wall it moves
 * among the wall's items, stepping past a group rather than into it (grouping is its own command).
 */
export function step(wall: Wall, key: string, by: -1 | 1): Wall {
  const group = groupOf(wall, key);
  if (group) {
    const at = group.tiles.findIndex((t) => t.key === key);
    const to = at + by;
    if (to < 0 || to >= group.tiles.length) {
      // Out of the group, before or after it.
      const tile = group.tiles[at]!;
      const rest = group.tiles.filter((t) => t.key !== key);
      const out: WallItem[] = [];
      for (const item of wall.items) {
        if (item !== group) {
          out.push(item);
          continue;
        }
        if (by < 0) out.push({ kind: "tile", ...tile });
        if (rest.length) out.push({ ...group, tiles: rest });
        if (by > 0) out.push({ kind: "tile", ...tile });
      }
      return { ...wall, items: out };
    }
    const tiles = [...group.tiles];
    [tiles[at], tiles[to]] = [tiles[to]!, tiles[at]!];
    return { ...wall, items: wall.items.map((i) => (i === group ? { ...group, tiles } : i)) };
  }
  return moveItem(wall, key, by);
}

/** Move a wall item (a loose tile, or a whole group) one place earlier or later. */
export function moveItem(wall: Wall, id: string, by: -1 | 1): Wall {
  const at = wall.items.findIndex((i) => itemId(i) === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= wall.items.length) return wall;
  const items = [...wall.items];
  [items[at], items[to]] = [items[to]!, items[at]!];
  return { ...wall, items };
}

/**
 * Move a whole group to where it was dropped: before or after the wall item under the drop — a loose
 * tile, another group, or the group a tile is in — or to the end.
 */
export function placeGroup(wall: Wall, id: string, drop: Drop): Wall {
  const at = wall.items.findIndex((i) => i.kind === "group" && i.id === id);
  if (at < 0) return wall;
  const group = wall.items[at]!;
  const rest = wall.items.filter((_, n) => n !== at);
  if (drop.kind === "end") return { ...wall, items: [...rest, group] };
  if (drop.kind === "into") return wall;
  const target = drop.target.startsWith("group:") ? drop.target.slice("group:".length) : (groupOf(wall, drop.target)?.id ?? drop.target);
  if (target === id) return wall;
  const to = rest.findIndex((i) => itemId(i) === target);
  if (to < 0) return wall;
  const after = drop.kind === "beside" ? drop.after : true;
  return { ...wall, items: [...rest.slice(0, to + (after ? 1 : 0)), group, ...rest.slice(to + (after ? 1 : 0))] };
}

/** Into the group the next (or previous) wall item is — the keyboard's way to group. */
export function groupWithNeighbour(wall: Wall, key: string, by: -1 | 1, now = Date.now()): Wall {
  if (groupOf(wall, key)) return wall;
  const at = wall.items.findIndex((i) => i.kind === "tile" && i.key === key);
  const other = wall.items[at + by];
  if (at < 0 || !other) return wall;
  if (other.kind === "group") return moveTile(wall, key, { kind: "into", group: other.id }, now);
  return moveTile(wall, key, { kind: "onto", target: other.key }, now);
}

// ─── checking what storage holds ─────────────────────────────────────────────────────────────

const isSize = (v: unknown): v is TileSize => v === "small" || v === "medium" || v === "wide";
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

/**
 * A wall read back from storage, kept only as far as it makes sense: a broken entry is dropped, never
 * the whole wall, and an app key appears once.
 */
export function parseWall(raw: unknown): Wall {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyWall();
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const tile = (v: unknown): WallTile | null => {
    if (!v || typeof v !== "object") return null;
    const t = v as Record<string, unknown>;
    if (typeof t.key !== "string" || !t.key || seen.has(t.key)) return null;
    seen.add(t.key);
    return { key: t.key, size: isSize(t.size) ? t.size : "small" };
  };
  const items: WallItem[] = [];
  for (const v of Array.isArray(r.items) ? r.items : []) {
    if (!v || typeof v !== "object") continue;
    const i = v as Record<string, unknown>;
    if (i.kind === "tile") {
      const t = tile(i);
      if (t) items.push({ kind: "tile", ...t });
    } else if (i.kind === "group" && typeof i.id === "string" && i.id) {
      const tiles = (Array.isArray(i.tiles) ? i.tiles : []).map(tile).filter((t): t is WallTile => t !== null);
      if (!tiles.length) continue;
      items.push({
        kind: "group",
        id: i.id,
        tiles,
        ...(typeof i.name === "string" && i.name.trim() ? { name: i.name.trim().slice(0, 40) } : {}),
        ...(typeof i.category === "string" && i.category ? { category: i.category } : {}),
        ...(i.collapsed === true ? { collapsed: true } : {}),
        ...(typeof i.hue === "number" && Number.isFinite(i.hue) ? { hue: i.hue } : {}),
      });
    }
  }
  return { version: 1, items, unpinned: strings(r.unpinned), placed: strings(r.placed), proposed: strings(r.proposed) };
}
