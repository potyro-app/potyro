// Launcher — the app switcher. Two variants share one presentation:
//   • "home"    — the full-screen first surface when no app is selected.
//   • "overlay" — a slide-in panel opened from inside a running app, to switch quickly.
// Each tile shows the provenance the app ACTUALLY runs under, from its own `trusted` flag: an app
// authored here (the seeded examples included, #152) runs directly; something imported from
// elsewhere runs in the QuickJS isolate until promoted. Selecting a tile navigates via a reload
// (?user=<id>) — boot() routes on that.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@potyro/i18n";
import { shellDialogs } from "./dialog.js";
import { renameUserApp, type UserApp } from "./user-apps.js";
import { duplicateApp } from "./app-modules.js";
import { confirmAndRemoveApp } from "./remove-app.js";
import { attentionOf, describeAttention, setOrder, setPinned, setSortMode, useInstalledApps, useSortMode, type AppKey, type InstalledApp } from "./launcher-store.js";
import { SORT_MODES, orderApps } from "./launcher-order.js";
import { useReorder } from "@potyro/views";
import { MetroHome } from "./launcher-metro.js";
import { onWall, pin, unpin } from "./launcher-wall.js";
import { getWall, saveWall, useWall } from "./wall-store.js";
import { useLook } from "./look.js";
import { hueColour, tileIdentity } from "./tile-identity.js";
import { personHue, personInitials } from "@potyro/runtime";
import { TileEditor } from "./tile-editor.js";
import { toggleAppSync } from "./toggle-sync.js";
import { createShareLink } from "./share-sync.js";
import { ShareSheet } from "./share-sheet.js";
import { IdentityPanel, askNameIfUnnamed, offerBackupOnFirstSync } from "./identity-panel.js";
import { MoveBanner } from "./move-banner.js";
import { LookPanel } from "./look-panel.js";
import { DatabaseIcon } from "./data-icon.js";
import { DEFAULT_NAME, peekIdentity } from "@potyro/identity";
import { canSync, cannotSyncMessage } from "./open-store.js";
import { askToSync } from "./sync-consent.js";
import { checkConcurrency, describeHazards } from "./check-concurrency.js";
import { History } from "./history.js";
import { navigateTo } from "./router.js";
import { AddAppDialog } from "./add-app-dialog.js";
import { canRemix, RemixDialog } from "./remix.js";
import { tileCredit } from "./credit-words.js";
import { openGallery } from "./gallery-link.js";
import { ActionMenu } from "@potyro/views";
import { liveCandidates, watchLiveSignals } from "./launcher-live.js";
import { addExample, exampleNames, missingExamples } from "./examples.js";
import { DraftStrip } from "./draft-strip.js";
import { PromoteDialog } from "./trust-dialog.js";

export function openUserApp(id: string): void {
  navigateTo({ kind: "user", id });
}
export function goHome(): void {
  navigateTo({ kind: "home" });
}
/** Open an installed app: in place when the shell can (#89), else a navigation into its route. The
 *  shell counts the open where every route passes (#81). */
export function openInstalledApp(app: InstalledApp): void {
  openUserApp(app.id);
}

export interface Selected {
  kind: "user";
  id: string;
}

interface LauncherProps {
  variant: "home" | "overlay";
  selected?: Selected;
  onOpen: (app: InstalledApp) => void;
  /** Open the Studio; a search that found nothing passes what was typed as the prompt to start from. */
  onNewApp: (prefill?: string) => void;
  /** Pick up a conversation in the Studio that has not made an app yet (#261). */
  onResumeDraft?: (draftId: string) => void;
  onClose?: () => void;
}

// A tile is the app's identity (#82): its declared icon and accent, or a monogram in a colour derived
// from the app so that four apps starting with P are four different tiles. The name is the app's
// declared one ("PPL Log", not "workout") unless the user renamed it here.
/**
 * The marks a tile carries (#87), and only when they say something: a sandboxed app gets a
 * shield on its icon's corner — never red, that is the safe state; a synced app says "synced", or
 * "shared" with the initials of the people last seen there. A trusted, local-only app says nothing
 * at all: when every tile said TRUSTED the word carried no information.
 */
function Avatar({ app, identity, attention = 0 }: { app: InstalledApp; identity: ReturnType<typeof tileIdentity>; attention?: number }) {
  const { t } = useLingui();
  return (
    <span className="k-launch-avatar" data-kind={identity.kind} aria-hidden={app.trusted || undefined}>
      {identity.glyph}
      {/* One number on the icon's corner (#86): unread chat, unseen changes and due reminders summed.
          Zero renders nothing at all. The words are read out beside the name. */}
      {attention > 0 ? (
        <span className="k-launch-badge" aria-hidden>
          {attention > 99 ? "99+" : attention}
        </span>
      ) : null}
      {!app.trusted ? (
        <span className="k-launch-shield" role="img" aria-label={t`Runs sealed`} title={t`Runs sealed`}>
          🛡
        </span>
      ) : null}
    </span>
  );
}

function SyncMark({ app, compact }: { app: InstalledApp; compact?: boolean }) {
  const { t } = useLingui();
  if (!app.sync) return null;
  const others = app.people.length > 1 ? app.people : [];
  const count = others.length;
  const label = count ? plural(count, { one: "Shared with # person", other: "Shared with # people" }) : t`Synced to your other devices`;
  return (
    <span className="k-launch-mark" data-shared={others.length ? "true" : undefined} title={label} aria-label={label}>
      <span aria-hidden>⟳</span>
      {compact ? null : <span aria-hidden>{others.length ? t({ message: "shared", comment: "Mark on a launcher tile: the app's data is shared with other people" }) : t({ message: "synced", comment: "Mark on a launcher tile: the app syncs to your other devices" })}</span>}
      {others.length ? (
        <span className="k-launch-faces" aria-hidden>
          {others.slice(0, 3).map((p) => (
            <span key={p.id} className="k-launch-face" style={{ "--swatch": hueColour(personHue(p.id)) } as CSSProperties}>
              {/* One letter: two do not fit a face this small, and three faces overlap. */}
              {personInitials(p.name, p.id).slice(0, 1)}
            </span>
          ))}
          {others.length > 3 ? <span className="k-launch-face">+{others.length - 3}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

function Tile({ app, active, onOpen, now }: { app: InstalledApp; active: boolean; onOpen: () => void; now: number }) {
  useLocale(); // the attention words below are read in the active language
  const identity = tileIdentity(app);
  const attention = attentionOf(app.entry, now);
  return (
    <button
      type="button"
      className="k-launch-tile"
      data-active={active}
      data-attention={attention.total || undefined}
      style={{ "--tile-accent": identity.accent } as CSSProperties}
      onClick={onOpen}
    >
      <Avatar app={app} identity={identity} attention={attention.total} />
      <span className="k-launch-name">{app.name}</span>
      {attention.total ? <span className="k-visually-hidden">, {describeAttention(attention)}</span> : null}
      <SyncMark app={app} />
    </button>
  );
}

/**
 * A tile's actions behind one always-visible button (#77). The row they replaced was `opacity: 0`
 * until `:hover`, so on a phone — no hover — History, Sync, Share, Rename and Delete did not exist,
 * and when they did appear they were 25px squares. This is one 44px control that opens a menu: a
 * popover beside the tile on a wide screen, a sheet from the bottom on a phone (CSS decides).
 * Delete is last and set apart, so it is not a thumb's width from Rename.
 */
interface UserActions {
  onEditTile: () => void;
  onHistory: () => void;
  onSync: () => void;
  onShare: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Its records, on the Data page. */
  onData: () => void;
  /** Its files, on the Data page's Files tab (#254). */
  onFiles: () => void;
  /** Sealed apps only: let it run as yours (owner, 2026-10-13) — reachable even when the app cannot
   *  open sealed at all, which is when the app's own badge never appears. */
  onPromote: () => void;
  /** Sealed apps only: Make it mine — your own copy to change, opened in the Studio (docs/24 §6). */
  onRemix: () => void;
}

function TileMenu({
  app,
  busy,
  onOpen,
  onPin,
  pinned,
  user,
  open,
  onOpenChange,
}: {
  app: InstalledApp;
  busy: boolean;
  onOpen: () => void;
  /** Pinned in the style on screen: Classic's Pinned row, or Start's wall (#96). */
  pinned: boolean;
  onPin: () => void;
  /** History, sync, share, rename, delete: every app has them (#152). */
  user: UserActions;
  /** Whether this menu is the open one. The launcher owns it — one menu at a time, and while one
   *  is open every other tile is inert — so there is one source of truth, not two to drift. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const setOpen = (next: boolean | ((v: boolean) => boolean)): void => onOpenChange(typeof next === "function" ? next(open) : next);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // A menu is a keyboard thing too (#94): focus moves into it when it opens, arrows walk it, and
  // Escape hands focus back to the button that opened it. Without the first of these, Escape on the
  // menu did nothing — focus was still on the button, outside the element listening for it.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
  }, [open]);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const items: HTMLButtonElement[] = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number): void => items[(i + items.length) % items.length]?.focus();
    if (e.key === "Escape") close(true);
    else if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") close(false);
    else return;
    e.preventDefault();
  };
  const credit = tileCredit(app.user);
  const item = (action: string, label: string, fn: () => void, extra: { className?: string; disabled?: boolean } = {}) => (
    <button type="button" role="menuitem" data-action={action} className={`k-tile-menu-item${extra.className ? ` ${extra.className}` : ""}`} disabled={extra.disabled} onClick={run(fn)}>
      {label}
    </button>
  );
  return (
    <div className="k-tile-menu-host">
      <button
        ref={buttonRef}
        type="button"
        className="k-tile-menu-btn"
        aria-label={t`Actions for ${app.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? "…" : "⋯"}
      </button>
      {open ? (
        <>
          <div className="k-tile-menu-scrim" onClick={() => close(false)} />
          <div ref={menuRef} className="k-tile-menu" role="menu" aria-label={t`Actions for ${app.name}`} onKeyDown={onMenuKey}>
            {/* The menu already says whose it is (aria-label); the title is for the eye. */}
            <div className="k-tile-menu-title" aria-hidden>{app.name}</div>
            {/* Who made it, and what it is a remix of (docs/24 §6): the tile's own details. */}
            {credit ? <div className="k-tile-menu-note k-tile-menu-credit">{credit}</div> : null}
            {attentionOf(app.entry, Date.now()).total ? (
              <div className="k-tile-menu-note">{describeAttention(attentionOf(app.entry, Date.now()))}</div>
            ) : null}
            {item("open", t({ message: "Open", comment: "Tile menu: open this app" }), onOpen)}
            {item("pin", pinned ? t`Unpin` : t`Pin`, onPin)}
            {item("edit-tile", t`Edit tile`, user.onEditTile)}
            {item("history", t`History`, user.onHistory)}
            {item("data", t({ message: "Data", comment: "Tile menu: this app's records, on the Data page" }), user.onData)}
            {item("files", t({ message: "Files", comment: "Tile menu: this app's files, on the Data page" }), user.onFiles)}
            {item("sync", app.sync ? t`Turn sync off` : t`Turn sync on`, user.onSync, { disabled: busy })}
            {item("share", t`Share`, user.onShare)}
            {item("rename", t`Rename`, user.onRename)}
            {item("duplicate", t`Duplicate`, user.onDuplicate)}
            {canRemix(app.user) ? item("remix", t({ message: "Make it mine", comment: "Tile menu: your own copy of this app, to change in the Studio" }), user.onRemix) : null}
            {!app.trusted ? item("promote", t`Let it run as yours`, user.onPromote) : null}
            <div className="k-tile-menu-sep" role="separator" />
            {item("delete", t`Delete`, user.onDelete, { className: "k-danger" })}
          </div>
        </>
      ) : null}
    </div>
  );
}

const WELCOME_KEY = "potyro:welcome:dismissed";

/** You, as your initials in your own hue once there is an identity; the same mark chat uses (#90). */
/** Light or dark, and the colour the shell wears. A device thing, so it lives with the device. */
function DataButton({ onClick }: { onClick: () => void }) {
  const { t } = useLingui();
  return (
    <button type="button" className="k-add k-data-btn" aria-label={t`Your data — every app’s records`} title={t`Your data`} onClick={onClick}>
      <DatabaseIcon size="1.15em" />
    </button>
  );
}

function LookButton({ onClick }: { onClick: () => void }) {
  const { t } = useLingui();
  return (
    <button type="button" className="k-add k-look-btn" aria-label={t`Look — appearance and colour`} title={t({ message: "Look", comment: "The panel for light/dark appearance and accent colour" })} onClick={onClick}>
      <span aria-hidden>◐</span>
    </button>
  );
}

function YouButton({ onClick }: { onClick: () => void }) {
  const { t } = useLingui();
  const me = peekIdentity();
  const named = Boolean(me && me.name && me.name !== DEFAULT_NAME);
  return (
    <button type="button" className="k-launch-you" aria-label={t`You and your devices`} onClick={onClick} style={{ ["--k-hue" as string]: me ? personHue(me.id) : 60 }}>
      {me && named ? personInitials(me.name, me.id) : <span aria-hidden>⌾</span>}
    </button>
  );
}

/**
 * The link in an install address (`#add=<link>`, #253), taken once and cleared from the address bar.
 *
 * Taken outside React and remembered: a state initializer runs twice in strict mode, and the first
 * run clearing the hash left the second with nothing — the dialog never opened.
 */
let addLink: string | null | undefined;
function takeAddLink(): string | null {
  if (addLink === undefined) {
    const m = /^#add=(.+)$/.exec(globalThis.location?.hash ?? "");
    addLink = null;
    if (m) {
      globalThis.history.replaceState(null, "", `${location.pathname}${location.search}`);
      try {
        addLink = decodeURIComponent(m[1]!);
      } catch {
        addLink = m[1]!;
      }
    }
  }
  const link = addLink;
  // Handed to one launcher, the first that asks; strict mode's second render asks again and must
  // get the same answer, so it is cleared on the next tick rather than now.
  if (link) setTimeout(() => (addLink = null), 0);
  return link;
}

export function Launcher({ variant, selected, onOpen, onNewApp, onResumeDraft, onClose }: LauncherProps) {
  const { t } = useLingui();
  // One live list from the launcher store (#81). A delete, rename or sync flip here, a save in the
  // Studio, an edit in another tab — every one of them writes a registry, and every write reaches
  // this render. Nothing is read once and kept (#78).
  const installed = useInstalledApps();
  // One list, ordered (#84): pinned apps first in the order you gave them, then the rest by
  // frecency, name, or your own hand. Built-ins and your apps are one list to you; provenance is
  // the badge on the tile. The clock is read once, at mount: an order that re-sorts itself while
  // you are looking at it is worse than a slightly stale one, and opens happen through a reload.
  const sortMode = useSortMode();
  const [mountedAt] = useState(() => Date.now());
  const ordered = orderApps(installed, sortMode, mountedAt);
  // Live counts for the synced apps, while this is the home screen (#86, phase 2). Keyed on WHICH
  // apps, not on the list: every count written re-renders the list, and restarting the watch on each
  // of those would reopen every store in a loop.
  const liveIds = variant === "home" ? liveCandidates(installed).map((a) => a.id).join(",") : "";
  useEffect(() => {
    if (!liveIds) return;
    const ids = new Set(liveIds.split(","));
    return watchLiveSignals(installed.filter((a) => ids.has(a.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveIds]);

  // First run (#90): nothing has ever been opened on this device and the welcome was not dismissed.
  // Then the home screen says what Potyro is and offers one thing to do, and the apps below are
  // examples to try — not a grid with the create action as one more tile.
  const [welcomeDismissed, setWelcomeDismissed] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(WELCOME_KEY) === "1";
    } catch {
      return true;
    }
  });
  const neverOpened = installed.every((a) => !a.entry.openCount);
  const dismissWelcome = (): void => {
    try {
      globalThis.localStorage?.setItem(WELCOME_KEY, "1");
    } catch {
      // private mode: it simply shows again next time
    }
    setWelcomeDismissed(true);
  };
  const nameOf = (key: string): string => installed.find((a) => a.key === key)?.name ?? key;

  // Search (#85): past a handful of apps a grid is scanned, not read. The field filters by the
  // name on the tile and the app's own name; on a desktop, typing with nothing focused starts it,
  // Enter opens the first match, Escape clears. Nothing found offers to create what was typed.
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const q = typed.toLowerCase();
  const matches = (a: InstalledApp): boolean => !q || a.name.toLowerCase().includes(q) || a.user.name.toLowerCase().includes(q);
  const pinned = ordered.pinned.filter(matches);
  const rest = ordered.rest.filter(matches);
  const firstMatch = pinned[0] ?? rest[0];
  const searchRef = useRef<HTMLInputElement | null>(null);
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && firstMatch && !isSelected(firstMatch)) onOpen(firstMatch);
    if (e.key === "Escape") {
      if (query) e.stopPropagation(); // a first Escape clears; a second may close the switcher
      setQuery("");
    }
  };
  // Reordering by hand is for the whole list, not a filtered view of it.
  // A tile is dragged from anywhere on itself, except its menu button (#84).
  const TILE = { names: nameOf, onReorder: (keys: string[]) => setOrder(keys as AppKey[]), ignore: ".k-tile-menu-host" };
  const pinnedReorder = useReorder({ ...TILE, keys: pinned.map((a) => a.key), enabled: !q });
  const restReorder = useReorder({ ...TILE, keys: rest.map((a) => a.key), enabled: sortMode === "manual" && !q });
  // Which home this person chose in Look (#96): Classic, the default, or Start. The switcher is one.
  const look = useLook();
  const start = variant === "home" && look.launcher === "start";
  const wall = useWall();
  useEffect(() => {
    if (variant !== "home" || start) return;
    // Spotlight-style: a printable key with nothing focused goes to the field and starts the filter.
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant, start]);
  // Reviewing/rolling back an app's history without opening it — the way back when an edit broke the
  // app badly enough that its own header is no longer reachable.
  const [history, setHistory] = useState<UserApp | null>(null);
  const [promoting, setPromoting] = useState<UserApp | null>(null);
  // Make it mine (docs/24 §6): a copy of a sealed app to change, through the Add-an-app card.
  const [remixing, setRemixing] = useState<UserApp | null>(null);
  // Share (docs/24): a link anyone can try, or an invite to use it together.
  const [sharing, setSharing] = useState<UserApp | null>(null);
  // The tile editor (#83): this device's name, icon and colour for an app.
  const [editing, setEditing] = useState<InstalledApp | null>(null);
  // You and your other devices — reachable from every launcher, nagged from none.
  const [identity, setIdentity] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  // Add an app (#253). `#add=<link>` opens it with the link filled in: an install link anyone can send.
  const [adding, setAdding] = useState<{ link?: string } | null>(() => {
    const link = takeAddLink();
    return link ? { link } : null;
  });

  // The switcher (#88): on a phone a bottom sheet you can swipe away, with a search field at the
  // bottom edge, inside the thumb's reach; on a desktop a drawer. Both are a compact list, not the
  // home grid squeezed into a panel — "switch to X" is a name in your head, not a place on a grid.
  const [dragY, setDragY] = useState(0);
  const swipe = useRef<{ id: number; y: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  useEffect(() => {
    // Escape must work from the start; a finger gets no keyboard popping up over the list.
    if (variant === "overlay" && coarse) sheetRef.current?.focus();
  }, [variant, coarse]);
  const swipeHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      // A pointer that starts on the close button is a click, not a swipe: capturing it would retarget
      // the pointerup to the grip and the click would never reach the button.
      if ((e.target as HTMLElement).closest("button, a, input")) return;
      swipe.current = { id: e.pointerId, y: e.clientY };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (swipe.current?.id !== e.pointerId) return;
      setDragY(Math.max(0, e.clientY - swipe.current.y));
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      if (swipe.current?.id !== e.pointerId) return;
      const dy = e.clientY - swipe.current.y;
      swipe.current = null;
      setDragY(0);
      if (dy > 80) onClose?.();
    },
    onPointerCancel: () => {
      swipe.current = null;
      setDragY(0);
    },
  };
  // Deleting an app takes its records, its version history and its diagnoses with it, and there is no
  // undo. It asked for nothing at all before.
  // The question itself lives in `remove-app.ts`: the Studio can delete an app too, and the two
  // asked very differently — one carefully, one not at all.
  const del = async (a: UserApp): Promise<void> => void (await confirmAndRemoveApp(a));
  // Sync moves the app's data between two stores that keep it in DIFFERENT files, so this is a
  // migration, not a checkbox. It says what it will do, reports anything it could not move, and
  // never deletes the old copy — flipping back is the way out if it was a mistake.
  const [busy, setBusy] = useState<string | null>(null);

  // Which bundled examples this device does not have. Read after every change to the app list, so
  // deleting one puts it here and restoring it takes it away again.
  const [gone, setGone] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    const missing = new Set(missingExamples());
    if (missing.size === 0) {
      setGone([]);
      return;
    }
    void exampleNames().then((all) => {
      if (alive) setGone(all.filter((e) => missing.has(e.id)));
    });
    return () => {
      alive = false;
    };
  }, [installed]);

  const restore = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      await addExample(id, { trusted: true, now: new Date().toISOString() });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await shellDialogs.confirm(t`Could not add it back: ${reason}`);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Re-open the app whose store has just changed underneath it.
   *
   * Turning sync on MOVES an app into a different store, but the copy on screen was built on the old
   * one: its runtime, its space and its version gate were all made when it opened. Until it is
   * rebuilt, that copy goes on reading — and writing — the store nobody is syncing. So a peer's
   * changes never arrive, and yours never leave: it reads as "sync is broken", and switching to
   * another app and back appears to fix it, because that is what rebuilds everything.
   *
   * A page load, because that is how a synced app is built: the space is module state set up once
   * per page, the same reason `canSwitchInPlace` refuses to swap a synced app in place.
   */
  const reopenIfOpen = (a: UserApp): void => {
    if (selected?.kind !== "user" || selected.id !== a.id) return;
    location.reload();
  };

  const toggleSync = async (a: UserApp): Promise<void> => {
    const on = !a.sync;
    if (on && !canSync()) {
      await shellDialogs.confirm(cannotSyncMessage());
      return;
    }
    // An app someone else wrote is asked about first (KA-23): sync is what lets its code write into
    // data that leaves this device.
    if (on && !(await askToSync(a))) return;
    const name = a.name;
    const ok = await shellDialogs.confirm(
      on
        ? t`Turn on sync for “${name}”? Its data will be copied into the synced store. The old copy is kept, so you can turn this back off.`
        : t`Turn off sync for “${name}”? Its data will be copied back to local-only storage.`,
    );
    if (!ok) return;
    setBusy(a.id);
    try {
      const { inspect } = await import("./app-source.js");
      const shape = await inspect(a.source);
      const entities = shape.entities.map((e) => e.key);
      const { copied, warnings } = await toggleAppSync(a.id, entities, on, new Date().toISOString());
      const records = copied.records;
      const moved = plural(records, { one: "Moved # record.", other: "Moved # records." });
      // A partial migration must be surfaced. Silently losing photos is the failure this whole
      // path exists to avoid. (The warnings come translated from `toggleAppSync`.)
      await shellDialogs.confirm(warnings.length ? `${moved} ${warnings.join(" ")}` : `${moved} ${on ? t`Sync is on.` : t`Sync is off.`}`);
      // Only after the outcome is reported. The first time anything syncs is the first time the
      // recovery words are TRUE — before that they restore nothing, because the data has never left
      // this device — but stacking the question on top of the result reads as one confusing dialog.
      if (on) await offerBackupOnFirstSync(() => setIdentity(true));
      reopenIfOpen(a);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await shellDialogs.confirm(t`Could not change sync: ${reason}`);
    } finally {
      setBusy(null);
    }
  };

  // Sharing hands over a link whose fragment carries the app source AND the invite secret. The
  // fragment never reaches a server, which is what keeps the key off the relay.
  const share = async (a: UserApp): Promise<void> => {
    if (!canSync()) {
      await shellDialogs.confirm(cannotSyncMessage());
      return;
    }
    try {
      // Sharing implies sync. Making the user find the sync toggle first was a step that taught
      // them nothing — the reason to turn sync on IS to share.
      const turnedOn = !a.sync;
      if (!a.sync) {
        if (!(await askToSync(a))) return;
        const name = a.name;
        const ok = await shellDialogs.confirm(
          t`Share “${name}”? This turns on sync and copies its data into the synced store. You can turn it off again later.`,
        );
        if (!ok) return;
        setBusy(a.id);
        const { inspect } = await import("./app-source.js");
        const shape = await inspect(a.source);
        await toggleAppSync(a.id, shape.entities.map((e) => e.key), true, new Date().toISOString());
        setBusy(null);
      }
      // The moment concurrency stops being hypothetical. Everything up to here, the app has had one
      // user; from here it has two, and the failures are silent (KA-38). Checked HERE rather than on
      // every save because this is the only point where the answer changes what a person should do.
      setBusy(a.id);
      const risk = await checkConcurrency(a.source, a.id);
      setBusy(null);
      const hazards = describeHazards(risk);
      if (hazards.length) {
        const name = a.name;
        const list = `• ${hazards.join("\n• ")}`;
        const go = await shellDialogs.confirm(
          t`Before you share “${name}” — two people using it at once can lose each other's work:\n\n${list}\n\nNothing is wrong with it on your own. Share anyway?`,
        );
        if (!go) return;
      }

      // Before the link, not after: `createShareLink` opens the space and publishes your profile, so
      // asking afterwards would put you in front of the other person as "Me" until something else
      // republished it.
      await askNameIfUnnamed();
      const link = await createShareLink(a.id);
      await shellDialogs.share(t`Send this link. Whoever opens it joins your app and its data.`, link);
      // After the link, not before it: the user came here to share, and interrupting that with a
      // question about recovery words buries the thing they actually asked for.
      await offerBackupOnFirstSync(() => setIdentity(true));
      // Sharing turned sync on for this app, so the open copy is on the wrong store as well. Last,
      // not at the toggle: the person came here for the link, and a reload before they have it
      // takes the link away with it.
      if (turnedOn) reopenIfOpen(a);
    } catch (e) {
      setBusy(null);
      await shellDialogs.confirm(e instanceof Error ? e.message : String(e));
    }
  };

  const rename = async (a: UserApp): Promise<void> => {
    const name = await shellDialogs.prompt(t`Rename app`, { default: a.name });
    if (name && name.trim()) {
      renameUserApp(a.id, name, new Date().toISOString());
    }
  };

  /**
   * A second copy of an app, empty, under its own name.
   *
   * The way to take an app someone shared with you and make it yours — before this the only route
   * was opening the Studio, copying the source out and pasting it back as a new app, which is what
   * the owner's friend had to do. The copy carries no records and no space: it is a new app here.
   */
  const duplicate = async (a: UserApp): Promise<void> => {
    const copy = await duplicateApp(a.id, new Date().toISOString());
    // Said out loud, with the name: the copy lands wherever this launcher's sort puts it, which on
    // a long list is not necessarily anywhere you are looking.
    const copyName = copy?.name;
    if (copy) await shellDialogs.confirm(t`Copied to “${copyName}”. It starts empty — the app, not the data.`);
  };

  const isSelected = (a: InstalledApp): boolean => selected?.kind === a.kind && selected.id === a.id;
  // While one tile's menu is open the other tiles are inert: a popover that sits over the tile
  // below it must not leave that tile's button half-reachable, by pointer or by Tab.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // A menu whose tile is gone (deleted, filtered out) must not leave the rest inert.
  const openMenuLive = openMenu && installed.some((a) => a.key === openMenu) ? openMenu : null;
  const inertUnless = (key: string): Record<string, string> | Record<string, never> => (openMenuLive && openMenuLive !== key ? { inert: "" } : {});
  const menuFor = (a: InstalledApp) => (
    <TileMenu
      app={a}
      busy={busy === a.id}
      onOpen={() => onOpen(a)}
      pinned={start ? onWall(wall, a.key) : Boolean(a.entry.pinned)}
      onPin={() => (start ? saveWall(onWall(getWall(), a.key) ? unpin(getWall(), a.key) : pin(getWall(), a.key)) : setPinned(a.key, !a.entry.pinned))}
      open={openMenuLive === a.key}
      onOpenChange={(open) => setOpenMenu((cur) => (open ? a.key : cur === a.key ? null : cur))}
      user={{
        onEditTile: () => setEditing(a),
        onHistory: () => setHistory(a.user),
        onSync: () => void toggleSync(a.user),
        onShare: () => setSharing(a.user),
        onRename: () => void rename(a.user),
        onDuplicate: () => void duplicate(a.user),
        onDelete: () => void del(a.user),
        onData: () => navigateTo({ kind: "data", id: a.id }),
        onFiles: () => navigateTo({ kind: "data", id: a.id, files: true }),
        onPromote: () => setPromoting(a.user),
        onRemix: () => setRemixing(a.user),
      }}
    />
  );

  // The Start style (#96, owner 2026-10-15): the tile wall and All apps, in launcher-metro.tsx —
  // chosen in Look; Classic, below, is the default. Every tile action stays here, shared by both.
  const welcome =
    neverOpened && !welcomeDismissed ? (
      <section className="k-welcome" aria-labelledby="k-welcome-h">
        <h2 id="k-welcome-h">
          <Trans>Make the app you need</Trans>
        </h2>
        <p>
          <Trans>
            Describe what you want to keep track of — a shared shopping list, your plants, a trip — and Potyro builds it. Or open
            one of the examples below and change it.
          </Trans>
        </p>
        <div className="k-welcome-actions">
          <button type="button" className="k-add k-primary-action" onClick={() => onNewApp()}>
            <Trans>Describe an app</Trans>
          </button>
          <button type="button" className="k-welcome-later" onClick={dismissWelcome}>
            <Trans>Not now</Trans>
          </button>
        </div>
      </section>
    ) : null;
  // A bundled example you deleted is gone for good, which is right — until you want it back.
  // Nothing brings one back on its own; this is how you ask.
  const goneSection = gone.length ? (
    <section className="k-launch-section k-metro-gone" aria-labelledby="k-launch-gone">
      <div className="k-launch-section-head">
        <h3 className="k-launch-title" id="k-launch-gone">
          <Trans>Bundled examples</Trans>
        </h3>
      </div>
      <div className="k-launch-gone">
        {gone.map((e) => (
          <button key={e.id} type="button" className="k-add k-launch-restore" disabled={busy === e.id} onClick={() => void restore(e.id)}>
            <span aria-hidden>＋</span> {e.name}
          </button>
        ))}
      </div>
    </section>
  ) : null;

  const metroBody = (
    <MetroHome
      installed={installed}
      now={mountedAt}
      isSelected={isSelected}
      onOpen={onOpen}
      onNewApp={onNewApp}
      onAdd={() => setAdding({})}
      menuFor={menuFor}
      inertUnless={inertUnless}
      top={
        <>
          {/* An old Potyro site shows its people the way to the new one (move-banner.tsx). */}
          {variant === "home" ? <MoveBanner /> : null}
          {welcome}
          {/* Conversations that have not made an app yet (#261), before the apps: they are what you were last doing. */}
          {onResumeDraft ? <DraftStrip onResume={onResumeDraft} /> : null}
        </>
      }
      gone={goneSection}
      onData={() => navigateTo({ kind: "data" })}
      onLook={() => setLookOpen(true)}
      onYou={() => setIdentity(true)}
    >
      {identity ? <IdentityPanel onClose={() => setIdentity(false)} /> : null}
      {lookOpen ? <LookPanel onClose={() => setLookOpen(false)} /> : null}
      {adding ? <AddAppDialog initialLink={adding.link} onClose={() => setAdding(null)} /> : null}
      {remixing ? <RemixDialog app={remixing} onClose={() => setRemixing(null)} /> : null}
      {sharing ? <ShareSheet app={sharing} onClose={() => setSharing(null)} onInvite={() => void share(sharing)} /> : null}
      {history ? (
        <History
          appId={history.id}
          appName={history.name}
          onClose={() => setHistory(null)}
          // Restoring from the launcher opens the app on the version you just chose, so you can see
          // what you got back.
          onRestored={() => openUserApp(history.id)}
        />
      ) : null}
      {editing ? <TileEditor app={editing} onClose={() => setEditing(null)} /> : null}
      {promoting ? <PromoteDialog app={promoting} onCancel={() => setPromoting(null)} /> : null}
    </MetroHome>
  );

  if (start) return metroBody;

  const body = (
    <div className={`k-launcher k-launcher-${variant}`} role="dialog" aria-label={t`App launcher`} onClick={(e) => e.stopPropagation()}>
      <header className="k-launcher-head">
        <div className="k-brand">
          <span className="k-logo" aria-hidden>◆</span>
          <strong>Potyro</strong>
          <span className="k-muted">· {variant === "home" ? t`choose an app` : t`switch app`}</span>
        </div>
        <div className="k-launcher-head-actions">
          {/* One persistent create action (#90): a button here on a wide screen, a floating button
              in thumb reach on a phone (below) — never a tile among the apps. */}
          {variant === "home" ? (
            <button type="button" className="k-add k-primary-action k-launch-newbtn" onClick={() => onNewApp()}>
              ＋ <Trans>New app</Trans>
            </button>
          ) : null}
          {variant === "home" ? (
            <button type="button" className="k-add k-launch-addbtn" aria-label={t`Add an app`} title={t`Add an app someone sent you`} onClick={() => setAdding({})}>
              <span aria-hidden>⤓</span>
              <span className="k-launch-addbtn-word">
                <Trans>Add an app</Trans>
              </span>
            </button>
          ) : null}
          {variant === "home" ? <DataButton onClick={() => navigateTo({ kind: "data" })} /> : null}
          <LookButton onClick={() => setLookOpen(true)} />
          <YouButton onClick={() => setIdentity(true)} />
          {onClose ? (
            <>
              <button type="button" className="k-add" onClick={goHome}>
                ⌂ <Trans>Home</Trans>
              </button>
              <button type="button" className="k-add" aria-label={t`Close launcher`} onClick={onClose}>
                <Trans>Close</Trans> ✕
              </button>
            </>
          ) : null}
        </div>
      </header>
      {identity ? <IdentityPanel onClose={() => setIdentity(false)} /> : null}
      {lookOpen ? <LookPanel onClose={() => setLookOpen(false)} /> : null}
      {adding ? <AddAppDialog initialLink={adding.link} onClose={() => setAdding(null)} /> : null}
      {remixing ? <RemixDialog app={remixing} onClose={() => setRemixing(null)} /> : null}
      {sharing ? <ShareSheet app={sharing} onClose={() => setSharing(null)} onInvite={() => void share(sharing)} /> : null}

      {variant === "home" ? <MoveBanner /> : null}
      {variant === "home" && neverOpened && !welcomeDismissed && !q ? (
        <section className="k-welcome" aria-labelledby="k-welcome-h">
          <h2 id="k-welcome-h">
            <Trans>Make the app you need</Trans>
          </h2>
          <p>
            <Trans>
              Describe what you want to keep track of — a shared shopping list, your plants, a trip — and Potyro builds it. Or open
              one of the examples below and change it.
            </Trans>
          </p>
          <div className="k-welcome-actions">
            <button type="button" className="k-add k-primary-action" onClick={() => onNewApp()}>
              <Trans>Describe an app</Trans>
            </button>
            <button type="button" className="k-welcome-later" onClick={dismissWelcome}>
              <Trans>Not now</Trans>
            </button>
          </div>
        </section>
      ) : null}

      <div className="k-launch-search">
        <input
          ref={searchRef}
          className="k-input"
          type="search"
          placeholder={t`Find an app`}
          aria-label={t`Find an app`}
          value={query}
          autoFocus={!coarse}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
      </div>
      {q && !firstMatch ? (
        <p className="k-muted k-launch-empty k-launch-nomatch">
          <Trans>No app called “{typed}”.</Trans>{" "}
          <button type="button" className="k-add" onClick={() => onNewApp(typed)}>
            <Trans>Create “{typed}”</Trans>
          </button>
        </p>
      ) : null}

      {/* Conversations that have not made an app yet (#261), before the apps: they are what you were last doing. */}
      {variant === "home" && onResumeDraft && !q ? <DraftStrip onResume={onResumeDraft} /> : null}

      {pinned.length ? (
        <section className="k-launch-section" aria-labelledby="k-launch-pinned">
          <h3 className="k-launch-title" id="k-launch-pinned">
            <Trans>Pinned</Trans>
          </h3>
          <div className="k-launch-grid" data-reorderable="true">
            {pinned.map((a) => (
              <div key={a.key} className={`k-launch-item${a.kind === "user" ? " k-launch-usertile" : ""}`} {...pinnedReorder.item(a.key)} {...inertUnless(a.key)}>
                <Tile app={a} active={isSelected(a)} onOpen={() => onOpen(a)} now={mountedAt} />
                {menuFor(a)}
              </div>
            ))}
          </div>
          <p className="k-visually-hidden" aria-live="polite">{pinnedReorder.announcement}</p>
        </section>
      ) : null}

      <section className="k-launch-section" aria-labelledby="k-launch-all">
        <div className="k-launch-section-head">
          <h3 className="k-launch-title" id="k-launch-all">
            {pinned.length ? t`Everything else` : variant === "home" && neverOpened && !welcomeDismissed ? t`Examples to try` : t`Apps`}
          </h3>
          <div className="k-launch-sort" role="group" aria-label={t`Sort apps`}>
            {SORT_MODES.map((m) => (
              <button key={m.id} type="button" className="k-launch-sort-btn" aria-pressed={sortMode === m.id} title={t(m.title)} onClick={() => setSortMode(m.id)}>
                {t(m.label)}
              </button>
            ))}
          </div>
        </div>
        <div className="k-launch-grid" data-reorderable={sortMode === "manual"}>
          {rest.map((a) => (
            <div key={a.key} className={`k-launch-item${a.kind === "user" ? " k-launch-usertile" : ""}`} {...restReorder.item(a.key)} {...inertUnless(a.key)}>
              {/* The badge reads the record: a Studio-authored app is the user's own and runs
                  trusted. Hardcoding "untrusted" here once reported the opposite of what ran. */}
              <Tile app={a} active={isSelected(a)} onOpen={() => onOpen(a)} now={mountedAt} />
              {menuFor(a)}
            </div>
          ))}
        </div>
        <p className="k-visually-hidden" aria-live="polite">{restReorder.announcement}</p>
        {!installed.length ? (
          <p className="k-muted k-launch-empty">
            <Trans>No apps yet — press New app to make one.</Trans>
          </p>
        ) : null}
      </section>

      {/* A bundled example you deleted is gone for good, which is right — until you want it back.
          Nothing brings one back on its own; this is how you ask. */}
      {gone.length ? (
        <section className="k-launch-section" aria-labelledby="k-launch-gone">
          <div className="k-launch-section-head">
            <h3 className="k-launch-title" id="k-launch-gone">
              <Trans>Bundled examples</Trans>
            </h3>
          </div>
          <div className="k-launch-gone">
            {gone.map((e) => (
              <button key={e.id} type="button" className="k-add k-launch-restore" disabled={busy === e.id} onClick={() => void restore(e.id)}>
                <span aria-hidden>＋</span> {e.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {variant === "home" ? (
        // On a phone the header's Add button is a lone icon, and this is the button people reach for:
        // so it asks which they mean — make one, or bring in one someone sent (#253).
        <ActionMenu
          label={t`New app`}
          title={t`New app`}
          buttonClassName="k-launch-fab"
          trigger={
            <>
              <span aria-hidden>＋</span> <Trans>New app</Trans>
            </>
          }
          entries={[
            { key: "describe", label: t`Describe a new app`, icon: "✦", onSelect: () => onNewApp() },
            { key: "add", label: t`Add an app someone sent you`, icon: "⤓", onSelect: () => setAdding({}) },
            { key: "gallery", label: t({ message: "Browse the gallery", comment: "Opens Potyro's gallery of apps to try and make your own" }), icon: "▦", onSelect: () => openGallery() },
          ]}
        />
      ) : null}

      {history ? (
        <History
          appId={history.id}
          appName={history.name}
          onClose={() => setHistory(null)}
          // Restoring from the launcher opens the app on the version you just chose, so you can see
          // what you got back.
          onRestored={() => openUserApp(history.id)}
        />
      ) : null}
      {editing ? <TileEditor app={editing} onClose={() => setEditing(null)} /> : null}
      {promoting ? <PromoteDialog app={promoting} onCancel={() => setPromoting(null)} /> : null}
    </div>
  );

  if (variant === "overlay") {
    const rows = [...pinned, ...rest];
    const row = (a: InstalledApp) => {
      const identity = tileIdentity(a);
      const current = isSelected(a);
      return (
        <div key={a.key} className="k-launch-item k-launch-usertile" {...inertUnless(a.key)}>
          <button
            type="button"
            className="k-launch-tile k-launch-tile-row"
            data-active={current}
            aria-current={current ? "true" : undefined}
            disabled={current}
            title={current ? t`This app` : undefined}
            style={{ "--tile-accent": identity.accent } as CSSProperties}
            onClick={() => onOpen(a)}
          >
            <Avatar app={a} identity={identity} attention={attentionOf(a.entry, mountedAt).total} />
            <span className="k-launch-name">{a.name}</span>
            {attentionOf(a.entry, mountedAt).total ? <span className="k-visually-hidden">, {describeAttention(attentionOf(a.entry, mountedAt))}</span> : null}
            <SyncMark app={a} compact />
          </button>
          {menuFor(a)}
        </div>
      );
    };
    const extra = (label: string, glyph: string, fn: () => void) => (
      <button type="button" className="k-launch-tile k-launch-tile-row k-launch-tile-extra" onClick={fn}>
        <span className="k-launch-avatar" aria-hidden>{glyph}</span>
        <span className="k-launch-name">{label}</span>
      </button>
    );
    return (
      <div className="k-launcher-scrim" onClick={onClose}>
        <div
          ref={sheetRef}
          className="k-launcher k-launcher-overlay k-switcher"
          role="dialog"
          aria-modal="true"
          aria-label={t`Switch app`}
          tabIndex={-1}
          style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose?.();
          }}
        >
          <div className="k-switcher-grip" {...swipeHandlers}>
            <span className="k-switcher-handle" aria-hidden />
            <header className="k-switcher-head">
              <strong>
                <Trans>Switch app</Trans>
              </strong>
              <button type="button" className="k-add k-switcher-close" aria-label={t`Close launcher`} onClick={onClose}>
                ✕
              </button>
            </header>
          </div>
          {identity ? <IdentityPanel onClose={() => setIdentity(false)} /> : null}
          {lookOpen ? <LookPanel onClose={() => setLookOpen(false)} /> : null}
          <div className="k-switcher-list">
            {rows.map(row)}
            {rows.length === 0 ? (
              <p className="k-muted k-switcher-empty">
                <Trans>No app called “{typed}”.</Trans>
              </p>
            ) : null}
            <div className="k-switcher-sep" role="separator" />
            {extra(t`Home`, "⌂", goHome)}
            {extra(t`New app`, "+", () => onNewApp())}
            {extra(t`You and your devices`, "⌾", () => setIdentity(true))}
          </div>
          <div className="k-switcher-search">
            <input
              ref={searchRef}
              className="k-input"
              type="search"
              placeholder={t`Find an app`}
              aria-label={t`Find an app`}
              value={query}
              autoFocus={!coarse}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
            />
          </div>
          {history ? <History appId={history.id} appName={history.name} onClose={() => setHistory(null)} onRestored={() => openUserApp(history.id)} /> : null}
          {editing ? <TileEditor app={editing} onClose={() => setEditing(null)} /> : null}
          {promoting ? <PromoteDialog app={promoting} onCancel={() => setPromoting(null)} /> : null}
          {/* The switcher is its own tree: Share from a tile here needs its sheet here too (docs/24). */}
          {sharing ? <ShareSheet app={sharing} onClose={() => setSharing(null)} onInvite={() => void share(sharing)} /> : null}
        </div>
      </div>
    );
  }
  return body;
}
