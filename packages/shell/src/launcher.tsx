// Launcher — the app switcher. Two variants share one presentation:
//   • "home"    — the full-screen first surface when no app is selected.
//   • "overlay" — a slide-in panel opened from inside a running app, to switch quickly.
// Each tile shows the provenance the app ACTUALLY runs under: built-in examples are trusted; a saved
// app reports its own `trusted` flag (Studio-authored apps are the user's own and run directly;
// something imported from elsewhere runs in the QuickJS isolate until promoted). Selecting a tile
// navigates via a reload (?app=<id> or ?user=<id>) — boot() routes on that.

import { useEffect, useState } from "react";
import { shellDialogs } from "./dialog.js";
import { listUserApps, removeUserApp, renameUserApp, type UserApp } from "./user-apps.js";
import { toggleAppSync } from "./toggle-sync.js";
import { createShareLink } from "./share-sync.js";
import { IdentityPanel, askNameIfUnnamed, offerBackupOnFirstSync } from "./identity-panel.js";
import { canSync, CANNOT_SYNC_MESSAGE } from "./open-store.js";
import { checkConcurrency, describeHazards } from "./check-concurrency.js";
import { History } from "./history.js";

export function openBuiltinApp(id: string): void {
  location.search = `?app=${encodeURIComponent(id)}`;
}
export function openUserApp(id: string): void {
  location.search = `?user=${encodeURIComponent(id)}`;
}
export function goHome(): void {
  location.assign(location.pathname);
}

export interface Selected {
  kind: "builtin" | "user";
  id: string;
}

interface LauncherProps {
  builtins: readonly string[];
  userApps: UserApp[];
  variant: "home" | "overlay";
  selected?: Selected;
  onOpenBuiltin: (id: string) => void;
  onOpenUser: (id: string) => void;
  onNewApp: () => void;
  onClose?: () => void;
}

function Tile({
  name,
  badge,
  active,
  onOpen,
}: {
  name: string;
  badge: "trusted" | "untrusted";
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="k-launch-tile" data-active={active} onClick={onOpen}>
      <span className="k-launch-avatar" aria-hidden>
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="k-launch-name">{name}</span>
      <span className={`k-prov k-prov-${badge}`}>{badge}</span>
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
function TileMenu({
  app,
  busy,
  onOpen,
  onHistory,
  onSync,
  onShare,
  onRename,
  onDelete,
}: {
  app: UserApp;
  busy: boolean;
  onOpen: () => void;
  onHistory: () => void;
  onSync: () => void;
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const item = (action: string, label: string, fn: () => void, extra: { className?: string; disabled?: boolean } = {}) => (
    <button type="button" role="menuitem" data-action={action} className={`k-tile-menu-item${extra.className ? ` ${extra.className}` : ""}`} disabled={extra.disabled} onClick={run(fn)}>
      {label}
    </button>
  );
  return (
    <div className="k-tile-menu-host">
      <button
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
          <div className="k-tile-menu-scrim" onClick={() => setOpen(false)} />
          <div
            className="k-tile-menu"
            role="menu"
            aria-label={`Actions for ${app.name}`}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          >
            <div className="k-tile-menu-title">{app.name}</div>
            {item("open", "Open", onOpen)}
            {item("history", "History", onHistory)}
            {item("sync", app.sync ? "Turn sync off" : "Turn sync on", onSync, { disabled: busy })}
            {item("share", "Share", onShare)}
            {item("rename", "Rename", onRename)}
            <div className="k-tile-menu-sep" />
            {item("delete", "Delete", onDelete, { className: "k-danger" })}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function Launcher({ builtins, userApps, variant, selected, onOpenBuiltin, onOpenUser, onNewApp, onClose }: LauncherProps) {
  // Local copy so inline delete/rename reflect immediately (navigation elsewhere is reload-based) —
  // and kept in step with the prop (#78): `useState(userApps)` read it once, so an app created in
  // the Studio did not appear on the home screen until a full reload.
  const [myApps, setMyApps] = useState(userApps);
  useEffect(() => setMyApps(userApps), [userApps]);
  // Reviewing/rolling back an app's history without opening it — the way back when an edit broke the
  // app badly enough that its own header is no longer reachable.
  const [history, setHistory] = useState<UserApp | null>(null);
  // You and your other devices — reachable from every launcher, nagged from none.
  const [identity, setIdentity] = useState(false);
  // Deleting an app takes its records, its version history and its diagnoses with it, and there is no
  // undo. It asked for nothing at all before.
  const del = async (a: UserApp): Promise<void> => {
    if (!(await shellDialogs.confirm(`Delete "${a.name}" and everything in it? This can't be undone.`))) return;
    await removeUserApp(a.id);
    setMyApps(listUserApps());
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
      setMyApps(listUserApps());
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
        setMyApps(listUserApps());
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
      setMyApps(listUserApps());
    }
  };

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

      <section className="k-launch-section">
        <h3 className="k-launch-title">Apps</h3>
        <div className="k-launch-grid">
          {builtins.map((id) => (
            <Tile
              key={id}
              name={id}
              badge="trusted"
              active={selected?.kind === "builtin" && selected.id === id}
              onOpen={() => onOpenBuiltin(id)}
            />
          ))}
        </div>
      </section>

      <section className="k-launch-section">
        <h3 className="k-launch-title">My Apps</h3>
        <div className="k-launch-grid">
          {myApps.map((a) => (
            <div key={a.id} className="k-launch-usertile">
              <Tile
                name={a.name}
                // Read the record, don't assume: a Studio-authored app is the user's own and runs
                // trusted. Hardcoding "untrusted" here reported the opposite of what actually ran.
                badge={a.trusted === false ? "untrusted" : "trusted"}
                active={selected?.kind === "user" && selected.id === a.id}
                onOpen={() => onOpenUser(a.id)}
              />
              <TileMenu
                app={a}
                busy={busy === a.id}
                onOpen={() => onOpenUser(a.id)}
                onHistory={() => setHistory(a)}
                onSync={() => void toggleSync(a)}
                onShare={() => void share(a)}
                onRename={() => void rename(a)}
                onDelete={() => void del(a)}
              />
            </div>
          ))}
          <button type="button" className="k-launch-tile k-launch-new" onClick={onNewApp}>
            <span className="k-launch-avatar" aria-hidden>+</span>
            <span className="k-launch-name">New app</span>
            <span className="k-muted">Studio</span>
          </button>
        </div>
        {myApps.length === 0 ? (
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
    return (
      <div className="k-launcher-scrim" onClick={onClose}>
        {body}
      </div>
    );
  }
  return body;
}
