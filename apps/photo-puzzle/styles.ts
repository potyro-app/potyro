// Photo Puzzle's stylesheet: surfaces, ink, fonts and motion are the shell's tokens, so both screens
// follow light and dark with everything else; the warm pink is the app's accent.
export const STYLES = `
.pp { position: relative; color: var(--ink); font-family: var(--font-ui); padding: var(--space-2) 0 var(--space-6); -webkit-tap-highlight-color: transparent; }
.pp [hidden] { display: none !important; }
.pp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: 0; padding: 0; }
.pp-row { display: flex; gap: var(--space-2); flex-wrap: wrap; }

.pp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 0 1.15rem; border-radius: 999px;
  border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font: 650 0.95rem var(--font-ui); cursor: pointer; white-space: nowrap;
  touch-action: manipulation; transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur) var(--ease), background var(--dur) var(--ease);
}
.pp-btn:hover { box-shadow: var(--shadow); transform: translateY(-1px); }
.pp-btn:active { transform: scale(0.97); }
.pp-btn:focus-visible, .pp-icon:focus-visible, .pp-tool:focus-visible, .pp-card-open:focus-visible { outline: 3px solid color-mix(in oklab, var(--accent) 60%, transparent); outline-offset: 2px; }
.pp-btn.pp-primary { background: var(--accent); color: white; border-color: transparent; box-shadow: 0 10px 26px color-mix(in oklab, var(--accent) 40%, transparent); }
.pp-btn.pp-quiet { background: transparent; border-color: transparent; color: var(--ink-soft); }
.pp-btn.pp-quiet:hover { box-shadow: none; color: var(--ink); text-decoration: underline; transform: none; }
.pp-icon {
  display: inline-grid; place-items: center; width: 44px; height: 44px; flex: none; border-radius: 999px; border: 1px solid var(--line);
  background: var(--surface-raised); color: var(--ink); font: 700 1.3rem/1 var(--font-ui); cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur) var(--ease);
}
.pp-icon:hover { box-shadow: var(--shadow); }
.pp-icon:active { transform: scale(0.94); }

/* ---- Puzzles ---- */
.pp-hero {
  position: relative; overflow: hidden; display: grid; grid-template-columns: 1fr; gap: var(--space-4); align-items: center;
  padding: clamp(1.25rem, 1rem + 2vw, 2.5rem); border-radius: 28px; border: 1px solid var(--line); box-shadow: var(--shadow);
  background:
    radial-gradient(120% 80% at 100% 0%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 60%),
    radial-gradient(90% 70% at 0% 100%, color-mix(in oklab, oklch(75% 0.12 220) 18%, transparent), transparent 60%),
    var(--surface-raised);
}
.pp-hero h2 { margin: 0 0 var(--space-2); font-family: var(--font-display); font-weight: 600; font-size: clamp(1.7rem, 1.3rem + 2vw, 2.6rem); line-height: 1.08; letter-spacing: -0.015em; text-wrap: balance; }
.pp-hero p { margin: 0 0 var(--space-4); color: var(--ink-soft); line-height: 1.5; max-width: 40ch; }
.pp-art { width: min(240px, 62vw); height: auto; justify-self: center; overflow: visible; filter: drop-shadow(0 18px 24px oklch(30% 0.05 20 / 0.25)); }
.pp-art-piece { transform-box: fill-box; transform-origin: center; animation: pp-float 6s ease-in-out infinite; }
.pp-art-1 { animation-delay: -1.5s; } .pp-art-2 { animation-delay: -3s; } .pp-art-3 { animation-delay: -4.5s; }
@keyframes pp-float { 0%, 100% { translate: 0 0; rotate: -2deg; } 50% { translate: 0 -7px; rotate: 2deg; } }
.pp-hero.pp-still .pp-art-piece { animation: none; }
@media (min-width: 760px) { .pp-hero { grid-template-columns: auto 1fr; } .pp-art { width: 230px; } }
.pp-hero-small { grid-template-columns: auto 1fr; padding: var(--space-4); gap: var(--space-4); }
.pp-hero-small .pp-art { width: 92px; }
.pp-hero-small h2 { font-size: clamp(1.2rem, 1.05rem + 0.8vw, 1.55rem); }
.pp-hero-small p { display: none; }
@media (max-width: 520px) { .pp-hero-small { grid-template-columns: 1fr; } .pp-hero-small .pp-art { display: none; } }

.pp-steps { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: 8px; }
@media (min-width: 760px) { .pp-steps { grid-template-columns: repeat(3, 1fr); } }
.pp-steps li { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 18px; background: var(--surface-raised); border: 1px solid var(--line); font-weight: 600; font-size: 0.95rem; }
.pp-step-n { display: grid; place-items: center; flex: none; width: 30px; height: 30px; border-radius: 999px; background: color-mix(in oklab, var(--accent) 16%, var(--surface-raised)); color: var(--accent); font-weight: 800; }
.pp-bests { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: var(--space-4) 0 0; }
.pp-bests-label { font-size: 0.8rem; font-weight: 700; color: var(--ink-soft); margin-right: 4px; }
.pp-chip { padding: 5px 10px; border-radius: 999px; background: var(--surface-raised); border: 1px solid var(--line); font-size: 0.82rem; font-weight: 600; font-variant-numeric: tabular-nums; }

.pp-wall { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4) var(--space-3); margin-top: var(--space-4); }
@media (min-width: 760px) { .pp-wall { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-6) var(--space-4); } }
.pp-card { display: grid; gap: 6px; min-width: 0; animation: pp-in 420ms var(--ease) both; }
@keyframes pp-in { from { opacity: 0; transform: translateY(10px); } }
.pp-card-open { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: pointer; border-radius: 18px; }
.pp-thumb {
  position: relative; aspect-ratio: 3 / 4; border-radius: 18px; overflow: hidden; background: var(--surface-sunken); display: grid; place-items: center;
  box-shadow: 0 1px 2px oklch(20% 0.02 60 / 0.1), 0 12px 28px oklch(20% 0.02 60 / 0.16);
  transition: transform var(--dur-slow) var(--ease), box-shadow var(--dur-slow) var(--ease);
}
.pp-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; animation: pp-fade 400ms var(--ease); }
@keyframes pp-fade { from { opacity: 0; } }
/* A puzzle-piece bite in the corner says what this is. */
.pp-thumb::after {
  content: ""; position: absolute; right: 10px; bottom: 10px; width: 34px; height: 34px; border-radius: 10px;
  background: oklch(100% 0 0 / 0.86) center / 22px no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23e2557a' d='M10 3a2 2 0 0 1 4 0v2h4a1 1 0 0 1 1 1v4h-1a2 2 0 0 0 0 4h1v4a1 1 0 0 1-1 1h-4v-1a2 2 0 0 0-4 0v1H6a1 1 0 0 1-1-1v-4h2a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1h4z'/%3E%3C/svg%3E");
  box-shadow: 0 4px 12px oklch(0% 0 0 / 0.2);
}
.pp-card-open:hover .pp-thumb { transform: translateY(-3px) rotate(-0.6deg); box-shadow: 0 2px 4px oklch(20% 0.02 60 / 0.12), 0 20px 40px oklch(20% 0.02 60 / 0.22); }
.pp-card-open:active .pp-thumb { transform: scale(0.98); }
.pp-thumb-wait { color: var(--ink-faint); font-size: 0.85rem; }
.pp-card-meta { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.pp-card-meta div { display: grid; min-width: 0; }
.pp-card-meta b { font-family: var(--font-display); font-weight: 600; font-size: 1.02rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-card-meta span { font-size: 0.78rem; color: var(--ink-faint); }
.pp-card-meta .pp-from { color: var(--accent); font-weight: 700; }
.pp-more { width: 36px; height: 36px; font-size: 1.1rem; border-color: transparent; background: transparent; }
.pp-card-best, .pp-card-others { margin: 0; font-size: 0.8rem; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.pp-card-gift .pp-thumb { box-shadow: 0 0 0 3px var(--accent), 0 12px 28px color-mix(in oklab, var(--accent) 30%, transparent); }

/* ---- Play ---- */
.pp-play { padding-top: 0; }
.pp-playhead { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
.pp-heading { flex: 1; min-width: 0; }
.pp-title { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 1.2rem; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-sub { margin: 2px 0 0; font-size: 0.8rem; color: var(--ink-soft); }
.pp-meter { display: grid; justify-items: end; gap: 2px; }
.pp-time { font: 750 1.35rem/1 var(--font-ui); font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }
.pp-count { font-size: 0.75rem; color: var(--ink-soft); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pp-stage {
  position: relative; border-radius: 24px; overflow: hidden; border: 1px solid var(--line);
  background:
    radial-gradient(100% 70% at 50% 0%, color-mix(in oklab, var(--accent) 7%, transparent), transparent 70%),
    var(--surface);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.4), var(--shadow);
}
.pp-stage canvas { display: block; touch-action: none; cursor: grab; }
.pp-stage canvas:active { cursor: grabbing; }
.pp-veil { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: var(--space-3); padding: var(--space-6); text-align: center; color: var(--ink-soft); background: var(--surface); }
.pp-veil p { margin: 0; max-width: 30ch; }
.pp-spinner { width: 34px; height: 34px; border-radius: 999px; border: 3px solid var(--line); border-top-color: var(--accent); animation: pp-spin 0.9s linear infinite; }
@keyframes pp-spin { to { transform: rotate(360deg); } }
.pp-tools { display: grid; grid-template-columns: auto auto 1fr 1fr; gap: 8px; margin-top: var(--space-3); }
.pp-tool {
  display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; min-width: 48px; padding: 4px 0.6rem; border-radius: 16px;
  border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font: 650 0.9rem var(--font-ui); cursor: pointer; touch-action: manipulation; user-select: none; -webkit-user-select: none;
  transition: transform var(--dur-fast) var(--ease), background var(--dur) var(--ease);
}
.pp-tool:active { transform: scale(0.96); }
.pp-tool[aria-pressed="true"] { background: color-mix(in oklab, var(--accent) 16%, var(--surface-raised)); border-color: color-mix(in oklab, var(--accent) 45%, var(--line)); }
.pp-tools { grid-template-columns: repeat(4, 1fr); max-width: 32rem; margin-left: auto; margin-right: auto; }
.pp-tool svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.pp-tool span { font-size: 0.74rem; font-weight: 650; white-space: nowrap; }

.pp-play { position: relative; }
.pp-done {
  position: absolute; left: 50%; bottom: calc(var(--space-6) + 8px); transform: translateX(-50%); width: min(calc(100% - 1.5rem), 26rem); z-index: 5;
  display: grid; gap: 8px; padding: var(--space-4); border-radius: 24px; text-align: center;
  background: color-mix(in oklab, var(--surface-raised) 88%, transparent); backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4);
  border: 1px solid var(--line); box-shadow: 0 30px 70px oklch(15% 0.03 20 / 0.35);
  animation: pp-rise 560ms var(--ease) both;
}
@keyframes pp-rise { from { opacity: 0; transform: translate(-50%, 24px) scale(0.98); } }
/* A wide table has room beside the photo: the result sits there, and the photo stays whole. */
@media (min-width: 900px) {
  .pp-done { left: auto; right: 5%; bottom: auto; top: 50%; transform: translateY(-50%); width: min(40%, 26rem); animation-name: pp-rise-side; }
  @keyframes pp-rise-side { from { opacity: 0; transform: translate(24px, -50%) scale(0.98); } }
}
.pp-done-head { display: flex; align-items: baseline; justify-content: center; gap: 12px; flex-wrap: wrap; }
.pp-done h3 { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 1.9rem; line-height: 1; }
.pp-done h3:focus { outline: none; }
.pp-done p { margin: 0; }
.pp-done-time { font: 750 1.25rem var(--font-ui); font-variant-numeric: tabular-nums; }
.pp-done-best { color: var(--accent); font-weight: 700; }
.pp-done-note { font-size: 0.85rem; color: var(--ink-soft); }
.pp-done .pp-row { justify-content: center; }
.pp-done .pp-primary { min-height: 52px; font-size: 1.02rem; }
.pp-done .pp-row { gap: 6px; }
.pp-done .pp-row .pp-btn { min-height: 42px; padding: 0 0.9rem; font-size: 0.88rem; }

@media (prefers-reduced-motion: reduce) {
  .pp-card, .pp-done, .pp-thumb img, .pp-art-piece, .pp-spinner { animation: none; }
  .pp-btn, .pp-thumb, .pp-tool, .pp-icon { transition: none; }
}
`;
