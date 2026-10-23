// The home screen as a Windows Phone Start screen (#96; owner, 2026-10-15 — this settles #93).
//
// Two panes, side by side, one swipe or one tab apart, the way a Metro pivot is: "Start", the tile
// wall the person arranges, and "All apps", every app by name with letter headers to jump by.
// Underneath, a slim app bar: New app, Add an app, Find, Data, Look, You.
//
// The wall is `launcher-wall.ts`'s model, kept per device (`wall-store.ts`): tiles in three sizes,
// packed tight (`pack`), in groups the person makes by dropping one tile on another. Holding a tile
// is edit mode (`wall-drag.ts`): every other tile steps back, the held one can be resized, unpinned,
// grouped, carried; an edit bar takes the app bar's place with the same commands for a keyboard.
//
// The live faces come from each app's own `tile` (docs/04 §Tile), run by `tile-runner.ts` after the
// wall has painted, never before it.

import { openGallery } from "./gallery-link.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type MutableRefObject } from "react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { attentionOf, describeAttention, type InstalledApp } from "./launcher-store.js";
import { frecency } from "./launcher-order.js";
import {
  SPAN,
  TILE_SIZES,
  dissolve,
  groupOf,
  groupWithNeighbour,
  moveItem,
  moveTile,
  neighbour,
  pack,
  pin,
  placeGroup,
  reconcile,
  setSize,
  step,
  ungroup,
  unpin,
  updateGroup,
  wallTiles,
  type Drop,
  type Placed,
  type TileSize,
  type Wall,
  type WallApp,
  type WallGroup,
  type WallItem,
  type WallTile,
} from "./launcher-wall.js";
import { getWall, saveWall, useWall } from "./wall-store.js";
import { MetroTile, tileColours } from "./metro-tile.js";
import { useWallDrag } from "./wall-drag.js";
import { categoryName } from "./launcher-groups.js";
import { refreshTiles, TILE_REFRESH_MS } from "./tile-runner.js";
import { TILE_HUES, hueColour } from "./tile-identity.js";
import { TileGlyph } from "./tile-glyph.js";
import { shellDialogs } from "./dialog.js";
import { DatabaseIcon } from "./data-icon.js";
import { DEFAULT_NAME, peekIdentity } from "@potyro/identity";
import { personHue, personInitials } from "@potyro/runtime";
import { fmt } from "@potyro/i18n";
import { Wordmark } from "./wordmark.js";
import { I } from "./icons.js";

const GAP = 6;
/** How long the wall waits for an app's declared identity (its category, its tile) before placing it anyway. */
const PATIENCE_MS = 2_500;
/** The turnstile: how long the wall takes to swing away before the app opens. */
const LEAVE_MS = 240;
/** How often a live tile turns over: every tick, a third of them do. */
const FLIP_TICK_MS = 2_600;

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ─── the wall, arranged ──────────────────────────────────────────────────────────────────────

function wallApps(installed: readonly InstalledApp[], now: number): WallApp[] {
  return installed.map((a) => ({
    key: a.key,
    name: a.name,
    ...(a.category ? { category: a.category } : {}),
    live: a.live,
    // What #84 knew carries over: pinned apps first, in their order, then by use.
    score: (a.entry.pinned ? 1_000_000 - (a.entry.order ?? 0) : 0) + frecency(a.entry, now),
  }));
}

/**
 * The wall for what is installed: the stored arrangement, with new apps placed and gone ones dropped.
 * Computed while rendering, so the first frame is already right; written back after it.
 */
function useArrangedWall(installed: readonly InstalledApp[], now: number): Wall {
  const stored = useWall();
  const [patient, setPatient] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPatient(true), PATIENCE_MS);
    return () => clearTimeout(t);
  }, []);
  // An app is placed once its declared category and tile are known, so a first run lands in its
  // groups instead of in a heap; one whose source cannot be read is placed after a moment anyway.
  const ready = new Set<string>(installed.filter((a) => a.identified || patient).map((a) => a.key));
  const arranged = useMemo(
    () => reconcile(stored, wallApps(installed, now), (a) => ready.has(a.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stored, installed.map((a) => `${a.key}:${a.category ?? ""}:${a.live}:${ready.has(a.key)}`).join(",")],
  );
  useEffect(() => {
    if (arranged !== stored && JSON.stringify(arranged) !== JSON.stringify(stored)) saveWall(arranged);
  }, [arranged, stored]);
  return arranged;
}

/** Columns and the unit's size, from the wall's own width: four big squares on a phone, a denser wall on a desk. */
function useMeasure(ref: RefObject<HTMLElement | null>): { cols: number; unit: number; wide: boolean } {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 375 : Math.min(window.innerWidth, 1400) - 24));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  if (width < 560) return { cols: 4, unit: Math.max(56, Math.floor((width - 3 * GAP) / 4)), wide: false };
  // Six columns a block, like Start's groups on a desk, so two or three blocks sit side by side.
  return { cols: 6, unit: width >= 1100 ? 84 : 76, wide: true };
}

/** The wall cut into blocks: each open group is its own; loose tiles and folded groups between them share one. */
type Block =
  | { kind: "loose"; id: string; cells: ({ kind: "tile"; tile: WallTile } | { kind: "folder"; group: WallGroup })[] }
  | { kind: "group"; id: string; group: WallGroup };

function blocksOf(wall: Wall, isOpen: (g: WallGroup) => boolean): Block[] {
  const blocks: Block[] = [];
  let run: Extract<Block, { kind: "loose" }> | null = null;
  for (const item of wall.items) {
    if (item.kind === "group" && isOpen(item)) {
      run = null;
      blocks.push({ kind: "group", id: item.id, group: item });
      continue;
    }
    if (!run) {
      run = { kind: "loose", id: `loose:${item.kind === "tile" ? item.key : item.id}`, cells: [] };
      blocks.push(run);
    }
    run.cells.push(item.kind === "tile" ? { kind: "tile", tile: item } : { kind: "folder", group: item });
  }
  return blocks;
}

// ─── the letters of All apps ─────────────────────────────────────────────────────────────────

const LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export function initialOf(name: string): string {
  const c = name.trim().charAt(0).toLocaleUpperCase();
  return /\p{L}/u.test(c) ? c : "#";
}
const byName = (a: InstalledApp, b: InstalledApp): number => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.key.localeCompare(b.key);

// ─── props ───────────────────────────────────────────────────────────────────────────────────

export interface MetroHomeProps {
  installed: InstalledApp[];
  now: number;
  isSelected: (a: InstalledApp) => boolean;
  onOpen: (a: InstalledApp) => void;
  onNewApp: (prefill?: string) => void;
  onAdd: () => void;
  onData: () => void;
  onLook: () => void;
  onYou: () => void;
  /** The tile menu (#77) for an app: its "Actions for …" button and the menu it opens. */
  menuFor: (a: InstalledApp) => ReactNode;
  inertUnless: (key: string) => Record<string, string>;
  /** Above the panes: the first-run welcome, the unfinished conversations. */
  top: ReactNode;
  /** Below All apps: the bundled examples to bring back. */
  gone: ReactNode;
  children?: ReactNode;
}

type Pane = "start" | "all";

export function MetroHome(p: MetroHomeProps) {
  const { t } = useLingui();
  const [pane, setPane] = useState<Pane>("start");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const focusSearch = useRef(false);
  const showPane = (next: Pane, opts: { search?: boolean } = {}): void => {
    if (opts.search) focusSearch.current = true;
    setPane(next);
  };
  useEffect(() => {
    if (pane === "all" && focusSearch.current) {
      focusSearch.current = false;
      searchRef.current?.focus();
    }
  }, [pane]);

  // Spotlight-style (#85): a printable key with nothing focused goes to the search field in All apps.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === " ") return;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (document.querySelector(".k-metro-wall[data-editing], [role=dialog][aria-modal=true], .k-tile-menu")) return;
      e.preventDefault();
      setQuery((q) => q + e.key);
      showPane("all", { search: true });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A horizontal swipe changes pane, like a pivot; a vertical one scrolls.
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const swipeHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch") return;
      swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const s = swipe.current;
      swipe.current = null;
      if (!s || s.id !== e.pointerId || document.querySelector(".k-metro-wall[data-editing]")) return;
      const dx = e.clientX - s.x;
      if (Math.abs(dx) > 70 && Math.abs(e.clientY - s.y) < 50) setPane(dx < 0 ? "all" : "start");
    },
    onPointerCancel: () => (swipe.current = null),
  };

  return (
    <div className="k-launcher k-launcher-home k-metro" role="dialog" aria-label={t`App launcher`} data-pane={pane}>
      <header className="k-launcher-head k-metro-head">
        <div className="k-brand k-metro-brand">
          <Wordmark />
        </div>
        <div className="k-metro-pivot" role="tablist" aria-label={t({ message: "Home screen", comment: "The launcher's two panes: the tile wall and the list of all apps" })}>
          <button type="button" role="tab" id="k-pivot-start" aria-controls="k-metro-pane" aria-selected={pane === "start"} tabIndex={pane === "start" ? 0 : -1} onClick={() => setPane("start")} onKeyDown={(e) => e.key === "ArrowRight" && (setPane("all"), document.getElementById("k-pivot-all")?.focus())}>
            {t({ message: "Start", comment: "The launcher pane with the tile wall, as on Windows Phone" })}
          </button>
          <button type="button" role="tab" id="k-pivot-all" aria-controls="k-metro-pane" aria-selected={pane === "all"} tabIndex={pane === "all" ? 0 : -1} onClick={() => setPane("all")} onKeyDown={(e) => e.key === "ArrowLeft" && (setPane("start"), document.getElementById("k-pivot-start")?.focus())}>
            {t`All apps`}
          </button>
        </div>
      </header>
      {p.top}
      <div id="k-metro-pane" className="k-metro-pane" role="tabpanel" aria-labelledby={pane === "start" ? "k-pivot-start" : "k-pivot-all"} data-pane={pane} key={pane} {...swipeHandlers}>
        {pane === "start" ? (
          <StartPane {...p} onAllApps={() => setPane("all")} />
        ) : (
          <AllApps {...p} query={query} setQuery={setQuery} searchRef={searchRef} />
        )}
      </div>
      {p.children}
      <AppBar onNewApp={() => p.onNewApp()} onAdd={p.onAdd} onGallery={openGallery} onFind={() => showPane("all", { search: true })} onData={p.onData} onLook={p.onLook} onYou={p.onYou} />
    </div>
  );
}

/** You, as your initials in your own hue once there is an identity; the same mark chat uses (#90). */
function YouMark() {
  const me = peekIdentity();
  const named = Boolean(me && me.name && me.name !== DEFAULT_NAME);
  return (
    <span className="k-launch-you k-metro-bar-icon" aria-hidden style={{ ["--k-hue" as string]: me ? personHue(me.id) : 60 }}>
      {me && named ? personInitials(me.name, me.id) : "⌾"}
    </span>
  );
}

/**
 * The app bar: Metro's slim row of round buttons, each with its word under it. At the bottom of a
 * phone, in thumb reach; on a wide screen it sits up in the header's row.
 */
function AppBar(p: { onNewApp: () => void; onAdd: () => void; onGallery: () => void; onFind: () => void; onData: () => void; onLook: () => void; onYou: () => void }) {
  const { t } = useLingui();
  const btn = (cls: string, label: string | undefined, icon: ReactNode, word: string, fn: () => void, title?: string) => (
    <button type="button" className={`k-metro-bar-btn ${cls}`} aria-label={label} title={title} onClick={fn}>
      {typeof icon === "string" ? (
        <span className="k-metro-bar-icon" aria-hidden>
          {icon}
        </span>
      ) : (
        icon
      )}
      <span className="k-metro-bar-word" aria-hidden={label ? true : undefined}>
        {word}
      </span>
    </button>
  );
  return (
    <nav className="k-metro-bar" aria-label={t({ message: "Launcher actions", comment: "The bar of buttons at the bottom of the home screen" })}>
      {btn("k-primary-action k-launch-newbtn", undefined, I.plus, t`New app`, p.onNewApp)}
      {btn("k-launch-addbtn", t`Add an app`, "⤓", t({ message: "Add", comment: "App bar: add an app someone sent you; one short word" }), p.onAdd, t`Add an app someone sent you`)}
      {btn("k-metro-gallery", t({ message: "Browse the gallery", comment: "Opens Potyro's gallery of apps to try and make your own" }), "▦", t({ message: "Gallery", comment: "App bar: Potyro's gallery of apps; one short word" }), p.onGallery)}
      {btn("k-metro-find", t`Find an app`, "⌕", t({ message: "Find", comment: "App bar: search the apps; one short word" }), p.onFind)}
      {btn(
        "k-data-btn",
        t`Your data — every app’s records`,
        <span className="k-metro-bar-icon" aria-hidden>
          <DatabaseIcon size="1.1em" />
        </span>,
        t({ message: "Data", comment: "Tile menu: this app's records, on the Data page" }),
        p.onData,
        t`Your data`,
      )}
      {btn("k-look-btn", t`Look — appearance and colour`, "◐", t({ message: "Look", comment: "The panel for light/dark appearance and accent colour" }), p.onLook)}
      {btn("k-metro-you", t`You and your devices`, <YouMark />, t({ message: "You", comment: "App bar: you and your devices; one short word" }), p.onYou)}
    </nav>
  );
}

// ─── Start: the wall ─────────────────────────────────────────────────────────────────────────

function StartPane(p: MetroHomeProps & { onAllApps: () => void }) {
  const { t } = useLingui();
  const { installed, now } = p;
  const wall = useArrangedWall(installed, now);
  const byKey = useMemo(() => new Map<string, InstalledApp>(installed.map((a) => [a.key, a])), [installed]);
  const wallRef = useRef<HTMLDivElement | null>(null);
  const { cols, unit, wide } = useMeasure(wallRef);
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [leaving, setLeaving] = useState<string | null>(null);
  const nameOf = (key: string): string => byKey.get(key)?.name ?? key;

  const save = (next: Wall, words?: string): void => {
    if (next !== getWall()) saveWall(next);
    if (words) setAnnounce(words);
  };
  const enterEdit = (key: string | null): void => {
    setEditing(true);
    setChosen(key);
    if (key) setFocusKey(key);
  };
  const done = (): void => {
    setEditing(false);
    setChosen(null);
  };

  // Live faces: after the wall has painted, run the ones that are missing or old — and again every
  // so often while the home screen stays up. Never before the first paint.
  const liveKeys = installed.filter((a) => a.live).map((a) => a.key).join(",");
  useEffect(() => {
    if (!liveKeys) return;
    const run = (): void => refreshTiles(installed);
    const first = setTimeout(run, 400);
    const every = setInterval(run, TILE_REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKeys]);

  // Live tiles turn over in turn: each tick, a third of them; never under reduced motion, never in edit mode.
  const [tick, setTick] = useState(0);
  const still = reducedMotion();
  useEffect(() => {
    if (still || editing) return;
    const id = setInterval(() => setTick((n) => n + 1), FLIP_TICK_MS);
    return () => clearInterval(id);
  }, [still, editing]);

  const isOpen = (g: WallGroup): boolean => !g.collapsed || opened.has(g.id);
  const blocks = blocksOf(wall, isOpen);

  // Every tile's place, per block — the packing (`pack`) is what the grid is drawn from, and what
  // the arrow keys move across.
  const packed = blocks.map((b) => {
    const cells: WallTile[] = b.kind === "group" ? b.group.tiles : b.cells.map((c) => (c.kind === "tile" ? c.tile : { key: `group:${c.group.id}`, size: "medium" as TileSize }));
    return { block: b, ...pack(cells, cols) };
  });
  const order = packed.flatMap((b) => b.placed.map((pl) => pl.key));
  const tabbable = focusKey && order.includes(focusKey) ? focusKey : order[0];

  const onDrop = (key: string, drop: Drop): void => {
    if (key.startsWith("group:")) {
      save(placeGroup(getWall(), key.slice(6), drop), t`Moved the group.`);
      return;
    }
    const before = groupOf(getWall(), key);
    const next = moveTile(getWall(), key, drop);
    save(next);
    const name = nameOf(key);
    const after = groupOf(next, key);
    setAnnounce(after && after.id !== before?.id ? t`${name} is in a group now.` : before && !after ? t`${name} is out of its group.` : t`Moved ${name}.`);
  };
  const { bind, carried, swallowClick } = useWallDrag({ editing, onHold: (key) => enterEdit(key), onDrop });

  // Focus follows the roving key, once it has moved.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current || !focusKey) return;
    moved.current = false;
    const el = wallRef.current?.querySelector<HTMLElement>(`[data-nav="${CSS.escape(focusKey)}"]`);
    (el?.matches("button") ? el : el?.querySelector<HTMLElement>("button"))?.focus();
  }, [focusKey, wall]);

  /** The visible tiles, as boxes in pixels, for the arrow keys — across every block. */
  const boxes = (): Placed[] =>
    Array.from(wallRef.current?.querySelectorAll<HTMLElement>("[data-nav]") ?? []).map((el) => {
      const r = el.getBoundingClientRect();
      return { key: el.dataset.nav!, col: r.left, row: r.top, w: r.width, h: r.height };
    });
  const go = (from: string, dir: "left" | "right" | "up" | "down"): void => {
    const to = neighbour(boxes(), from, dir);
    if (!to) return;
    moved.current = true;
    setFocusKey(to);
    if (editing) setChosen(to);
  };

  const open = (a: InstalledApp): void => {
    if (p.isSelected(a)) return;
    if (reducedMotion()) return void p.onOpen(a);
    setLeaving(a.key);
    setTimeout(() => p.onOpen(a), LEAVE_MS);
  };

  const onTileKey = (key: string) => (e: KeyboardEvent<HTMLElement>) => {
    const dir = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : null;
    if (dir && editing && e.altKey) {
      e.preventDefault();
      const by = dir === "left" || dir === "up" ? -1 : 1;
      if (key.startsWith("group:")) save(moveItem(getWall(), key.slice(6), by), t`Moved the group.`);
      else {
        const next = step(getWall(), key, by);
        save(next);
        // The words reorder.ts says for the same move, so a screen reader hears one thing for it.
        const what = nameOf(key);
        const at = fmt.number(wallTiles(next).findIndex((x) => x.tile.key === key) + 1);
        const count = fmt.number(wallTiles(next).length);
        setAnnounce(t`Moved ${what} to position ${at} of ${count}.`);
      }
      moved.current = true;
      setFocusKey(key);
      return;
    }
    if (dir) {
      e.preventDefault();
      go(key, dir);
      return;
    }
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      enterEdit(key);
      return;
    }
    if (editing && (e.key === "Delete" || e.key === "Backspace") && !key.startsWith("group:")) {
      e.preventDefault();
      const name = nameOf(key);
      save(unpin(getWall(), key), t`${name} is off Start. It is still in All apps.`);
      setChosen(null);
      return;
    }
    if (editing && e.key === "Escape") {
      e.preventDefault();
      done();
    }
  };

  const tileFor = (pl: Placed, n: number): ReactNode => {
    if (pl.key.startsWith("group:")) {
      const group = wall.items.find((i): i is { kind: "group" } & WallGroup => i.kind === "group" && i.id === pl.key.slice(6));
      return group ? <Folder key={pl.key} group={group} place={pl} byKey={byKey} editing={editing} chosen={chosen === pl.key} tabbable={tabbable === pl.key} onActivate={() => (editing ? setChosen(pl.key) : setOpened((s) => new Set([...s, group.id])))} onKeyDown={onTileKey(pl.key)} onFocus={() => setFocusKey(pl.key)} pointer={bind(pl.key)} /> : null;
    }
    const app = byKey.get(pl.key);
    if (!app) return null;
    const size = wallTiles(wall).find((x) => x.tile.key === pl.key)?.tile.size ?? "small";
    const drop = carried && carried.key !== pl.key && carried.drop && "target" in carried.drop && carried.drop.target === pl.key ? (carried.drop.kind === "onto" ? "onto" : carried.drop.after ? "after" : "before") : undefined;
    return (
      <MetroTile
        key={pl.key}
        app={app}
        size={size}
        place={pl}
        now={now}
        active={p.isSelected(app)}
        editing={editing}
        chosen={chosen === pl.key}
        live={(tick + n) % 3 === 0 || still}
        tabbable={tabbable === pl.key}
        drag={carried?.key === pl.key ? { dx: carried.dx, dy: carried.dy } : undefined}
        dropHint={drop}
        leaving={leaving ? Math.min(180, (pl.row * 2 + pl.col) * 16) : undefined}
        onActivate={(e) => {
          if (swallowClick()) return e.preventDefault();
          if (editing) setChosen(pl.key);
          else open(app);
        }}
        onKeyDown={onTileKey(pl.key)}
        onFocus={() => setFocusKey(pl.key)}
        pointer={bind(pl.key)}
      />
    );
  };

  const chosenApp = chosen && !chosen.startsWith("group:") ? byKey.get(chosen) : undefined;
  const chosenGroup = chosen?.startsWith("group:") ? (wall.items.find((i) => i.kind === "group" && i.id === chosen.slice(6)) as ({ kind: "group" } & WallGroup) | undefined) : chosenApp ? (groupOf(wall, chosenApp.key) ?? undefined) : undefined;

  return (
    <>
      <div
        ref={wallRef}
        className="k-metro-wall"
        data-editing={editing || undefined}
        data-wide={wide || undefined}
        data-leaving={leaving ? "true" : undefined}
        data-carrying={carried ? "true" : undefined}
        style={{ "--metro-unit": `${unit}px`, "--metro-gap": `${GAP}px`, "--metro-cols": cols } as CSSProperties}
        aria-describedby="k-metro-keys"
        onClick={(e) => {
          // A tap on the bare wall in edit mode leaves it.
          if (editing && e.target === e.currentTarget) done();
        }}
      >
        {packed.map(({ block, rows, placed }) =>
          block.kind === "group" ? (
            <GroupBlock key={block.id} group={block.group} rows={rows} editing={editing} chosen={chosen === `group:${block.group.id}`} opened={opened.has(block.group.id)} drop={carried?.drop?.kind === "into" && carried.drop.group === block.group.id} pointer={bind(`group:${block.group.id}`)} onChoose={() => setChosen(`group:${block.group.id}`)} onFold={() => setOpened((s) => new Set([...s].filter((id) => id !== block.group.id)))} onKeyDown={onTileKey(`group:${block.group.id}`)}>
              {placed.map((pl, i) => tileFor(pl, i))}
            </GroupBlock>
          ) : (
            <div key={block.id} className="k-metro-block" style={{ gridTemplateRows: `repeat(${rows}, var(--metro-unit))` }}>
              {placed.map((pl, i) => tileFor(pl, i))}
            </div>
          ),
        )}
        {!wall.items.length && installed.length ? (
          <p className="k-muted k-metro-empty">
            <Trans>Nothing on Start. Pin an app from All apps.</Trans>{" "}
            <button type="button" className="k-add" onClick={p.onAllApps}>
              {t`All apps`}
            </button>
          </p>
        ) : null}
        {!installed.length ? (
          <p className="k-muted k-launch-empty">
            <Trans>No apps yet — press New app to make one.</Trans>
          </p>
        ) : null}
      </div>
      <p id="k-metro-keys" className="k-visually-hidden">
        {editing
          ? t`Arrow keys move between tiles. Alt with an arrow moves the chosen tile. Delete takes it off Start. Escape is done.`
          : t`Arrow keys move between tiles. Enter opens. The menu key, or Shift+F10, arranges the tiles.`}
      </p>
      <p className="k-visually-hidden" aria-live="polite">
        {announce}
      </p>
      {/* Kept in place (hidden) in edit mode: taking it out moved every tile under a held finger. */}
      {wall.items.length ? (
        <p className="k-metro-hint" style={editing ? { visibility: "hidden" } : undefined} aria-hidden={editing || undefined}>
          <span>
            <Trans>Hold a tile to arrange Start.</Trans>
          </span>{" "}
          <button type="button" className="k-metro-link" onClick={() => enterEdit(tabbable ?? null)}>
            {t({ message: "Arrange", comment: "Button under the tile wall: resize, move and group the tiles" })}
          </button>
        </p>
      ) : null}
      {editing ? (
        <EditBar
          app={chosenApp}
          group={chosenGroup}
          groupChosen={Boolean(chosen?.startsWith("group:"))}
          size={chosenApp ? (wallTiles(wall).find((x) => x.tile.key === chosenApp.key)?.tile.size ?? "small") : undefined}
          menu={chosenApp ? p.menuFor(chosenApp) : null}
          onSize={(size) => chosenApp && save(setSize(getWall(), chosenApp.key, size), sizeWords(size, t))}
          onUnpin={() => {
            if (!chosenApp) return;
            const name = chosenApp.name;
            save(unpin(getWall(), chosenApp.key), t`${name} is off Start. It is still in All apps.`);
            setChosen(null);
          }}
          onGroup={() => {
            if (!chosenApp) return;
            const name = chosenApp.name;
            if (groupOf(getWall(), chosenApp.key)) save(ungroup(getWall(), chosenApp.key), t`${name} is out of its group.`);
            else {
              const next = groupWithNeighbour(getWall(), chosenApp.key, 1);
              save(next === getWall() ? groupWithNeighbour(getWall(), chosenApp.key, -1) : next, t`${name} is in a group now.`);
            }
          }}
          onRename={async () => {
            if (!chosenGroup) return;
            const name = await shellDialogs.prompt(t`Name this group`, { default: chosenGroup.name ?? categoryName(chosenGroup.category, t) });
            if (name !== null) save(updateGroup(getWall(), chosenGroup.id, { name: name.trim() }), t`Group renamed.`);
          }}
          onColour={() => {
            if (!chosenGroup) return;
            const at = chosenGroup.hue === undefined ? -1 : TILE_HUES.indexOf(chosenGroup.hue);
            const hue = at + 1 >= TILE_HUES.length ? undefined : TILE_HUES[at + 1];
            save(updateGroup(getWall(), chosenGroup.id, { hue }));
          }}
          onFold={() => chosenGroup && save(updateGroup(getWall(), chosenGroup.id, { collapsed: !chosenGroup.collapsed }), chosenGroup.collapsed ? t`Group unfolded.` : t`Group folded into one tile.`)}
          onMoveGroup={(by) => chosenGroup && save(moveItem(getWall(), chosenGroup.id, by), t`Moved the group.`)}
          onDissolve={() => {
            if (!chosenGroup) return;
            save(dissolve(getWall(), chosenGroup.id), t`The group is gone; its tiles stay on Start.`);
            setChosen(null);
          }}
          onDone={done}
        />
      ) : null}
    </>
  );
}

function sizeWords(size: TileSize, t: ReturnType<typeof useLingui>["t"]): string {
  return size === "small" ? t`Small tile.` : size === "medium" ? t`Medium tile.` : t`Wide tile.`;
}

function GroupBlock(props: {
  group: WallGroup;
  rows: number;
  editing: boolean;
  chosen: boolean;
  opened: boolean;
  drop: boolean;
  pointer: ReturnType<ReturnType<typeof useWallDrag>["bind"]>;
  onChoose: () => void;
  onFold: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const { group } = props;
  const name = group.name ?? categoryName(group.category, t);
  const id = `k-group-${group.id}`;
  return (
    <section
      className="k-metro-group"
      aria-labelledby={id}
      data-group-id={group.id}
      data-chosen={props.chosen || undefined}
      data-drop={props.drop || undefined}
      style={group.hue !== undefined ? ({ "--group-tint": hueColour(group.hue) } as CSSProperties) : undefined}
    >
      <header className="k-metro-group-head">
        {props.editing ? (
          <button type="button" id={id} className="k-metro-group-name" aria-pressed={props.chosen} data-nav={`group:${group.id}`} onClick={props.onChoose} onKeyDown={props.onKeyDown} {...props.pointer}>
            {name}
            <span className="k-metro-group-edit" aria-hidden>
              {" "}
              ✎
            </span>
          </button>
        ) : (
          <h3 id={id} className="k-metro-group-name">
            {name}
          </h3>
        )}
        {props.opened && !props.editing ? (
          <button type="button" className="k-metro-link k-metro-fold" onClick={props.onFold}>
            {t({ message: "Fold", comment: "Fold an opened tile group back into one tile" })}
          </button>
        ) : null}
      </header>
      <div className="k-metro-block" style={{ gridTemplateRows: `repeat(${props.rows}, var(--metro-unit))` }}>
        {props.children}
      </div>
    </section>
  );
}

/** A folded group: one medium tile, a mosaic of its apps, that opens in place (a Windows Phone live folder). */
function Folder(props: {
  group: WallGroup;
  place: Placed;
  byKey: Map<string, InstalledApp>;
  editing: boolean;
  chosen: boolean;
  tabbable: boolean;
  onActivate: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
  pointer: ReturnType<ReturnType<typeof useWallDrag>["bind"]>;
}) {
  const { t } = useLingui();
  const { group, place } = props;
  const name = group.name ?? categoryName(group.category, t);
  const apps = group.tiles.map((x) => props.byKey.get(x.key)).filter((a): a is InstalledApp => Boolean(a));
  const count = apps.length;
  return (
    <div
      className="k-metro-cell k-metro-folder-cell"
      data-group-id={group.id}
      data-chosen={props.chosen || undefined}
      style={{ gridColumn: `${place.col + 1} / span ${place.w}`, gridRow: `${place.row + 1} / span ${place.h}`, ...(group.hue !== undefined ? ({ "--group-tint": hueColour(group.hue) } as CSSProperties) : {}) }}
      {...props.pointer}
    >
      <button
        type="button"
        className="k-metro-tile k-metro-folder"
        data-folder={`group:${group.id}`}
        data-nav={`group:${group.id}`}
        aria-pressed={props.editing ? props.chosen : undefined}
        aria-expanded={props.editing ? undefined : false}
        tabIndex={props.tabbable ? 0 : -1}
        onClick={props.onActivate}
        onKeyDown={props.onKeyDown}
        onFocus={props.onFocus}
      >
        <span className="k-metro-mosaic" aria-hidden>
          {apps.slice(0, 4).map((a) => {
            const { background, identity } = tileColours(a);
            return (
              <span key={a.key} className="k-metro-mosaic-cell" style={{ "--tile-bg": background } as CSSProperties}>
                <TileGlyph identity={identity} size={20} />
              </span>
            );
          })}
        </span>
        <span className="k-metro-name">{name}</span>
        <span className="k-visually-hidden">, {plural(count, { one: "# app", other: "# apps" })}</span>
      </button>
    </div>
  );
}

function EditBar(props: {
  app?: InstalledApp;
  group?: WallGroup;
  groupChosen: boolean;
  size?: TileSize;
  menu: ReactNode;
  onSize: (s: TileSize) => void;
  onUnpin: () => void;
  onGroup: () => void;
  onRename: () => void;
  onColour: () => void;
  onFold: () => void;
  onMoveGroup: (by: -1 | 1) => void;
  onDissolve: () => void;
  onDone: () => void;
}) {
  const { t } = useLingui();
  const sizeName = (s: TileSize): string => (s === "small" ? t({ message: "Small", comment: "Tile size" }) : s === "medium" ? t({ message: "Medium", comment: "Tile size" }) : t({ message: "Wide", comment: "Tile size" }));
  const btn = (key: string, label: string, icon: ReactNode, fn: () => void, extra: { pressed?: boolean; disabled?: boolean } = {}) => (
    <button key={key} type="button" className="k-metro-bar-btn" data-edit={key} aria-pressed={extra.pressed} disabled={extra.disabled} onClick={fn}>
      <span className="k-metro-bar-icon" aria-hidden>
        {icon}
      </span>
      <span className="k-metro-bar-word">{label}</span>
    </button>
  );
  return (
    <nav className="k-metro-bar k-metro-editbar" aria-label={t({ message: "Arrange Start", comment: "The bar of tile commands in the launcher's edit mode" })}>
      {props.app ? (
        <>
          <div className="k-metro-sizes" role="radiogroup" aria-label={t({ message: "Tile size", comment: "Choose small, medium or wide for a launcher tile" })}>
            {TILE_SIZES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={props.size === s} className="k-metro-size" data-size={s} onClick={() => props.onSize(s)}>
                <span className="k-metro-size-shape" aria-hidden style={{ "--tile-w": SPAN[s].w, "--tile-h": SPAN[s].h } as CSSProperties} />
                <span className="k-metro-bar-word">{sizeName(s)}</span>
              </button>
            ))}
          </div>
          {btn("unpin", t`Unpin`, "⊘", props.onUnpin)}
          {btn("group", props.group ? t({ message: "Ungroup", comment: "Take this tile out of its group" }) : t({ message: "Group", comment: "Put this tile in a group with the next one" }), props.group ? I.ungroup : I.group, props.onGroup)}
          <span className="k-metro-bar-more">{props.menu}</span>
        </>
      ) : null}
      {props.group && props.groupChosen ? (
        <>
          {btn("rename", t`Rename`, "✎", props.onRename)}
          {btn("colour", t({ message: "Colour", comment: "Change the tint of a tile group" }), "◐", props.onColour)}
          {btn("fold", props.group.collapsed ? t({ message: "Unfold", comment: "Show a folded tile group as its tiles again" }) : t({ message: "Fold", comment: "Fold an opened tile group back into one tile" }), props.group.collapsed ? "▾" : "▴", props.onFold)}
          {btn("earlier", t({ message: "Earlier", comment: "Move a tile group earlier on the wall" }), "↑", () => props.onMoveGroup(-1))}
          {btn("later", t({ message: "Later", comment: "Move a tile group later on the wall" }), "↓", () => props.onMoveGroup(1))}
          {btn("dissolve", t({ message: "Ungroup all", comment: "Take every tile out of this group" }), "⇱", props.onDissolve)}
        </>
      ) : null}
      {!props.app && !props.groupChosen ? <p className="k-metro-bar-note">{t`Tap a tile to change it, or drag it.`}</p> : null}
      <button type="button" className="k-metro-bar-btn k-metro-done" onClick={props.onDone}>
        <span className="k-metro-bar-icon" aria-hidden>
          ✓
        </span>
        <span className="k-metro-bar-word">{t`Done`}</span>
      </button>
    </nav>
  );
}

// ─── All apps ────────────────────────────────────────────────────────────────────────────────

function AllApps(p: MetroHomeProps & { query: string; setQuery: (q: string) => void; searchRef: MutableRefObject<HTMLInputElement | null> }) {
  const { t } = useLingui();
  const { installed, query, setQuery } = p;
  const q = query.trim().toLowerCase();
  const typed = query.trim();
  const matches = (a: InstalledApp): boolean => !q || a.name.toLowerCase().includes(q) || a.user.name.toLowerCase().includes(q);
  const sorted = [...installed].sort(byName).filter(matches);
  const wall = useWall();
  const [jumping, setJumping] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const letters = useMemo(() => {
    const map = new Map<string, InstalledApp[]>();
    for (const a of sorted) map.set(initialOf(a.name), [...(map.get(initialOf(a.name)) ?? []), a]);
    return map;
  }, [sorted]);
  const all = useMemo(() => {
    const present = [...letters.keys()];
    return [...new Set([...(present.includes("#") ? ["#"] : []), ...LATIN, ...present.filter((l) => l !== "#")])].sort((a, b) => (a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b)));
  }, [letters]);

  const jumpTo = (letter: string): void => {
    setJumping(false);
    requestAnimationFrame(() => {
      const head = listRef.current?.querySelector<HTMLElement>(`[data-letter="${CSS.escape(letter)}"]`);
      head?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
      head?.focus({ preventScroll: true });
    });
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && sorted[0] && !p.isSelected(sorted[0])) p.onOpen(sorted[0]);
    if (e.key === "Escape") {
      if (query) e.stopPropagation();
      setQuery("");
    }
  };

  const row = (a: InstalledApp) => {
    const { background, accent, identity } = tileColours(a);
    const on = wallTiles(wall).some((x) => x.tile.key === a.key);
    const appName = a.name;
    const attention = attentionOf(a.entry, p.now);
    return (
      <div key={a.key} className="k-launch-item k-metro-row" data-key={a.key} {...p.inertUnless(a.key)}>
        <button type="button" className="k-launch-tile k-metro-row-open" data-active={p.isSelected(a) || undefined} style={{ "--tile-accent": accent, "--tile-bg": background } as CSSProperties} onClick={() => p.onOpen(a)}>
          <span className="k-launch-avatar k-metro-mini" data-kind={identity.kind} aria-hidden>
            <TileGlyph identity={identity} size={24} />
            {attention.total ? <span className="k-launch-badge">{attention.total > 99 ? "99+" : attention.total}</span> : null}
          </span>
          <span className="k-launch-name">{a.name}</span>
          {attention.total ? <span className="k-visually-hidden">, {describeAttention(attention)}</span> : null}
          {!a.trusted ? (
            <span className="k-launch-shield k-metro-row-mark" role="img" aria-label={t`Runs sealed`} title={t`Runs sealed`}>
              🛡
            </span>
          ) : null}
          {a.sync ? (
            <span className="k-launch-mark k-metro-row-mark" role="img" aria-label={t`Synced to your other devices`} title={t`Synced to your other devices`}>
              ⟳
            </span>
          ) : null}
        </button>
        {on ? null : (
          <button type="button" className="k-metro-pin" aria-label={t`Pin ${appName} to Start`} title={t`Pin to Start`} onClick={() => saveWall(pin(getWall(), a.key))}>
            <span aria-hidden>⊕</span>
          </button>
        )}
        {p.menuFor(a)}
      </div>
    );
  };

  return (
    <div className="k-metro-all" ref={listRef}>
      <div className="k-launch-search k-metro-search">
        <input
          ref={p.searchRef}
          className="k-input"
          type="search"
          placeholder={t`Find an app`}
          aria-label={t`Find an app`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
      </div>
      {q && !sorted.length ? (
        <p className="k-muted k-launch-empty k-launch-nomatch">
          <Trans>No app called “{typed}”.</Trans>{" "}
          <button type="button" className="k-add" onClick={() => p.onNewApp(typed)}>
            <Trans>Create “{typed}”</Trans>
          </button>
        </p>
      ) : null}
      {q
        ? sorted.map(row)
        : [...letters.entries()].map(([letter, apps]) => (
            <section key={letter} className="k-metro-letter-group" aria-label={letter}>
              <button type="button" className="k-metro-letter" data-letter={letter} aria-label={t`${letter} — jump to another letter`} onClick={() => setJumping(true)} style={{ "--tile-bg": tileColours(apps[0]!).background } as CSSProperties}>
                {letter === "#" ? "#" : letter.toLocaleLowerCase()}
              </button>
              {apps.map(row)}
            </section>
          ))}
      {p.gone}
      {jumping ? (
        <div className="k-metro-jump-scrim" onClick={() => setJumping(false)}>
          <div className="k-metro-jump" role="dialog" aria-modal="true" aria-label={t`Jump to a letter`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && setJumping(false)}>
            {all.map((l, i) => (
              <button key={l} type="button" className="k-metro-jump-letter" disabled={!letters.has(l)} autoFocus={i === all.findIndex((x) => letters.has(x))} onClick={() => jumpTo(l)}>
                {l === "#" ? "#" : l.toLocaleLowerCase()}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const __test = { blocksOf, wallApps };
export type { WallItem };
