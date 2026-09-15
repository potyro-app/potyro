// The app's chrome (#111): what surrounds a page, chosen by the viewport.
//
// On a phone: a compact top bar (Apps, the app's icon and name, one `⋯` menu with the shell's
// tools), a bottom tab bar with the first four pages and More, and the page's quick action as a
// floating button in thumb reach. On a wide screen: a sidebar with the app's identity, its pages,
// its quick actions and the shell's tools grouped at the bottom, and the content beside it.
//
// The app declares pages and quick actions as it always has; nothing here is the app's to style.
// The shell's own tools — Studio, Edit mode, History, Import, Export, "Something's wrong", trust —
// never sit above the app's content again: they were what a phone scrolled past before the first
// row, and none of them is what someone opened a recipe list to do.

import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ActionMenu, usePhone, type MenuEntry } from "@karta/views";

const WIDE_FROM = 760;

/**
 * Phone or wide, by the width the chrome actually has — not the viewport's. The Studio previews an
 * app in a column beside its prompt, and a sidebar squeezed into that column would be the old
 * header all over again; measured, the preview gets the phone chrome the app will mostly wear.
 */
function useNarrow(ref: React.RefObject<HTMLDivElement | null>, viewportPhone: boolean): boolean {
  const [narrow, setNarrow] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return;
    // A width of 0 is "not laid out yet", not "narrow": keep the viewport's answer until measured.
    const read = (): void => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setNarrow(w < WIDE_FROM);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return narrow ?? viewportPhone;
}

export interface ChromePage {
  id: string;
  title: string;
  icon: string;
  active: boolean;
  onOpen: () => void;
}

export interface ChromeQuick {
  id: string;
  label: string;
  icon: string;
  entity: string;
  onRun: () => void;
}

export interface ChromeTool {
  key: string;
  label: string;
  icon?: string;
  hint?: string;
  onSelect: () => void;
  /** A tool that is on or off (Edit mode). */
  active?: boolean;
  className?: string;
  danger?: boolean;
}

export interface AppChromeProps {
  name: string;
  icon: string;
  /** The app-wide selection chip, when the app declares a scope. */
  scope?: ReactNode;
  /** Quiet marks: sync state, "sandbox". */
  status?: ReactNode;
  pages: ChromePage[];
  quick: ChromeQuick[];
  /** The entity the open page is about — its quick action is the primary one here. */
  currentEntity?: string;
  /** Studio, Edit mode, History, Import, Export. */
  tools: ChromeTool[];
  /** "Something's wrong", or while recording, "Stop recording" and "Add a note". */
  report: ChromeTool[];
  recording?: boolean;
  trust?: ChromeTool;
  onApps?: () => void;
  /** The Changes and Chat buttons of a synced app, with their counts. */
  extras?: ReactNode;
  /** Edit-mode marks for the navigation and the quick actions. */
  navMark?: ReactNode;
  quickMark?: ReactNode;
  /** On a sub-page (a record's detail): where the top bar's back control goes. */
  onBack?: () => void;
  /** The open page's title, shown above the content on a wide screen. */
  pageTitle?: string;
  /** False on a page that has its own actions (a detail): no floating button over them. */
  showQuick?: boolean;
  /** This copy may not write (KA-22): quick actions are announced as unavailable. */
  locked?: boolean;
  children: ReactNode;
}

const TAB_SLOTS = 4;
const HOLD_MS = 450;

/** The quick action for this page: the one whose entity the page is about, else the first. */
export function primaryQuick(quick: ChromeQuick[], currentEntity: string | undefined): ChromeQuick | undefined {
  return quick.find((q) => q.entity === currentEntity) ?? quick[0];
}

export function AppChrome(props: AppChromeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const phone = useNarrow(ref, usePhone());
  return (
    <div ref={ref} className="k-app-chrome" data-layout={phone ? "phone" : "wide"}>
      {phone ? <PhoneChrome {...props} /> : <WideChrome {...props} />}
    </div>
  );
}

function toolEntry(t: ChromeTool): MenuEntry {
  return { key: t.key, label: t.label, icon: t.icon, hint: t.hint ?? (t.active ? "on" : undefined), onSelect: t.onSelect, className: t.className, danger: t.danger };
}

function PhoneChrome({ name, icon, scope, status, pages, quick, currentEntity, tools, report, recording, trust, onApps, extras, navMark, quickMark, onBack, showQuick = true, locked, children }: AppChromeProps) {
  const primary = primaryQuick(quick, currentEntity);
  const others = quick.filter((q) => q !== primary);
  const [dial, setDial] = useState(false);

  // The floating button runs the page's quick action on a tap; held, it shows the others above it.
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const fabHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || others.length === 0) return;
      held.current = false;
      hold.current = setTimeout(() => {
        held.current = true;
        setDial(true);
      }, HOLD_MS);
    },
    onPointerUp: () => {
      if (hold.current) clearTimeout(hold.current);
      hold.current = null;
    },
    onPointerCancel: () => {
      if (hold.current) clearTimeout(hold.current);
      hold.current = null;
    },
    onClick: () => {
      if (held.current) {
        held.current = false;
        return;
      }
      primary?.onRun();
    },
  };

  const menu: MenuEntry[] = [
    ...others.map((q): MenuEntry => ({ key: `quick-${q.id}`, label: q.label, icon: q.icon, onSelect: q.onRun })),
    ...(others.length && tools.length ? ["separator" as const] : []),
    ...tools.map(toolEntry),
    ...((tools.length || others.length) && (report.length || trust) ? ["separator" as const] : []),
    ...report.map(toolEntry),
    ...(trust ? [toolEntry(trust)] : []),
  ];

  const shown = pages.slice(0, pages.length > TAB_SLOTS + 1 ? TAB_SLOTS : TAB_SLOTS + 1);
  const more = pages.slice(shown.length);

  return (
    <div className="k-app-phone" data-recording={recording || undefined}>
      <header className="k-topbar">
        {onBack ? (
          <button type="button" className="k-topbar-btn k-topbar-back" aria-label="Back" onClick={onBack}>
            ‹
          </button>
        ) : onApps ? (
          <button type="button" className="k-topbar-btn" aria-label="Switch app" onClick={onApps}>
            ⊞
          </button>
        ) : null}
        <span className="k-topbar-icon" aria-hidden>
          {icon}
        </span>
        <h1 className="k-topbar-name">{name}</h1>
        {scope}
        {status}
        {extras}
        {menu.length ? <ActionMenu label="More" title={name} entries={menu} buttonClassName="k-topbar-btn" /> : null}
      </header>
      {recording ? (
        <div className="k-recbar" role="status">
          <span className="k-recbar-dot" aria-hidden />
          Recording
          {report.map((t) => (
            <button key={t.key} type="button" className="k-add" onClick={t.onSelect}>
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="k-page">{children}</div>

      {primary && showQuick ? (
        <>
          {dial ? (
            <>
              <div className="k-fab-scrim" onClick={() => setDial(false)} />
              <div className="k-fab-dial" role="group" aria-label="Quick actions">
                {others.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className="k-fab-other"
                    aria-disabled={locked || undefined}
                    onClick={() => {
                      setDial(false);
                      q.onRun();
                    }}
                  >
                    <span aria-hidden>{q.icon}</span> {q.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <button type="button" className="k-fab k-quick" data-open={dial || undefined} aria-disabled={locked || undefined} {...fabHandlers}>
            <span className="k-fab-plus" aria-hidden>
              ＋
            </span>
            {primary.label}
            {quickMark}
          </button>
        </>
      ) : null}

      <nav className="k-nav k-tabbar" aria-label="Pages">
        {navMark}
        {shown.map((p) => (
          <button key={p.id} type="button" className="k-tab" data-active={p.active} onClick={p.onOpen}>
            <span className="k-tab-icon" aria-hidden>
              {p.icon}
            </span>
            <span className="k-tab-label">{p.title}</span>
          </button>
        ))}
        {more.length ? (
          <ActionMenu
            label="More pages"
            trigger={
              <>
                <span className="k-tab-icon" aria-hidden>
                  ⋯
                </span>
                <span className="k-tab-label">More</span>
              </>
            }
            buttonClassName={`k-tab${more.some((p) => p.active) ? " k-tab-more-active" : ""}`}
            entries={more.map((p): MenuEntry => ({ key: p.id, label: p.title, icon: p.icon, hint: p.active ? "here" : undefined, onSelect: p.onOpen, className: "k-tab k-tab-in-menu" }))}
          />
        ) : null}
      </nav>
    </div>
  );
}

function WideChrome({ name, icon, scope, status, pages, quick, currentEntity, tools, report, recording, trust, onApps, extras, navMark, quickMark, onBack, pageTitle, locked, children }: AppChromeProps) {
  const primary = primaryQuick(quick, currentEntity);
  const ordered = primary ? [primary, ...quick.filter((q) => q !== primary)] : quick;
  const toolButton = (t: ChromeTool) => (
    <button
      key={t.key}
      type="button"
      className={`k-tool${t.className ? ` ${t.className}` : ""}${t.danger ? " k-danger" : ""}`}
      data-active={t.active}
      // The same accessible names as the phone's controls, whatever the visible word.
      aria-label={t.key === "edit-mode" ? "Edit mode" : t.key === "apps" ? "Switch app" : t.hint ? t.label : undefined}
      title={t.hint}
      onClick={t.onSelect}
    >
      <span className="k-tool-icon" aria-hidden>
        {t.icon ?? ""}
      </span>
      <span>{t.label}</span>
      {t.hint ? (
        <span className="k-tool-hint" aria-hidden>
          {t.hint}
        </span>
      ) : null}
    </button>
  );
  return (
    <div className="k-app-wide" data-recording={recording || undefined}>
      <aside className="k-sidebar">
        <div className="k-brand">
          <span className="k-brand-icon" aria-hidden>
            {icon}
          </span>
          <h1 className="k-brand-name">{name}</h1>
        </div>
        {scope || status || extras ? (
          <div className="k-sidebar-status">
            {scope}
            {status}
            {extras}
          </div>
        ) : null}
        <nav className="k-nav k-sidenav" aria-label="Pages">
          <h5 className="k-sidebar-heading">Pages</h5>
          {navMark}
          {pages.map((p) => (
            <button key={p.id} type="button" className="k-tab" data-active={p.active} onClick={p.onOpen}>
              <span className="k-tab-icon" aria-hidden>
                {p.icon}
              </span>
              <span className="k-tab-label">{p.title}</span>
            </button>
          ))}
        </nav>
        {ordered.length ? (
          <div className="k-quickbar">
            {ordered.map((q, i) => (
              <button key={q.id} type="button" className={`k-add k-quick${i === 0 ? " k-primary-action" : ""}`} aria-disabled={locked || undefined} onClick={q.onRun}>
                <span aria-hidden>{q.icon}</span> {q.label}
              </button>
            ))}
            {quickMark}
          </div>
        ) : null}
        {tools.length || report.length || trust || onApps ? (
          <div className="k-tools">
            <h5 className="k-sidebar-heading">This app</h5>
            {tools.map(toolButton)}
            {recording ? (
              <div className="k-recbar" role="status">
                <span className="k-recbar-dot" aria-hidden />
                Recording
              </div>
            ) : null}
            {report.map(toolButton)}
            {trust ? toolButton(trust) : null}
            {onApps ? toolButton({ key: "apps", label: "All apps", icon: "⊞", onSelect: onApps }) : null}
          </div>
        ) : null}
      </aside>
      <div className="k-content">
        {pageTitle ? (
          <div className="k-page-head">
            {onBack ? (
              <button type="button" className="k-topbar-btn k-topbar-back" aria-label="Back" onClick={onBack}>
                ‹
              </button>
            ) : null}
            <h2 className="k-page-title">{pageTitle}</h2>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
