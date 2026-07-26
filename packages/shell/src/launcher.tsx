// Launcher — the app switcher. Two variants share one presentation:
//   • "home"    — the full-screen first surface when no app is selected.
//   • "overlay" — a slide-in panel opened from inside a running app, to switch quickly.
// Apps are grouped by provenance: trusted (built-in examples, run directly) and untrusted (the
// user's saved apps from My Apps, run in the QuickJS isolate). Selecting a tile navigates via a
// reload (?app=<id> or ?user=<id>) — boot() routes on that.

import type { UserApp } from "./user-apps.js";

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

export function Launcher({ builtins, userApps, variant, selected, onOpenBuiltin, onOpenUser, onNewApp, onClose }: LauncherProps) {
  const body = (
    <div className={`k-launcher k-launcher-${variant}`} role="dialog" aria-label="App launcher" onClick={(e) => e.stopPropagation()}>
      <header className="k-launcher-head">
        <div className="k-brand">
          <span className="k-logo" aria-hidden>◆</span>
          <strong>Karta</strong>
          <span className="k-muted">{variant === "home" ? "· choose an app" : "· switch app"}</span>
        </div>
        {onClose ? (
          <button type="button" className="k-add" aria-label="Close launcher" onClick={onClose}>
            Close ✕
          </button>
        ) : null}
      </header>

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
          {userApps.map((a) => (
            <Tile
              key={a.id}
              name={a.name}
              badge="untrusted"
              active={selected?.kind === "user" && selected.id === a.id}
              onOpen={() => onOpenUser(a.id)}
            />
          ))}
          <button type="button" className="k-launch-tile k-launch-new" onClick={onNewApp}>
            <span className="k-launch-avatar" aria-hidden>+</span>
            <span className="k-launch-name">New app</span>
            <span className="k-muted">Studio</span>
          </button>
        </div>
        {userApps.length === 0 ? (
          <p className="k-muted k-launch-empty">No saved apps yet — create one in the Studio, then it appears here.</p>
        ) : null}
      </section>
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
