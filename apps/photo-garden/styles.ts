// The Studio's and the Gallery's stylesheet, all in the shell's tokens so both follow light and dark.
export const STYLES = `
.pg { position: relative; color: var(--ink); font-family: var(--font-ui); padding-bottom: var(--space-4); }

/* ---- Studio ---- */
.pg-stage {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--surface-sunken);
  box-shadow: var(--shadow), inset 0 0 0 1px var(--line);
  isolation: isolate;
}
.pg-stage canvas { display: block; touch-action: none; cursor: crosshair; }
.pg-stage.pg-kept::after {
  content: "";
  position: absolute;
  inset: 0;
  background: white;
  opacity: 0;
  pointer-events: none;
  animation: pg-flash 520ms var(--ease);
}
@keyframes pg-flash { 0% { opacity: 0.75; } 100% { opacity: 0; } }

.pg-welcome {
  position: absolute;
  inset: auto var(--space-4) 112px var(--space-4);
  max-width: 30rem;
  margin: 0 auto;
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  background: color-mix(in oklab, var(--surface-raised) 78%, transparent);
  backdrop-filter: blur(14px) saturate(1.3);
  -webkit-backdrop-filter: blur(14px) saturate(1.3);
  border: 1px solid color-mix(in oklab, var(--line) 70%, transparent);
  box-shadow: 0 18px 50px oklch(20% 0.02 60 / 0.22);
  text-align: left;
  transition: opacity var(--dur-slow) var(--ease), transform var(--dur-slow) var(--ease);
}
.pg-welcome[hidden] { display: block; opacity: 0; transform: translateY(16px); pointer-events: none; visibility: hidden; transition: opacity var(--dur-slow) var(--ease), transform var(--dur-slow) var(--ease), visibility 0s linear var(--dur-slow); }
.pg-welcome h2 { margin: 0 0 var(--space-2); font-family: var(--font-display); font-weight: 600; font-size: clamp(1.45rem, 1.2rem + 1.2vw, 2rem); line-height: 1.15; letter-spacing: -0.01em; }
.pg-welcome p { margin: 0 0 var(--space-4); color: var(--ink-soft); line-height: 1.45; font-size: 0.95rem; }
.pg-row { display: flex; gap: var(--space-2); flex-wrap: wrap; }

.pg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 1rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface-raised);
  color: var(--ink);
  font: 600 0.92rem var(--font-ui);
  white-space: nowrap;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.pg-btn:hover { transform: translateY(-1px); box-shadow: var(--shadow); }
.pg-btn:active { transform: translateY(1px) scale(0.98); }
.pg-btn:focus-visible { outline: 3px solid color-mix(in oklab, var(--accent) 55%, transparent); outline-offset: 2px; }
.pg-btn.pg-primary { background: var(--accent); border-color: transparent; color: var(--on-accent); box-shadow: 0 8px 22px color-mix(in oklab, var(--accent) 38%, transparent); }
.pg-btn[disabled] { opacity: 0.45; pointer-events: none; }

/* The floating control bar, over the bottom of the artwork. */
.pg-bar {
  position: absolute;
  left: 50%;
  bottom: var(--space-3);
  transform: translateX(-50%);
  width: min(calc(100% - 1.5rem), 46rem);
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-3);
  padding: 8px 8px 8px 8px;
  border-radius: 22px;
  background: color-mix(in oklab, var(--surface-raised) 80%, transparent);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border: 1px solid color-mix(in oklab, var(--line) 70%, transparent);
  box-shadow: 0 12px 36px oklch(20% 0.02 60 / 0.22);
}
.pg-styles { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--surface-sunken); }
.pg-styles button {
  min-height: 38px;
  padding: 0 0.85rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-soft);
  font: 600 0.85rem var(--font-ui);
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.pg-styles button[aria-pressed="true"] { background: var(--surface-raised); color: var(--ink); box-shadow: 0 1px 3px oklch(20% 0.02 60 / 0.18); }
.pg-styles button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.pg-density { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--ink-soft); font-size: 0.8rem; }
.pg-density input { flex: 1; min-width: 60px; accent-color: var(--accent); height: 28px; }
.pg-actions { display: inline-flex; gap: 6px; }
.pg-actions .pg-btn { min-height: 40px; padding: 0 0.9rem; }
.pg-hint {
  position: absolute;
  top: var(--space-3);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--surface-raised) 72%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: var(--ink-soft);
  font-size: 0.78rem;
  white-space: nowrap;
  pointer-events: none;
  transition: opacity 600ms var(--ease);
}
.pg-hint[hidden] { display: block; opacity: 0; }
/* After Keep this: what was kept, and Share, over the top of the picture for a few seconds. */
.pg-kept-note {
  position: absolute;
  top: var(--space-3);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100% - 1.5rem);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 6px 6px 6px var(--space-4);
  border-radius: 999px;
  background: color-mix(in oklab, var(--surface-raised) 88%, transparent);
  backdrop-filter: blur(14px) saturate(1.3);
  -webkit-backdrop-filter: blur(14px) saturate(1.3);
  border: 1px solid color-mix(in oklab, var(--line) 70%, transparent);
  box-shadow: 0 12px 36px oklch(20% 0.02 60 / 0.22);
  animation: pg-rise var(--dur-slow) var(--ease);
}
.pg-kept-note[hidden] { display: none; }
.pg-kept-note p { margin: 0; min-width: 0; font-size: 0.9rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes pg-rise { from { opacity: 0; transform: translate(-50%, -8px); } }

@media (max-width: 639px) {
  .pg-bar { grid-template-columns: 1fr auto; grid-template-areas: "styles styles" "density actions"; row-gap: 8px; padding: 8px; }
  .pg-styles { grid-area: styles; display: grid; grid-template-columns: repeat(3, 1fr); }
  .pg-styles button { padding: 0 0.7rem; }
  .pg-density { grid-area: density; padding: 0 2px 0 8px; }
  .pg-density span { display: none; }
  .pg-actions { grid-area: actions; }
  .pg-actions .pg-btn .pg-wide { display: none; }
  .pg-welcome { bottom: 136px; padding: var(--space-4); }
}

/* ---- Gallery ---- */
.pg-gallery-head { margin: 0 0 var(--space-4); }
.pg-gallery-head p { margin: 0; color: var(--ink-soft); font-size: 0.9rem; }
.pg-wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-3); align-items: start; }
@media (min-width: 900px) { .pg-wall { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--space-4); } }
.pg-piece {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: zoom-in;
  font: inherit;
}
.pg-piece figure { margin: 0; }
.pg-piece img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--radius);
  background: var(--surface-sunken);
  box-shadow: 0 1px 2px oklch(20% 0.02 60 / 0.1), 0 10px 26px oklch(20% 0.02 60 / 0.14);
  transition: transform var(--dur-slow) var(--ease), box-shadow var(--dur-slow) var(--ease);
}
.pg-piece:hover img { transform: translateY(-3px) rotate(-0.4deg); box-shadow: 0 2px 4px oklch(20% 0.02 60 / 0.12), 0 18px 36px oklch(20% 0.02 60 / 0.2); }
.pg-piece:focus-visible { outline: none; }
.pg-piece:focus-visible img { outline: 3px solid var(--accent); outline-offset: 3px; }
.pg-piece figcaption { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 8px 2px 0; }
.pg-piece figcaption b { font-family: var(--font-display); font-weight: 600; font-size: 1rem; }
.pg-piece figcaption span { color: var(--ink-faint); font-size: 0.75rem; white-space: nowrap; }
.pg-empty { padding: var(--space-6) var(--space-4); border: 1.5px dashed var(--line); border-radius: var(--radius-lg); text-align: center; color: var(--ink-soft); }
.pg-empty h3 { margin: 0 0 var(--space-2); font-family: var(--font-display); color: var(--ink); font-size: 1.3rem; }
.pg-empty p { margin: 0 0 var(--space-4); }

.pg-lightbox {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: var(--scrim);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  animation: pg-fade var(--dur) var(--ease);
}
@keyframes pg-fade { from { opacity: 0; } }
.pg-lightbox-card { max-width: min(92vw, 760px); max-height: 92vh; display: grid; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-lg); background: var(--surface-raised); box-shadow: 0 30px 80px oklch(10% 0.02 60 / 0.4); }
.pg-lightbox-card img { display: block; max-width: 100%; max-height: calc(92vh - 9rem); margin: 0 auto; border-radius: var(--radius); }
.pg-lightbox-meta { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; padding: 0 4px 4px; }
.pg-lightbox-meta h3 { margin: 0; font-family: var(--font-display); font-size: 1.25rem; }
.pg-lightbox-meta p { margin: 2px 0 0; color: var(--ink-soft); font-size: 0.85rem; }
.pg-btn.pg-danger { color: var(--danger); }

@media (prefers-reduced-motion: reduce) {
  .pg-btn, .pg-piece img, .pg-welcome, .pg-hint { transition: none; }
  .pg-stage.pg-kept::after, .pg-lightbox, .pg-kept-note { animation: none; }
}
`;
