// Launcher — the app switcher. Two variants share one presentation:
//   • "home"    — the full-screen first surface when no app is selected.
//   • "overlay" — a slide-in panel opened from inside a running app, to switch quickly.
// Each tile shows the provenance the app ACTUALLY runs under, from its own `trusted` flag: an app
// authored here (the seeded examples included, #152) runs directly; something imported from
// elsewhere runs in the QuickJS isolate until promoted. Selecting a tile navigates via a reload
// (?user=<id>) — boot() routes on that.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { shellDialogs } from "./dialog.js";
import { removeUserApp, renameUserApp, type UserApp } from "./user-apps.js";
import { setOrder, setPinned, setSortMode, useInstalledApps, useSortMode, type AppKey, type InstalledApp } from "./launcher-store.js";
import { SORT_MODES, orderApps } from "./launcher-order.js";
import { useReorder } from "./launcher-reorder.js";
import { tileIdentity } from "./tile-identity.js";
import { toggleAppSync } from "./toggle-sync.js";
import { createShareLink } from "./share-sync.js";
import { IdentityPanel, askNameIfUnnamed, offerBackupOnFirstSync } from "./identity-panel.js";
import { canSync, CANNOT_SYNC_MESSAGE } from "./open-store.js";
import { checkConcurrency, describeHazards } from "./check-concurrency.js";
import { History } from "./history.js";

export function openUserApp(id: string): void {
  location.search = `?user=${encodeURIComponent(id)}`;
}
export function goHome(): void {
  location.assign(location.pathname);
}
/** Open an installed app: a reload into its route, which is how boot() counts an open (#81). */
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
  onNewApp: () => void;
  onClose?: () => void;
}

// A tile is the app's identity (#82): its declared icon and accent, or a monogram in a colour derived
// from the app so that four apps starting with P are four different tiles. The name is the app's
// declared one ("PPL Log", not "workout") unless the user renamed it here.
function Tile({ app, active, onOpen }: { app: InstalledApp; active: boolean; onOpen: () => void }) {
  const identity = tileIdentity(app);
  return (
    <button
      type="button"
      className="k-launch-tile"
      data-active={active}
      style={{ "--tile-accent": identity.accent } as CSSProperties}
      onClick={onOpen}
    >
      <span className="k-launch-avatar" data-kind={identity.kind} aria-hidden>
        {identity.glyph}
      </span>
      <span className="k-launch-name">{app.name}</span>
      <span className={`k-prov k-prov-${app.trusted ? "trusted" : "untrusted"}`}>{app.trusted ? "trusted" : "untrusted"}</span>
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
  onHistory: () => void;
  onSync: () => void;
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function TileMenu({
  app,
  busy,
  onOpen,
  onPin,
  user,
  onToggle,
}: {
  app: InstalledApp;
  busy: boolean;
  onOpen: () => void;
  onPin: () => void;
  /** History, sync, share, rename, delete: every app has them (#152). */
  user: UserActions;
  /** Told when the menu opens or closes, so the launcher can make everything else inert. */
  onToggle?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean | ((v: boolean) => boolean)): void =>
    setOpenState((v) => {
      const value = typeof next === "function" ? next(v) : next;
      if (value !== v) onToggle?.(value);
      return value;
    });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Pinning moves the tile to another section, which remounts this menu with its state gone. The
  // launcher must hear that the menu closed, or every other tile stays inert.
  const openRef = useRef(false);
  openRef.current = open;
  useEffect(
    () => () => {
      if (openRef.current) onToggle?.(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
        aria-label={`Actions for ${app.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? "…" : "⋯"}
      </button>
      {open ? (
        <>
          <div className="k-tile-menu-scrim" onClick={() => close(false)} />
          <div ref={menuRef} className="k-tile-menu" role="menu" aria-label={`Actions for ${app.name}`} onKeyDown={onMenuKey}>
            {/* The menu already says whose it is (aria-label); the title is for the eye. */}
            <div className="k-tile-menu-title" aria-hidden>{app.name}</div>
            {item("open", "Open", onOpen)}
            {item("pin", app.entry.pinned ? "Unpin" : "Pin", onPin)}
            {item("history", "History", user.onHistory)}
            {item("sync", app.sync ? "Turn sync off" : "Turn sync on", user.onSync, { disabled: busy })}
            {item("share", "Share", user.onShare)}
            {item("rename", "Rename", user.onRename)}
            <div className="k-tile-menu-sep" role="separator" />
            {item("delete", "Delete", user.onDelete, { className: "k-danger" })}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function Launcher({ variant, selected, onOpen, onNewApp, onClose }: LauncherProps) {
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
  const { pinned, rest } = orderApps(installed, sortMode, mountedAt);
  const hasUserApps = installed.some((a) => a.kind === "user");
  const nameOf = (key: string): string => installed.find((a) => a.key === key)?.name ?? key;
  const pinnedReorder = useReorder(pinned.map((a) => a.key), nameOf, (keys) => setOrder(keys as AppKey[]), true);
  const restReorder = useReorder(rest.map((a) => a.key), nameOf, (keys) => setOrder(keys as AppKey[]), sortMode === "manual");
  // Reviewing/rolling back an app's history without opening it — the way back when an edit broke the
  // app badly enough that its own header is no longer reachable.
  const [history, setHistory] = useState<UserApp | null>(null);
  // You and your other devices — reachable from every launcher, nagged from none.
  const [identity, setIdentity] = useState(false);

  // The switcher (#88): on a phone a bottom sheet you can swipe away, with a search field at the
  // bottom edge, inside the thumb's reach; on a desktop a drawer. Both are a compact list, not the
  // home grid squeezed into a panel — "switch to X" is a name in your head, not a place on a grid.
  const [query, setQuery] = useState("");
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
  const del = async (a: UserApp): Promise<void> => {
    if (!(await shellDialogs.confirm(`Delete "${a.name}" and everything in it? This can't be undone.`))) return;
    await removeUserApp(a.id);
  };
  // Sync moves the app's data between two stores that keep it in DIFFERENT files, so this is a
  // migration, not a checkbox. It says what it will do, reports anything it could not move, and
  // never deletes the old copy — flipping back is the way out if it was a mistake.
  const [busy, setBusy] = useState<string | null>(null);
  const toggleSync = async (a: UserApp): Promise<void> => {
    const on = !a.sync;
    if (on && !canSync()) {
      await shellDialogs.confirm(CANNOT_SYNC_MESSAGE);
      return;
    }
    const ok = await shellDialogs.confirm(
      on
        ? `Turn on sync for "${a.name}"? Its data will be copied into the synced store. The old copy is kept, so you can turn this back off.`
        : `Turn off sync for "${a.name}"? Its data will be copied back to local-only storage.`,
    );
    if (!ok) return;
    setBusy(a.id);
    try {
      const { inspect } = await import("./app-source.js");
      const shape = await inspect(a.source);
      const entities = shape.entities.map((e) => e.key);
      const { copied, warnings } = await toggleAppSync(a.id, entities, on, new Date().toISOString());
      const moved = `Moved ${copied.records} record(s)`;
      // A partial migration must be surfaced. Silently losing photos is the failure this whole
      // path exists to avoid.
      await shellDialogs.confirm(warnings.length ? `${moved}. ${warnings.join(" ")}` : `${moved}. Sync is ${on ? "on" : "off"}.`);
      // Only after the outcome is reported. The first time anything syncs is the first time the
      // recovery words are TRUE — before that they restore nothing, because the data has never left
      // this device — but stacking the question on top of the result reads as one confusing dialog.
      if (on) await offerBackupOnFirstSync(() => setIdentity(true));
    } catch (e) {
      await shellDialogs.confirm(`Could not change sync: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  // Sharing hands over a link whose fragment carries the app source AND the invite secret. The
  // fragment never reaches a server, which is what keeps the key off the relay.
  const share = async (a: UserApp): Promise<void> => {
    if (!canSync()) {
      await shellDialogs.confirm(CANNOT_SYNC_MESSAGE);
      return;
    }
    try {
      // Sharing implies sync. Making the user find the sync toggle first was a step that taught
      // them nothing — the reason to turn sync on IS to share.
      if (!a.sync) {
        const ok = await shellDialogs.confirm(
          `Share "${a.name}"? This turns on sync and copies its data into the synced store. You can turn it off again later.`,
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
        const go = await shellDialogs.confirm(
          `Before you share "${a.name}" — two people using it at once can lose each other's work:\n\n` +
            `• ${hazards.join("\n• ")}\n\n` +
            `Nothing is wrong with it on your own. Share anyway?`,
        );
        if (!go) return;
      }

      // Before the link, not after: `createShareLink` opens the space and publishes your profile, so
      // asking afterwards would put you in front of the other person as "Me" until something else
      // republished it.
      await askNameIfUnnamed();
      const link = await createShareLink(a.id);
      await shellDialogs.share("Send this link. Whoever opens it joins your app and its data.", link);
      // After the link, not before it: the user came here to share, and interrupting that with a
      // question about recovery words buries the thing they actually asked for.
      await offerBackupOnFirstSync(() => setIdentity(true));
    } catch (e) {
      setBusy(null);
      await shellDialogs.confirm(e instanceof Error ? e.message : String(e));
    }
  };

  const rename = async (a: UserApp): Promise<void> => {
    const name = await shellDialogs.prompt("Rename app", { default: a.name });
    if (name && name.trim()) {
      renameUserApp(a.id, name, new Date().toISOString());
    }
  };

  const isSelected = (a: InstalledApp): boolean => selected?.kind === a.kind && selected.id === a.id;
  // While one tile's menu is open the other tiles are inert: a popover that sits over the tile
  // below it must not leave that tile's button half-reachable, by pointer or by Tab.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const inertUnless = (key: string): Record<string, string> | Record<string, never> => (openMenu && openMenu !== key ? { inert: "" } : {});
  const menuFor = (a: InstalledApp) => (
    <TileMenu
      app={a}
      busy={busy === a.id}
      onOpen={() => onOpen(a)}
      onPin={() => setPinned(a.key, !a.entry.pinned)}
      onToggle={(open) => setOpenMenu((cur) => (open ? a.key : cur === a.key ? null : cur))}
      user={{
        onHistory: () => setHistory(a.user),
        onSync: () => void toggleSync(a.user),
        onShare: () => void share(a.user),
        onRename: () => void rename(a.user),
        onDelete: () => void del(a.user),
      }}
    />
  );

  const body = (
    <div className={`k-launcher k-launcher-${variant}`} role="dialog" aria-label="App launcher" onClick={(e) => e.stopPropagation()}>
      <header className="k-launcher-head">
        <div className="k-brand">
          <span className="k-logo" aria-hidden>◆</span>
          <strong>Karta</strong>
          <span className="k-muted">{variant === "home" ? "· choose an app" : "· switch app"}</span>
        </div>
        <div className="k-launcher-head-actions">
          <button type="button" className="k-add" aria-label="You and your devices" onClick={() => setIdentity(true)}>
            ⌾ You
          </button>
          {onClose ? (
            <>
              <button type="button" className="k-add" onClick={goHome}>⌂ Home</button>
              <button type="button" className="k-add" aria-label="Close launcher" onClick={onClose}>Close ✕</button>
            </>
          ) : null}
        </div>
      </header>
      {identity ? <IdentityPanel onClose={() => setIdentity(false)} /> : null}

      {pinned.length ? (
        <section className="k-launch-section" aria-labelledby="k-launch-pinned">
          <h3 className="k-launch-title" id="k-launch-pinned">Pinned</h3>
          <div className="k-launch-grid" data-reorderable="true">
            {pinned.map((a) => (
              <div key={a.key} className={`k-launch-item${a.kind === "user" ? " k-launch-usertile" : ""}`} {...pinnedReorder.item(a.key)} {...inertUnless(a.key)}>
                <Tile app={a} active={isSelected(a)} onOpen={() => onOpen(a)} />
                {menuFor(a)}
              </div>
            ))}
          </div>
          <p className="k-visually-hidden" aria-live="polite">{pinnedReorder.announcement}</p>
        </section>
      ) : null}

      <section className="k-launch-section" aria-labelledby="k-launch-all">
        <div className="k-launch-section-head">
          <h3 className="k-launch-title" id="k-launch-all">{pinned.length ? "Everything else" : "Apps"}</h3>
          <div className="k-launch-sort" role="group" aria-label="Sort apps">
            {SORT_MODES.map((m) => (
              <button key={m.id} type="button" className="k-launch-sort-btn" aria-pressed={sortMode === m.id} title={m.title} onClick={() => setSortMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="k-launch-grid" data-reorderable={sortMode === "manual"}>
          {rest.map((a) => (
            <div key={a.key} className={`k-launch-item${a.kind === "user" ? " k-launch-usertile" : ""}`} {...restReorder.item(a.key)} {...inertUnless(a.key)}>
              {/* The badge reads the record: a Studio-authored app is the user's own and runs
                  trusted. Hardcoding "untrusted" here once reported the opposite of what ran. */}
              <Tile app={a} active={isSelected(a)} onOpen={() => onOpen(a)} />
              {menuFor(a)}
            </div>
          ))}
          <button type="button" className="k-launch-tile k-launch-new" onClick={onNewApp} {...inertUnless("new")}>
            <span className="k-launch-avatar" aria-hidden>+</span>
            <span className="k-launch-name">New app</span>
            <span className="k-muted">Studio</span>
          </button>
        </div>
        <p className="k-visually-hidden" aria-live="polite">{restReorder.announcement}</p>
        {!hasUserApps ? (
          <p className="k-muted k-launch-empty">No saved apps yet — create one in the Studio, then it appears here.</p>
        ) : null}
      </section>

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
    </div>
  );

  if (variant === "overlay") {
    const q = query.trim().toLowerCase();
    const rows = [...pinned, ...rest].filter((a) => !q || a.name.toLowerCase().includes(q) || a.user.name.toLowerCase().includes(q));
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
            title={current ? "This app" : undefined}
            style={{ "--tile-accent": identity.accent } as CSSProperties}
            onClick={() => onOpen(a)}
          >
            <span className="k-launch-avatar" data-kind={identity.kind} aria-hidden>
              {identity.glyph}
            </span>
            <span className="k-launch-name">{a.name}</span>
            {a.sync ? (
              <span className="k-launch-mark" title="Synced" aria-label="Synced">
                ⟳
              </span>
            ) : null}
            <span className={`k-prov k-prov-${a.trusted ? "trusted" : "untrusted"}`}>{a.trusted ? "trusted" : "untrusted"}</span>
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
          aria-label="Switch app"
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
              <strong>Switch app</strong>
              <button type="button" className="k-add k-switcher-close" aria-label="Close launcher" onClick={onClose}>
                ✕
              </button>
            </header>
          </div>
          {identity ? <IdentityPanel onClose={() => setIdentity(false)} /> : null}
          <div className="k-switcher-list">
            {rows.map(row)}
            {rows.length === 0 ? <p className="k-muted k-switcher-empty">No app called “{query.trim()}”.</p> : null}
            <div className="k-switcher-sep" role="separator" />
            {extra("Home", "⌂", goHome)}
            {extra("New app", "+", onNewApp)}
            {extra("You and your devices", "⌾", () => setIdentity(true))}
          </div>
          <div className="k-switcher-search">
            <input
              className="k-input"
              type="search"
              placeholder="Find an app"
              aria-label="Find an app"
              value={query}
              autoFocus={!coarse}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && rows[0] && !isSelected(rows[0])) onOpen(rows[0]);
              }}
            />
          </div>
          {history ? <History appId={history.id} appName={history.name} onClose={() => setHistory(null)} onRestored={() => openUserApp(history.id)} /> : null}
        </div>
      </div>
    );
  }
  return body;
}
