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

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { t as tr } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ActionMenu, usePhone, type MenuEntry } from "@potyro/views";

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
  /** Says something rather than does something (the app's language, when it cannot be changed here). */
  disabled?: boolean;
  /** A glyph, or a drawn icon where no glyph says it (Data's database). */
  icon?: ReactNode;
  hint?: string;
  onSelect: () => void;
  /** A tool that is on or off (Edit mode). */
  active?: boolean;
  /** Something inside is waiting to be read. On a phone the `⋯` that hides it wears a dot, or a
   *  tool moved into the menu would be a tool nobody learns has news. */
  news?: boolean;
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
  /** On a sub-page (a record's detail): where the top bar's back control goes. */
  onBack?: () => void;
  /** The open page's title, shown above the content on a wide screen. */
  pageTitle?: string;
  /** Its page id — edit mode renames the page when that title is tapped. */
  pageKey?: string;
  /** False on a page that has its own actions (a detail): no floating button over them. */
  showQuick?: boolean;
  /** This page's view IS the page (a map): it fills the area between the bars, edge to edge, and
   *  the chrome — filters, the view's own add button — floats on top of it rather than above it. */
  fullBleed?: boolean;
  /** This copy may not write (KA-22): quick actions are announced as unavailable. */
  locked?: boolean;
  /** The page asked for the whole screen: no bars, only the shell's own way out. */
  fullscreen?: { onExit: () => void };
  children: ReactNode;
}

const TAB_SLOTS = 4;
const HOLD_MS = 450;

/** The quick action for this page: the one whose entity the page is about, else the first. */
/**
 * The quick action a page floats: the one that adds what the page shows. Never another kind's —
 * "Add: Ingredient" floating over a cookbook of recipes is an action for a different page, and the
 * ⋯ menu (or the wide sidebar) still has it.
 */
export function primaryQuick(quick: ChromeQuick[], currentEntity: string | undefined): ChromeQuick | undefined {
  return quick.find((q) => q.entity === currentEntity);
}

export function AppChrome(props: AppChromeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const phone = useNarrow(ref, usePhone());
  if (props.fullscreen) return <FullscreenFrame onExit={props.fullscreen.onExit}>{props.children}</FullscreenFrame>;
  return (
    <div ref={ref} className="k-app-chrome" data-layout={phone ? "phone" : "wide"}>
      {phone ? <PhoneChrome {...props} /> : <WideChrome {...props} />}
    </div>
  );
}

/**
 * A page that asked for the whole screen: a game, a slideshow.
 *
 * No top bar, no tabs, and on Android no status or navigation bar either. The way out belongs to the
 * shell, not the app: a small ✕ that is always there (quiet until touched), Escape, and Android's
 * back gesture. An app — a sealed one included — can ask for the screen; it cannot keep it.
 */
function FullscreenFrame({ onExit, children }: { onExit: () => void; children: ReactNode }) {
  useEffect(() => {
    let live = true;
    let stopBack: (() => void) | null = null;
    void import("@potyro/native").then(async (n) => {
      if (!live) return;
      await n.setImmersive(true);
      // Android's back leaves full screen, not the app. Not done through history: pushing an entry
      // and undoing it fires a back event the router reads as navigation, and the app reopened.
      const stop = await n.onBackButton(onExit);
      if (live) stopBack = stop;
      else stop();
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
      stopBack?.();
      void import("@potyro/native").then((n) => n.setImmersive(false));
    };
  }, [onExit]);
  const { t } = useLingui();
  return (
    <div className="k-fullscreen">
      <button type="button" className="k-fullscreen-exit" aria-label={t`Leave full screen`} title={t`Leave full screen`} onClick={onExit}>
        ✕
      </button>
      <div className="k-fullscreen-page">{children}</div>
    </div>
  );
}

function toolEntry(tool: ChromeTool): MenuEntry {
  return {
    key: tool.key,
    label: tool.label,
    icon: tool.icon,
    hint: tool.hint ?? (tool.active ? tr({ message: "on", comment: "Menu hint: a tool that is switched on (Edit mode)" }) : undefined),
    onSelect: tool.onSelect,
    className: tool.className,
    danger: tool.danger,
    disabled: tool.disabled,
  };
}

function PhoneChrome({ name, icon, scope, status, pages, quick, currentEntity, tools, report, recording, trust, onApps, extras, onBack, showQuick = true, fullBleed, locked, children }: AppChromeProps) {
  const primary = primaryQuick(quick, currentEntity);
  const others = quick.filter((q) => q !== primary);
  const [dial, setDial] = useState(false);
  const { t } = useLingui();

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
  // A menu that hides something new says so on the outside.
  const news = [...tools, ...report].some((tool) => tool.news);

  // How much room the chrome takes at the bottom of the screen, as a custom property the PAGE can
  // read. A view that draws its own bottom bar — the workout tracker's rest timer — otherwise has
  // to guess the tab bar's height, and a wrong guess puts its bar underneath it, where the workout's
  // rest countdown sat unseen. A running timer's chips sit on the tab bar and take more (timer-dock.tsx).
  const tabs = pages.length > 1;
  return (
    <div
      className="k-app-phone"
      data-recording={recording || undefined}
      style={{ ["--k-chrome-bottom" as string]: `max(${tabs ? "calc(4.75rem + var(--k-safe-bottom))" : "var(--k-safe-bottom)"}, var(--k-timer-room, 0px))` }}
    >
      <header className="k-topbar">
        {onBack ? (
          <button type="button" className="k-topbar-btn k-topbar-back" aria-label={t`Back`} onClick={onBack}>
            ‹
          </button>
        ) : onApps ? (
          <button type="button" className="k-topbar-btn" data-tool="apps" aria-label={t`Switch app`} onClick={onApps}>
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
        {menu.length ? (
          <ActionMenu label={news ? t`More — something new` : t({ message: "More", comment: "The app's ⋯ menu of tools" })} title={name} entries={menu} buttonClassName={`k-topbar-btn${news ? " k-has-news" : ""}`} />
        ) : null}
      </header>
      {recording ? (
        <div className="k-recbar" role="status">
          <span className="k-recbar-dot" aria-hidden />
          <Trans comment="Status: a bug report is being recorded">Recording</Trans>
          {report.map((tool) => (
            <button key={tool.key} type="button" className="k-add" onClick={tool.onSelect}>
              {tool.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="k-page" data-full={fullBleed || undefined}>
        {children}
      </div>

      {primary && showQuick ? (
        <>
          {dial ? (
            <>
              <div className="k-fab-scrim" onClick={() => setDial(false)} />
              <div className="k-fab-dial" role="group" aria-label={t`Quick actions`}>
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
          </button>
        </>
      ) : null}

      {/* A tab bar with one tab is a label for where you already are, and it takes a phone-sized
          bite out of the list above it. One page, no bar: the top bar already carries the name. */}
      {tabs ? (
        <nav className="k-nav k-tabbar" aria-label={t`Pages`}>
          {shown.map((p) => (
            <button key={p.id} type="button" className="k-tab" data-active={p.active} onClick={p.onOpen}>
              <span className="k-tab-icon" aria-hidden>
                {p.icon}
              </span>
              <span className="k-tab-label" data-k-page={p.id}>
                {p.title}
              </span>
            </button>
          ))}
          {more.length ? (
            <ActionMenu
              label={t`More pages`}
              trigger={
                <>
                  <span className="k-tab-icon" aria-hidden>
                    ⋯
                  </span>
                  <span className="k-tab-label">
                    <Trans comment="Tab bar: the pages that did not fit">More</Trans>
                  </span>
                </>
              }
              buttonClassName={`k-tab${more.some((p) => p.active) ? " k-tab-more-active" : ""}`}
              entries={more.map((p): MenuEntry => ({ key: p.id, label: p.title, icon: p.icon, hint: p.active ? t({ message: "here", comment: "Menu hint: the page you are on" }) : undefined, onSelect: p.onOpen, className: "k-tab k-tab-in-menu" }))}
            />
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function WideChrome({ name, icon, scope, status, pages, quick, currentEntity, tools, report, recording, trust, onApps, extras, onBack, pageTitle, pageKey, fullBleed, locked, children }: AppChromeProps) {
  const primary = primaryQuick(quick, currentEntity);
  const ordered = primary ? [primary, ...quick.filter((q) => q !== primary)] : quick;
  const { t } = useLingui();
  const toolButton = (tool: ChromeTool) => (
    <button
      key={tool.key}
      data-tool={tool.key}
      type="button"
      className={`k-tool${tool.className ? ` ${tool.className}` : ""}${tool.danger ? " k-danger" : ""}${tool.news ? " k-has-news" : ""}`}
      data-active={tool.active}
      // The same accessible names as the phone's controls, whatever the visible word.
      aria-label={tool.key === "edit-mode" ? t`Edit mode` : tool.key === "apps" ? t`Switch app` : tool.hint ? tool.label : undefined}
      title={tool.hint}
      disabled={tool.disabled}
      onClick={tool.onSelect}
    >
      <span className="k-tool-icon" aria-hidden>
        {tool.icon ?? ""}
      </span>
      <span>{tool.label}</span>
      {tool.hint ? (
        <span className="k-tool-hint" aria-hidden>
          {tool.hint}
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
        <nav className="k-nav k-sidenav" aria-label={t`Pages`}>
          <h5 className="k-sidebar-heading">
            <Trans>Pages</Trans>
          </h5>
          {pages.map((p) => (
            <button key={p.id} type="button" className="k-tab" data-active={p.active} onClick={p.onOpen}>
              <span className="k-tab-icon" aria-hidden>
                {p.icon}
              </span>
              <span className="k-tab-label" data-k-page={p.id}>
                {p.title}
              </span>
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
          </div>
        ) : null}
        {tools.length || report.length || trust || onApps ? (
          <div className="k-tools">
            <h5 className="k-sidebar-heading">
              <Trans comment="Sidebar heading over the shell's tools for the open app">This app</Trans>
            </h5>
            {tools.map(toolButton)}
            {recording ? (
              <div className="k-recbar" role="status">
                <span className="k-recbar-dot" aria-hidden />
                <Trans comment="Status: a bug report is being recorded">Recording</Trans>
              </div>
            ) : null}
            {report.map(toolButton)}
            {trust ? toolButton(trust) : null}
            {onApps ? toolButton({ key: "apps", label: t`All apps`, icon: "⊞", onSelect: onApps }) : null}
          </div>
        ) : null}
      </aside>
      <div className="k-content" data-full={fullBleed || undefined}>
        {pageTitle ? (
          <div className="k-page-head">
            {onBack ? (
              <button type="button" className="k-topbar-btn k-topbar-back" aria-label={t`Back`} onClick={onBack}>
                ‹
              </button>
            ) : null}
            <h2 className="k-page-title" data-k-page={pageKey}>
              {pageTitle}
            </h2>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
