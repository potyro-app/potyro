// Mirror Monsters' stylesheet, in the shell's tokens around a stage that is always night: a camera
// picture reads best on dark, whatever the shell's theme, so the stage is its own deep violet and
// everything around it follows light and dark.
export const STYLES = `
/* The stage starts below whatever the shell lays over the top of the screen — "Camera on" while the
   camera runs (--k-chrome-top, docs/04) — so the sign never sits on the picture. */
.mm { position: relative; color: var(--ink); font-family: var(--font-ui); padding-top: var(--k-chrome-top, 0px); padding-bottom: var(--space-3); --mm-night: oklch(20% 0.06 300); --mm-glow: oklch(72% 0.19 330); }

/* ---- the mirror ---- */
.mm-stage {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: radial-gradient(120% 90% at 50% 30%, oklch(32% 0.1 300), var(--mm-night) 70%);
  box-shadow: 0 20px 50px oklch(15% 0.06 300 / 0.35), inset 0 0 0 1px oklch(100% 0 0 / 0.06);
  isolation: isolate;
  touch-action: manipulation;
}
.mm-stage canvas { display: block; width: 100%; cursor: pointer; }
.mm-flash { position: absolute; inset: 0; background: white; opacity: 0; pointer-events: none; }
.mm-flash.mm-go { animation: mm-flash 420ms var(--ease); }
@keyframes mm-flash { 0% { opacity: 0.85; } 100% { opacity: 0; } }

.mm-card {
  position: absolute;
  left: 50%;
  bottom: var(--space-4);
  transform: translateX(-50%);
  width: min(calc(100% - 2rem), 26rem);
  padding: var(--space-4) var(--space-4) var(--space-4);
  border-radius: 22px;
  background: oklch(16% 0.05 300 / 0.72);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border: 1px solid oklch(100% 0 0 / 0.1);
  color: oklch(97% 0.01 300);
  box-shadow: 0 18px 50px oklch(10% 0.05 300 / 0.5);
  transition: opacity var(--dur-slow) var(--ease), transform var(--dur-slow) var(--ease);
}
.mm-card[hidden] { display: block; opacity: 0; transform: translate(-50%, 16px); pointer-events: none; visibility: hidden; transition: opacity var(--dur-slow) var(--ease), transform var(--dur-slow) var(--ease), visibility 0s linear var(--dur-slow); }
.mm-card h2 { margin: 0 0 6px; font-family: var(--font-display); font-weight: 650; font-size: clamp(1.5rem, 1.25rem + 1.2vw, 2.05rem); line-height: 1.1; letter-spacing: -0.015em; }
.mm-card p { margin: 0 0 var(--space-3); color: oklch(88% 0.03 300); line-height: 1.45; font-size: 0.95rem; }
.mm-card .mm-private { margin: var(--space-3) 0 0; font-size: 0.78rem; color: oklch(80% 0.04 300); }

.mm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  padding: 0 1.25rem;
  border-radius: 999px;
  border: 0;
  background: var(--mm-glow);
  color: oklch(18% 0.05 330);
  font: 700 1rem var(--font-ui);
  cursor: pointer;
  box-shadow: 0 10px 28px oklch(65% 0.2 330 / 0.45);
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur) var(--ease), filter var(--dur) var(--ease);
}
.mm-btn:hover { transform: translateY(-1px); filter: brightness(1.06); }
.mm-btn:active { transform: translateY(1px) scale(0.98); }
.mm-btn:focus-visible { outline: 3px solid oklch(95% 0.05 330); outline-offset: 3px; }

/* ---- the dock: monsters to pick, the shutter, the flip ---- */
.mm-dock { display: grid; gap: var(--space-3); margin-top: var(--space-3); }
.mm-modes { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 6px; scroll-snap-type: x proximity; scrollbar-width: none; }
.mm-modes::-webkit-scrollbar { display: none; }
.mm-modes button {
  flex: 0 0 auto;
  scroll-snap-align: center;
  display: grid;
  justify-items: center;
  gap: 2px;
  min-width: 4.6rem;
  padding: 8px 10px 7px;
  border-radius: 18px;
  border: 1px solid var(--line);
  background: var(--surface-raised);
  color: var(--ink-soft);
  font: 600 0.78rem var(--font-ui);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.mm-modes button .mm-face { font-size: 1.55rem; line-height: 1; transition: transform var(--dur) var(--ease); }
.mm-modes button:hover .mm-face { transform: rotate(-8deg) scale(1.08); }
.mm-modes button[aria-pressed="true"] { background: var(--mm-night); color: oklch(96% 0.02 300); border-color: transparent; box-shadow: inset 0 0 0 2px var(--mm-glow), 0 6px 18px oklch(20% 0.06 300 / 0.35); }
.mm-modes button[aria-pressed="true"] .mm-face { transform: scale(1.12); }
.mm-modes button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.mm-controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; }
.mm-round {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--surface-raised);
  color: var(--ink);
  font-size: 1.3rem;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur) var(--ease);
}
.mm-round:hover { box-shadow: var(--shadow); }
.mm-round:active { transform: scale(0.94); }
.mm-round:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.mm-round[disabled], .mm-shutter[disabled] { opacity: 0.4; pointer-events: none; }
.mm-controls .mm-left { justify-self: start; }
.mm-controls .mm-right { justify-self: end; }
.mm-shutter {
  width: 74px;
  height: 74px;
  border-radius: 50%;
  border: 5px solid var(--surface-raised);
  background: var(--mm-glow);
  box-shadow: 0 0 0 2px var(--mm-glow), 0 12px 30px oklch(65% 0.2 330 / 0.45);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease);
}
.mm-shutter:active { transform: scale(0.92); }
.mm-shutter:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }

@media (min-width: 900px) {
  .mm-dock { grid-template-columns: 1fr auto; align-items: center; }
  .mm-controls { gap: var(--space-4); grid-template-columns: auto auto auto; }
}

/* ---- the gallery ---- */
.mm-head { margin: 0 0 var(--space-4); color: var(--ink-soft); font-size: 0.9rem; }
.mm-wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: var(--space-3); align-items: start; }
@media (min-width: 900px) { .mm-wall { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-4); } }
.mm-piece { display: block; width: 100%; margin: 0; padding: 0; border: 0; background: none; color: inherit; text-align: left; cursor: zoom-in; font: inherit; }
.mm-piece figure { margin: 0; }
.mm-piece img {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 18px;
  background: var(--mm-night);
  box-shadow: 0 10px 26px oklch(20% 0.05 300 / 0.2);
  transition: transform var(--dur-slow) var(--ease);
}
.mm-piece:nth-child(3n + 1) img { transform: rotate(-1.2deg); }
.mm-piece:nth-child(3n + 2) img { transform: rotate(0.9deg); }
.mm-piece:hover img { transform: translateY(-3px) rotate(0deg) scale(1.02); }
.mm-piece:focus-visible { outline: none; }
.mm-piece:focus-visible img { outline: 3px solid var(--accent); outline-offset: 3px; }
.mm-piece figcaption { display: grid; gap: 2px; padding: 8px 2px 0; min-width: 0; }
.mm-piece figcaption b { font-family: var(--font-display); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mm-piece figcaption span { color: var(--ink-faint); font-size: 0.75rem; white-space: nowrap; }
.mm-empty { padding: var(--space-6) var(--space-4); border: 1.5px dashed var(--line); border-radius: var(--radius-lg); text-align: center; color: var(--ink-soft); }
.mm-empty .mm-big { font-size: 3rem; line-height: 1; margin-bottom: var(--space-2); }
.mm-empty h3 { margin: 0 0 var(--space-2); font-family: var(--font-display); color: var(--ink); font-size: 1.3rem; }
.mm-empty p { margin: 0 0 var(--space-4); }
.mm-plain { min-height: 44px; padding: 0 1rem; border-radius: 999px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font: 600 0.92rem var(--font-ui); cursor: pointer; }
.mm-plain:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.mm-plain.mm-danger { color: var(--danger); }
.mm-plain.mm-share { background: var(--accent); border-color: transparent; color: var(--on-accent); }

.mm-lightbox { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: var(--space-4); background: var(--scrim); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: mm-fade var(--dur) var(--ease); }
@keyframes mm-fade { from { opacity: 0; } }
.mm-lightbox-card { max-width: min(92vw, 640px); max-height: 92vh; display: grid; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-lg); background: var(--surface-raised); box-shadow: 0 30px 80px oklch(10% 0.04 300 / 0.45); }
.mm-lightbox-card img { display: block; max-width: 100%; max-height: calc(92vh - 9rem); margin: 0 auto; border-radius: 16px; }
.mm-lightbox-meta { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; padding: 0 4px 4px; }
.mm-lightbox-meta h3 { margin: 0; font-family: var(--font-display); font-size: 1.2rem; }
.mm-row { display: flex; gap: var(--space-2); flex-wrap: wrap; }

@media (prefers-reduced-motion: reduce) {
  .mm-btn, .mm-card, .mm-modes button, .mm-modes button .mm-face, .mm-piece img { transition: none; }
  .mm-flash.mm-go, .mm-lightbox { animation: none; }
}
`;
