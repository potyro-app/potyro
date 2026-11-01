// The app's stylesheet, as a string the views put in a <style> tag (the way the other example apps
// do). Colours come from the shell's tokens — --accent, --ink, --paper, --surface, --line — so the
// app follows the shell's light and dark looks; the fallbacks are for a bare host.
export const CSS = `
.pn { --pn-accent: var(--accent, #C9772B); --pn-ok: #2c7a4b; max-width: 720px; margin: 0 auto; padding-bottom: 24px; }
.pn, .pn * { box-sizing: border-box; }
.pn button { font: inherit; font-size: 16px; cursor: pointer; }
.pn h1, .pn h2, .pn h3 { margin: 0; }
.pn p { margin: 0; }
.pn-load { padding: 2rem; color: var(--ink-soft, #888); }

.pn-eyebrow { font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft, #777); }
.pn-title { font-family: var(--font-display, Georgia, serif); font-size: 2rem; line-height: 1.1; margin-top: 4px; }
.pn-title-sub { font-size: 1rem; font-family: inherit; color: var(--ink-soft, #777); font-weight: 400; }
.pn-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; color: var(--ink-soft, #777); }
.pn-pill { display: inline-block; padding: .15rem .6rem; border-radius: 999px; font-size: .8rem; font-weight: 600; background: var(--paper, #eee); color: var(--ink, #222); }
.pn-pill[data-tone="rest"] { background: color-mix(in oklch, #5B8DEF 18%, var(--surface, #fff)); }
.pn-pill[data-tone="review"], .pn-pill[data-tone="module"] { background: color-mix(in oklch, var(--pn-accent) 22%, var(--surface, #fff)); }
.pn-note { color: var(--ink-soft, #777); font-size: .9rem; margin-top: 6px; }
.pn-warn { color: #8a4b12; background: color-mix(in oklch, #e4a93c 18%, var(--surface, #fff)); padding: .5rem .7rem; border-radius: 10px; font-size: .9rem; margin-top: 8px; }

.pn-head { padding: 8px 0 14px; border-bottom: 1px solid var(--line, #e6e2d8); margin-bottom: 14px; }
.pn-dots { list-style: none; display: flex; gap: 6px; margin: 12px 0 0; padding: 0; }
.pn-dots li { width: 32px; height: 32px; border-radius: 999px; display: grid; place-items: center; font-size: .8rem; font-weight: 700; color: var(--ink-soft, #888); background: var(--paper, #eee); border: 2px solid transparent; }
.pn-dots li[data-on="true"] { background: var(--pn-ok); color: #fff; }
.pn-dots li[data-rest="true"] { background: color-mix(in oklch, #5B8DEF 30%, var(--surface, #fff)); }
.pn-dots li[data-today="true"] { border-color: var(--pn-accent); }
.pn-dots li[data-future="true"] { opacity: .45; }

.pn-blocks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.pn-block { border: 1px solid var(--line, #e6e2d8); border-radius: 16px; background: var(--surface, #fff); padding: 14px; display: flex; flex-direction: column; gap: 8px; transition: opacity .2s; }
.pn-block[data-running="true"] { border-color: var(--pn-accent); box-shadow: 0 0 0 3px color-mix(in oklch, var(--pn-accent) 25%, transparent); }
.pn-block[data-done="true"] { opacity: .55; }
.pn-block[data-module="true"] { background: color-mix(in oklch, var(--pn-accent) 7%, var(--surface, #fff)); }
.pn-block-head { display: flex; align-items: center; gap: 12px; }
.pn-block-n { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; font-weight: 800; background: var(--paper, #f3efe6); color: var(--ink-soft, #666); flex: 0 0 auto; }
.pn-block-title { flex: 1; min-width: 0; }
.pn-block-title h2 { font-size: 1.1rem; }
.pn-block-tags { font-size: .8rem; color: var(--ink-soft, #777); }
.pn-block-text { line-height: 1.45; }
.pn-check { flex: 0 0 auto; width: 46px; height: 46px; border-radius: 12px; border: 2px solid var(--line, #ccc); background: var(--surface, #fff); color: transparent; font-size: 1.3rem; font-weight: 900; }
.pn-check[data-on="true"] { background: var(--pn-ok); border-color: var(--pn-ok); color: #fff; }
.pn-links { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: .9rem; }
.pn-links a { color: var(--pn-accent); text-decoration: none; border-bottom: 1px solid color-mix(in oklch, var(--pn-accent) 40%, transparent); }
.pn-timer { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.pn-timer-n { font-variant-numeric: tabular-nums; font-weight: 800; font-size: 1.5rem; min-width: 4.2rem; color: var(--ink, #222); }
.pn-timer-n[data-zero="true"] { color: var(--pn-accent); }

.pn-btn { padding: .7rem 1rem; border-radius: 12px; border: 1px solid var(--line, #ddd); background: var(--paper, #f3efe6); color: var(--ink, #222); font-weight: 600; }
.pn-btn:disabled { opacity: .45; cursor: default; }
.pn-btn[data-on="true"] { background: var(--pn-ok); border-color: var(--pn-ok); color: #fff; }
.pn-btn-primary { background: var(--pn-accent); border-color: var(--pn-accent); color: #1d1206; font-weight: 800; }
.pn-btn-small { padding: .4rem .7rem; font-size: .9rem; border-radius: 9px; }
.pn-btn-quiet { background: transparent; }
.pn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }

.pn-rest { padding: 20px; border-radius: 16px; background: color-mix(in oklch, #5B8DEF 10%, var(--surface, #fff)); border: 1px solid var(--line, #e6e2d8); }
.pn-rest h2 { font-family: var(--font-display, Georgia, serif); font-size: 1.5rem; margin-bottom: 6px; }
.pn-daydone { margin-top: var(--space-4); padding: var(--space-4) var(--space-4) var(--space-4) var(--space-5); border-radius: var(--radius-lg); background: var(--aguada); color: var(--ink); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); animation: pn-rise var(--dur-slow) var(--ease); }
.pn-daydone h2 { font-family: var(--font-display); font-size: var(--text-h2); }
.pn-daydone p { color: var(--ink); margin-top: var(--space-1); }
.pn-daydone .pn-btn { min-height: 44px; padding: 0 var(--space-5); border-radius: var(--radius-pill); }
@keyframes pn-rise { from { opacity: 0; transform: translateY(var(--space-2)); } }
@media (prefers-reduced-motion: reduce) { .pn-daydone { animation: none; } }
.pn-goal { margin-top: 18px; padding: 16px; border-radius: 16px; background: var(--paper, #f3efe6); }
.pn-goal-text { font-family: var(--font-display, Georgia, serif); font-size: 1.25rem; line-height: 1.3; margin-top: 4px; }

.pn-rules { margin: 10px 0 0; padding-left: 1.2rem; color: var(--ink-soft, #666); font-size: .9rem; display: flex; flex-direction: column; gap: 4px; }
.pn-phase { margin-top: 20px; }
.pn-phase h2 { font-family: var(--font-display, Georgia, serif); font-size: 1.5rem; }
.pn-phase-goal { color: var(--ink-soft, #666); margin: 4px 0 10px; }
.pn-weeks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pn-week { border: 1px solid var(--line, #e6e2d8); border-radius: 14px; padding: 12px 14px; background: var(--surface, #fff); }
.pn-week[data-status="done"] { opacity: .7; }
.pn-week[data-status="current"] { border-color: var(--pn-accent); }
.pn-week-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
.pn-week h3 { font-size: 1.05rem; }
.pn-week-n { font-weight: 400; color: var(--ink-soft, #888); font-size: .85rem; }
.pn-week-goal { font-size: .9rem; color: var(--ink-soft, #666); margin-top: 2px; }
.pn-week-blocks { margin-top: 8px; font-size: .9rem; }
.pn-week-blocks summary { cursor: pointer; color: var(--pn-accent); }
.pn-week-blocks ul { padding-left: 1.1rem; margin: 6px 0 0; display: flex; flex-direction: column; gap: 6px; }
.pn-notes { margin: 10px 0 0; padding-left: 1.1rem; color: var(--ink-soft, #666); font-size: .9rem; display: flex; flex-direction: column; gap: 4px; }
.pn-resources { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.pn-resources a { color: var(--pn-accent); font-weight: 600; text-decoration: none; }
.pn-res-kind { display: block; font-size: .8rem; color: var(--ink-soft, #888); }
.pn-resources p { font-size: .9rem; color: var(--ink-soft, #666); }

.pn-card { border: 1px solid var(--line, #e6e2d8); border-radius: 16px; padding: 16px; background: var(--surface, #fff); margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.pn-card[data-tone="module"] { background: color-mix(in oklch, var(--pn-accent) 10%, var(--surface, #fff)); border-color: var(--pn-accent); }
.pn-card h2 { font-family: var(--font-display, Georgia, serif); font-size: 1.4rem; }
.pn-card .pn-btn { align-self: flex-start; }
.pn-module-weeks { padding-left: 1.1rem; margin: 6px 0 0; display: flex; flex-direction: column; gap: 8px; }
.pn-settings { margin: 0; display: flex; flex-direction: column; gap: 12px; }
.pn-settings dt { font-size: .8rem; color: var(--ink-soft, #777); text-transform: uppercase; letter-spacing: .06em; }
.pn-settings dd { margin: 2px 0 0; }
`;
