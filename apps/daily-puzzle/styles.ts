// The game's stylesheet. Surfaces, ink, fonts and motion are the shell's tokens, so the board follows
// light and dark with everything else; the gems and the two marks are the game's own colours, chosen
// to read on either paper. Each gem also carries a shape, so no colour has to be told by hue alone.
export const STYLES = `
.dp {
  --dp-cell: min(58px, calc((100vw - 2rem - 4 * 8px) / 5), calc((100dvh - 23rem) / 6.6));
  --dp-gap: 8px;
  --dp-exact: oklch(62% 0.15 150);
  --dp-exact-ink: oklch(99% 0.01 150);
  --dp-present: oklch(78% 0.15 85);
  --dp-present-ink: oklch(25% 0.06 70);
  --dp-absent: color-mix(in oklab, var(--ink) 9%, var(--surface-sunken));
  --dp-glow: color-mix(in oklab, var(--accent) 30%, transparent);
  position: relative;
  color: var(--ink);
  font-family: var(--font-ui);
  padding: var(--space-2) 0 var(--space-6);
  -webkit-tap-highlight-color: transparent;
}
.dp [hidden] { display: none !important; }
.dp.dp-contrast { --dp-exact: oklch(70% 0.17 45); --dp-exact-ink: oklch(20% 0.05 45); --dp-present: oklch(72% 0.11 240); --dp-present-ink: oklch(18% 0.05 240); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .dp { --dp-exact: oklch(64% 0.14 150); --dp-present: oklch(76% 0.14 85); --dp-absent: color-mix(in oklab, var(--ink) 10%, var(--surface-sunken)); }
}
:root[data-theme="dark"] .dp { --dp-exact: oklch(64% 0.14 150); --dp-present: oklch(76% 0.14 85); --dp-absent: color-mix(in oklab, var(--ink) 10%, var(--surface-sunken)); }

.dp-wrap { display: grid; gap: var(--space-4); justify-items: center; }
@media (min-width: 960px) {
  .dp-wrap { grid-template-columns: minmax(360px, 1fr) minmax(320px, 420px); align-items: start; justify-items: stretch; gap: clamp(2rem, 4vw, 4rem); max-width: 1080px; margin: 0 auto; }
  .dp-play { justify-self: center; }
  .dp-side { position: sticky; top: var(--space-4); }
}
.dp-play { display: grid; gap: var(--space-3); justify-items: center; width: 100%; max-width: 30rem; }

/* ---- header ---- */
.dp-head { width: 100%; display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-3); }
.dp-kicker { margin: 0; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-soft); }
.dp-number { margin: 2px 0 0; font-family: var(--font-display); font-weight: 600; font-size: clamp(2rem, 1.6rem + 2vw, 2.8rem); line-height: 1; letter-spacing: -0.02em; display: flex; align-items: baseline; gap: 0.6rem; }
.dp-number small { font-family: var(--font-ui); font-size: 0.85rem; font-weight: 500; letter-spacing: 0; color: var(--ink-soft); }
.dp-tools { display: inline-flex; gap: 6px; align-items: center; }
.dp-flame {
  display: inline-flex; align-items: center; gap: 4px; min-height: 36px; padding: 0 12px; border-radius: 999px;
  background: color-mix(in oklab, var(--accent) 16%, var(--surface-raised)); border: 1px solid var(--accent-line, var(--line));
  font-weight: 700; font-size: 0.9rem; font-variant-numeric: tabular-nums;
}
.dp-flame[data-cold="true"] { background: var(--surface-raised); border-color: var(--line); color: var(--ink-soft); font-weight: 600; }
.dp-icon {
  display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: 999px; border: 1px solid var(--line);
  background: var(--surface-raised); color: var(--ink); font: 700 1.05rem var(--font-ui); cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur) var(--ease);
}
.dp-icon:hover { box-shadow: var(--shadow); transform: translateY(-1px); }
.dp-icon:active { transform: scale(0.94); }
.dp-icon:focus-visible, .dp-btn:focus-visible, .dp-key:focus-visible, .dp-slot:focus-visible { outline: 3px solid color-mix(in oklab, var(--accent) 60%, transparent); outline-offset: 2px; }

.dp-practice-bar { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: 8px 8px 8px 14px; border-radius: 14px; background: color-mix(in oklab, var(--accent) 12%, var(--surface-raised)); border: 1px dashed var(--accent-line, var(--line)); font-size: 0.88rem; }

/* ---- the board ---- */
.dp-board { display: grid; gap: var(--dp-gap); padding: 14px; border-radius: 26px; background: var(--surface-raised); border: 1px solid var(--line); box-shadow: var(--shadow); position: relative; }
.dp-row { display: grid; grid-template-columns: repeat(5, var(--dp-cell)); gap: var(--dp-gap); }
.dp-row.dp-shake { animation: dp-shake 420ms var(--ease); }
@keyframes dp-shake { 0%, 100% { transform: none; } 20% { transform: translateX(-7px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(2px); } }
.dp-cell {
  position: relative; display: grid; place-items: center; width: var(--dp-cell); height: var(--dp-cell); margin: 0; padding: 0;
  border-radius: calc(var(--dp-cell) * 0.28); border: 0; background: color-mix(in oklab, var(--ink) 6%, var(--surface-raised));
  box-shadow: inset 0 2px 5px oklch(20% 0.02 60 / 0.07), inset 0 0 0 1px var(--line);
  transform-style: preserve-3d; color: inherit; font: inherit;
}
.dp-row[data-now="true"] .dp-cell { box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--ink) 28%, var(--line)), inset 0 2px 5px oklch(20% 0.02 60 / 0.06); cursor: pointer; }
.dp-row[data-now="true"] .dp-cell[aria-pressed="true"] { box-shadow: inset 0 0 0 2.5px var(--ink), 0 0 0 4px color-mix(in oklab, var(--ink) 14%, transparent); }
.dp-cell[data-mark="exact"] { background: var(--dp-exact); box-shadow: inset 0 -3px 0 oklch(0% 0 0 / 0.14); }
.dp-cell[data-mark="present"] { background: var(--dp-present); box-shadow: inset 0 -3px 0 oklch(0% 0 0 / 0.12); }
.dp-cell[data-mark="absent"] { background: var(--dp-absent); box-shadow: inset 0 0 0 1px var(--line); }
.dp-cell[data-mark="absent"] .dp-gem { opacity: 0.42; filter: saturate(0.55); transform: scale(0.8); }
.dp-cell[data-mark] .dp-gem { transform: scale(0.86); }
.dp-cell.dp-flip { animation: dp-flip 520ms cubic-bezier(0.45, 0, 0.3, 1) both; }
@keyframes dp-flip { 0% { transform: rotateX(0); } 50% { transform: rotateX(90deg); } 100% { transform: rotateX(0); } }
.dp-cell.dp-hop { animation: dp-hop 520ms var(--ease) both; }
@keyframes dp-hop { 0% { transform: none; } 35% { transform: translateY(-14px) scale(1.06); } 70% { transform: translateY(2px) scale(0.98); } 100% { transform: none; } }
.dp-badge {
  position: absolute; right: -5px; top: -5px; width: 20px; height: 20px; border-radius: 999px; display: grid; place-items: center;
  font: 800 11px/1 var(--font-ui); box-shadow: 0 0 0 2px var(--surface-raised);
}
.dp-cell[data-mark="exact"] .dp-badge { background: var(--dp-exact-ink); color: var(--dp-exact); }
.dp-cell[data-mark="present"] .dp-badge { background: var(--dp-exact-ink); color: var(--dp-present-ink); font-size: 12px; }

/* A gem: the colour, a highlight, a little depth, and its shape. */
.dp-gem {
  position: relative; width: 74%; aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center;
  background:
    radial-gradient(circle at 32% 26%, oklch(100% 0 0 / 0.62), oklch(100% 0 0 / 0) 34%),
    radial-gradient(circle at 70% 84%, oklch(0% 0 0 / 0.28), oklch(0% 0 0 / 0) 58%),
    var(--gem);
  box-shadow: 0 2px 0 color-mix(in oklab, var(--gem) 62%, black), 0 7px 14px color-mix(in oklab, var(--gem) 34%, transparent), inset 0 0 0 1px oklch(100% 0 0 / 0.16);
  transition: transform var(--dur-slow) var(--ease), opacity var(--dur-slow) var(--ease), filter var(--dur-slow) var(--ease);
}
.dp-gem svg { width: 40%; height: 40%; fill: oklch(100% 0 0 / 0.88); filter: drop-shadow(0 1px 0 oklch(0% 0 0 / 0.25)); }
.dp-gem.dp-pop { animation: dp-pop 260ms var(--ease); }
@keyframes dp-pop { 0% { transform: scale(0.4); } 70% { transform: scale(1.12); } 100% { transform: scale(1); } }

.dp-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.dp-toastline { min-height: 1.4em; margin: 0; font-size: 0.92rem; color: var(--ink-soft); text-align: center; }

/* ---- the palette ---- */
.dp-pad { width: 100%; display: grid; gap: 8px; }
.dp-keys { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.dp-key {
  position: relative; display: grid; place-items: center; min-height: 52px; padding: 0; border-radius: 16px; border: 1px solid var(--line);
  background: var(--surface-raised); cursor: pointer; touch-action: manipulation;
  transition: transform var(--dur-fast) var(--ease), background var(--dur) var(--ease), opacity var(--dur) var(--ease);
}
.dp-key .dp-gem { width: 34px; }
.dp-key:hover .dp-gem { transform: translateY(-2px); }
.dp-key:active { transform: scale(0.92); }
.dp-key[data-hint="absent"] { background: var(--surface-sunken); }
.dp-key[data-hint="absent"] .dp-gem { opacity: 0.28; filter: grayscale(0.6); }
.dp-key[data-hint="absent"]::after { content: ""; position: absolute; inset: 22% 18%; background: linear-gradient(to top right, transparent calc(50% - 1.5px), var(--ink-faint) calc(50% - 1.5px), var(--ink-faint) calc(50% + 1.5px), transparent calc(50% + 1.5px)); pointer-events: none; }
.dp-key[data-hint="present"]::before, .dp-key[data-hint="exact"]::before { content: ""; position: absolute; top: 5px; right: 5px; width: 9px; height: 9px; border-radius: 999px; box-shadow: 0 0 0 2px var(--surface-raised); }
.dp-key[data-hint="present"]::before { background: var(--dp-present); }
.dp-key[data-hint="exact"]::before { background: var(--dp-exact); }
.dp-actions { display: grid; grid-template-columns: 1fr 2fr; gap: 8px; }

.dp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 50px; padding: 0 1.1rem; border-radius: 16px;
  border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font: 700 0.98rem var(--font-ui); cursor: pointer;
  touch-action: manipulation; transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur) var(--ease), background var(--dur) var(--ease);
}
.dp-btn:hover { box-shadow: var(--shadow); }
.dp-btn:active { transform: scale(0.97); }
.dp-btn[disabled] { opacity: 0.45; pointer-events: none; }
.dp-btn.dp-primary.dp-wait { opacity: 0.55; box-shadow: none; }
.dp-btn.dp-primary { background: var(--ink); color: var(--surface); border-color: transparent; box-shadow: 0 10px 24px oklch(20% 0.02 60 / 0.22); }
.dp-btn.dp-share { background: var(--dp-exact); color: var(--dp-exact-ink); border-color: transparent; box-shadow: 0 12px 28px color-mix(in oklab, var(--dp-exact) 40%, transparent); font-size: 1.05rem; min-height: 56px; }
.dp-btn.dp-quiet { background: transparent; border-color: transparent; color: var(--ink-soft); min-height: 44px; font-weight: 600; }
.dp-btn.dp-quiet:hover { color: var(--ink); box-shadow: none; text-decoration: underline; }

/* ---- the result ---- */
.dp-done { width: 100%; display: grid; gap: var(--space-3); padding: var(--space-4); border-radius: 24px; background: var(--surface-raised); border: 1px solid var(--line); box-shadow: var(--shadow); animation: dp-rise 520ms var(--ease) both; }
@keyframes dp-rise { from { opacity: 0; transform: translateY(18px); } }
.dp-done h3:focus { outline: none; }
.dp-done h3 { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: clamp(1.5rem, 1.3rem + 1vw, 1.9rem); line-height: 1.1; letter-spacing: -0.01em; }
.dp-done .dp-sub { margin: -4px 0 0; color: var(--ink-soft); font-size: 0.95rem; }
.dp-answer { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.88rem; color: var(--ink-soft); }
.dp-answer .dp-gems { display: inline-flex; gap: 6px; }
.dp-answer .dp-gem { width: 30px; }
.dp-grid-preview { margin: 0; padding: 12px 14px; border-radius: 16px; background: var(--surface-sunken); font: 1.05rem/1.25 var(--font-ui); white-space: pre; letter-spacing: 1px; text-align: center; }
.dp-next { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding-top: var(--space-2); border-top: 1px dashed var(--line); font-size: 0.85rem; color: var(--ink-soft); }
.dp-next b { font: 700 1.25rem var(--font-ui); font-variant-numeric: tabular-nums; color: var(--ink); letter-spacing: 0.02em; }

/* ---- stats ---- */
.dp-side { display: grid; gap: var(--space-4); width: 100%; }
.dp-card { padding: var(--space-4); border-radius: 24px; background: var(--surface-raised); border: 1px solid var(--line); box-shadow: var(--shadow); display: grid; gap: var(--space-3); }
.dp-card h3 { margin: 0; font-family: var(--font-display); font-size: 1.2rem; font-weight: 600; }
.dp-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin: 0; }
.dp-stats div { display: grid; justify-items: center; gap: 2px; padding: 10px 4px; border-radius: 14px; background: var(--surface-sunken); }
.dp-stats dd { margin: 0; font: 700 1.55rem/1 var(--font-ui); font-variant-numeric: tabular-nums; }
.dp-stats dt { font-size: 0.7rem; color: var(--ink-soft); text-align: center; line-height: 1.2; }
.dp-spread { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
.dp-spread li { display: grid; grid-template-columns: 1.2rem 1fr; align-items: center; gap: 8px; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
.dp-spread .dp-bar { height: 24px; min-width: 28px; border-radius: 8px; background: color-mix(in oklab, var(--ink) 14%, var(--surface-sunken)); display: flex; align-items: center; justify-content: flex-end; padding: 0 8px; font-weight: 700; font-size: 0.8rem; transform-origin: left; animation: dp-grow 700ms var(--ease) both; }
.dp-spread li[data-today="true"] .dp-bar { background: var(--dp-exact); color: var(--dp-exact-ink); }
@keyframes dp-grow { from { transform: scaleX(0.1); } }
.dp-howto { color: var(--ink-soft); font-size: 0.92rem; line-height: 1.5; margin: 0; }
.dp-example { display: grid; grid-template-columns: repeat(5, 36px); gap: 6px; }
.dp-example .dp-cell { --dp-cell: 36px; border-radius: 10px; }
.dp-example .dp-badge { width: 15px; height: 15px; font-size: 9px; right: -4px; top: -4px; }
.dp-legend { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; font-size: 0.9rem; }
.dp-legend li { display: flex; align-items: center; gap: 10px; }
.dp-legend .dp-cell { --dp-cell: 36px; border-radius: 11px; flex: none; }
.dp-legend .dp-badge { width: 16px; height: 16px; font-size: 9px; right: -4px; top: -4px; }
.dp-past { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.dp-past li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border-radius: 12px; background: var(--surface-sunken); font-size: 0.88rem; }
.dp-past li span:last-child { font-size: 0.7rem; letter-spacing: 1px; white-space: pre; line-height: 1.15; text-align: right; }
.dp-empty { color: var(--ink-soft); font-size: 0.92rem; margin: 0; }

/* ---- help dialog ---- */
.dp-dialog { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: var(--space-4); background: var(--scrim); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: dp-fade var(--dur) var(--ease); }
@keyframes dp-fade { from { opacity: 0; } }
.dp-dialog-card { width: min(440px, 100%); max-height: calc(100dvh - 2rem); overflow: auto; display: grid; gap: var(--space-4); padding: var(--space-6); border-radius: 26px; background: var(--surface-raised); box-shadow: 0 30px 80px oklch(10% 0.02 60 / 0.4); animation: dp-rise 420ms var(--ease) both; }
.dp-dialog-card h2 { margin: 0; font-family: var(--font-display); font-size: 1.6rem; line-height: 1.1; }
.dp-switch { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font-size: 0.92rem; }
.dp-switch input {
  appearance: none; -webkit-appearance: none; flex: none; position: relative; width: 50px; height: 30px; margin: 0; border-radius: 999px; cursor: pointer;
  background: color-mix(in oklab, var(--ink) 18%, var(--surface-sunken)); transition: background var(--dur) var(--ease);
}
.dp-switch input::after { content: ""; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 999px; background: var(--surface-raised); box-shadow: 0 1px 3px oklch(0% 0 0 / 0.3); transition: transform var(--dur) var(--ease); }
.dp-switch input:checked { background: var(--dp-exact); }
.dp-switch input:checked::after { transform: translateX(20px); }
.dp-switch input:focus-visible { outline: 3px solid color-mix(in oklab, var(--ink) 40%, transparent); outline-offset: 2px; }

/* ---- the burst on a win ---- */
.dp-burst { position: absolute; left: 50%; top: 45%; width: 0; height: 0; pointer-events: none; z-index: 5; }
.dp-burst .dp-gem { position: absolute; width: 16px; left: -8px; top: -8px; }

@media (max-width: 380px) { .dp-board { padding: 10px; border-radius: 22px; } .dp-key { min-height: 48px; } }
@media (prefers-reduced-motion: reduce) {
  .dp-row.dp-shake, .dp-cell.dp-flip, .dp-cell.dp-hop, .dp-gem.dp-pop, .dp-done, .dp-spread .dp-bar, .dp-dialog, .dp-dialog-card { animation: none; }
  .dp-gem, .dp-key, .dp-btn, .dp-icon { transition: none; }
}
`;
