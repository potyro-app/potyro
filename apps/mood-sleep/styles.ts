// The Patterns screen's stylesheet. Every colour and font comes from the shell's tokens, so the page
// follows light and dark with the rest of the app; the two series colours are set per theme by the
// view (`--ms-sleep`, `--ms-mood`) because the chart has to know them too.
export const STYLES = `
.ms {
  --ms-sleep: var(--accent);
  --ms-mood: #e8833a;
  display: grid;
  gap: var(--space-4);
  padding: var(--space-2) 0 var(--space-6);
  color: var(--ink);
  font-family: var(--font-ui);
}
@media (min-width: 960px) {
  .ms { grid-template-columns: minmax(300px, 5fr) 7fr; align-items: start; gap: var(--space-6); }
  .ms-hero { grid-row: span 2; position: sticky; top: var(--space-4); }
}

/* The hero: a night-sky card with the one sentence worth reading. */
.ms-hero {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-lg);
  padding: clamp(1.25rem, 1rem + 2vw, 2.25rem);
  background:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, var(--ms-sleep) 26%, transparent), transparent 62%),
    radial-gradient(90% 70% at 0% 100%, color-mix(in oklab, var(--ms-mood) 18%, transparent), transparent 60%),
    var(--surface-raised);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
}
.ms-moon {
  position: absolute;
  right: -28px;
  top: -28px;
  width: 132px;
  height: 132px;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 38%, color-mix(in oklab, var(--ms-sleep) 30%, var(--surface)), color-mix(in oklab, var(--ms-sleep) 8%, var(--surface)) 70%);
  box-shadow: inset -18px -10px 0 color-mix(in oklab, var(--ms-sleep) 22%, var(--surface-raised));
  opacity: 0.85;
  pointer-events: none;
}
.ms-kicker {
  position: relative;
  margin: 0 0 var(--space-3);
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-soft);
  font-weight: 600;
}
.ms-insight {
  position: relative;
  margin: 0;
  font-family: var(--font-display);
  font-weight: 500;
  font-size: clamp(1.45rem, 1.1rem + 1.6vw, 2.15rem);
  line-height: 1.22;
  letter-spacing: -0.01em;
  text-wrap: balance;
  max-width: 22ch;
}
.ms-insight b, .ms-also b { font-weight: 700; white-space: nowrap; }
.ms-insight b[data-series="sleep"], .ms-also b[data-series="sleep"] { color: var(--ms-sleep); }
.ms-insight b[data-series="mood"], .ms-also b[data-series="mood"] { color: var(--ms-mood); }
.ms-also {
  position: relative;
  margin: var(--space-4) 0 0;
  padding-top: var(--space-3);
  border-top: 1px dashed var(--line);
  color: var(--ink-soft);
  font-size: 0.95rem;
  line-height: 1.45;
  max-width: 40ch;
}
.ms-stats {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: var(--space-6) 0 0;
}
.ms-stats div { min-width: 0; }
.ms-stats dt { font-size: 0.72rem; color: var(--ink-soft); letter-spacing: 0.02em; }
.ms-stats dd {
  margin: 2px 0 0;
  font-family: var(--font-display);
  font-size: clamp(1.5rem, 1.2rem + 1vw, 2rem);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.ms-stats dd small { font-family: var(--font-ui); font-size: 0.8rem; color: var(--ink-soft); margin-left: 2px; }
.ms-log {
  position: relative;
  margin-top: var(--space-6);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 1.1rem;
  border-radius: 999px;
  border: 0;
  background: var(--ms-sleep);
  color: white;
  font: 600 0.95rem var(--font-ui);
  cursor: pointer;
  box-shadow: 0 6px 18px color-mix(in oklab, var(--ms-sleep) 40%, transparent);
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur) var(--ease);
}
.ms-log:hover { transform: translateY(-1px); box-shadow: 0 10px 24px color-mix(in oklab, var(--ms-sleep) 45%, transparent); }
.ms-log:active { transform: translateY(1px) scale(0.98); }
.ms-log:focus-visible { outline: 3px solid color-mix(in oklab, var(--ms-sleep) 50%, transparent); outline-offset: 3px; }

/* Chart cards */
.ms-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-4) var(--space-3);
  min-width: 0;
}
.ms-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-3); }
.ms-card h3 { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 1.15rem; }
.ms-card .ms-sub { margin: 2px 0 0; color: var(--ink-soft); font-size: 0.82rem; }
.ms-legend { display: flex; gap: var(--space-4); margin: 0; padding: 0; list-style: none; font-size: 0.82rem; color: var(--ink-soft); }
.ms-legend li { display: inline-flex; align-items: center; gap: 6px; }
.ms-legend i { width: 18px; height: 4px; border-radius: 2px; display: inline-block; }
.ms-legend i.sleep { background: var(--ms-sleep); }
.ms-legend i.mood { background: var(--ms-mood); height: 4px; box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px var(--ms-mood); width: 8px; border-radius: 50%; }
.ms-plot { position: relative; height: 240px; }
@media (min-width: 700px) { .ms-plot { height: 300px; } }
.ms-scatter .ms-plot { height: 260px; }
@media (min-width: 700px) { .ms-scatter .ms-plot { height: 320px; } }
.ms-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 var(--space-3); }
.ms-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface-raised);
  color: var(--ink);
  font: 500 0.82rem var(--font-ui);
  cursor: pointer;
  transition: opacity var(--dur) var(--ease), background var(--dur) var(--ease), transform var(--dur-fast) var(--ease);
}
.ms-chip::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--chip); }
.ms-chip[aria-pressed="true"] { background: color-mix(in oklab, var(--chip) 14%, var(--surface-raised)); border-color: color-mix(in oklab, var(--chip) 45%, var(--line)); }
.ms-chip[aria-pressed="false"] { opacity: 0.5; }
.ms-chip[aria-pressed="false"]::before { background: transparent; box-shadow: inset 0 0 0 1.5px var(--chip); }
.ms-chip:hover { transform: translateY(-1px); }
.ms-chip:focus-visible { outline: 2px solid var(--chip); outline-offset: 2px; }
.ms-foot { margin: var(--space-2) 0 0; color: var(--ink-faint); font-size: 0.78rem; }
.ms-empty .ms-plot { display: none; }
@media (prefers-reduced-motion: reduce) { .ms-log, .ms-chip { transition: none; } }
`;
