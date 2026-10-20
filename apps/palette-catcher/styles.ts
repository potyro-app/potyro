// Palette Catcher's stylesheet. The look is a paint-chip card from a hardware store: colours as
// full-bleed strips with their name in the display serif and their code in mono, on the shell's
// paper. Every colour that is not the photo's comes from the shell's tokens, so light and dark
// follow the rest of the app; the photo's colours arrive per element as `--c` (the colour) and
// `--ink` (the text that reads on it, worked out in palette.ts to at least 4.5:1).
export const STYLES = `
.pc { position: relative; color: var(--ink); font-family: var(--font-ui); padding: var(--space-2) 0 var(--space-6); }
.pc *, .pc *::before, .pc *::after { box-sizing: border-box; }
.pc [hidden] { display: none !important; }

/* ---- buttons ---- */
.pc-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 44px; padding: 0 1.05rem; border-radius: 999px;
  border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink);
  font: 600 0.92rem var(--font-ui); white-space: nowrap; cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.pc-btn:hover { transform: translateY(-1px); box-shadow: var(--shadow); border-color: color-mix(in oklab, var(--ink) 22%, var(--line)); }
.pc-btn:active { transform: translateY(1px) scale(0.98); }
.pc-btn:focus-visible, .pc-link:focus-visible, .pc-icon:focus-visible { outline: 3px solid color-mix(in oklab, var(--accent) 60%, transparent); outline-offset: 2px; }
.pc-btn.pc-primary { background: var(--accent); border-color: transparent; color: var(--on-accent); box-shadow: 0 8px 22px color-mix(in oklab, var(--accent) 36%, transparent); }
.pc-btn.pc-primary:hover { box-shadow: 0 12px 28px color-mix(in oklab, var(--accent) 44%, transparent); }
.pc-btn[disabled] { opacity: 0.5; pointer-events: none; }
.pc-btn.pc-done { background: var(--ok-tint); color: var(--ok); border-color: var(--ok-line); box-shadow: none; }
.pc-btn .pc-glyph { font-size: 1.05em; line-height: 1; }
.pc-link { border: 0; background: none; padding: 6px 2px; color: var(--ink-soft); font: 500 0.9rem var(--font-ui); text-decoration: underline; text-underline-offset: 4px; text-decoration-color: color-mix(in oklab, var(--ink-soft) 40%, transparent); cursor: pointer; border-radius: 6px; }
.pc-link:hover { color: var(--ink); text-decoration-color: currentColor; }
.pc-icon { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink-soft); font-size: 1rem; cursor: pointer; transition: transform var(--dur-fast) var(--ease), color var(--dur) var(--ease); flex: none; }
.pc-icon:hover { color: var(--ink); transform: rotate(-8deg); }
.pc-row { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }

/* ---- the fan of paint chips (before a photo, and in an empty gallery) ---- */
.pc-fan { position: relative; height: 230px; width: 100%; max-width: 380px; margin: 0 auto; pointer-events: none; }
.pc-fchip {
  position: absolute; left: calc(50% - 34px); bottom: 14px; width: 68px; height: 200px;
  border-radius: 12px; background: var(--c); color: var(--chip-ink);
  transform-origin: 50% 92%; transform: rotate(var(--rot));
  box-shadow: 0 1px 1px oklch(20% 0.02 60 / 0.12), 0 10px 24px oklch(20% 0.02 60 / 0.18);
  display: flex; flex-direction: column; justify-content: flex-start; padding: 10px 0 0;
  transition: background-color 700ms var(--ease) calc(var(--i) * 70ms), color 700ms var(--ease) calc(var(--i) * 70ms);
  animation: pc-fan-open 900ms var(--ease) both; animation-delay: calc(80ms + var(--i) * 55ms);
}
.pc-fchip b { display: block; writing-mode: vertical-rl; transform: rotate(180deg); align-self: center; font: 600 0.72rem var(--font-mono); letter-spacing: 0.06em; opacity: 0.9; margin-top: auto; padding-bottom: 12px; }
.pc-fchip::after { content: ""; position: absolute; left: 50%; bottom: 10px; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: var(--paper); box-shadow: inset 0 1px 2px oklch(20% 0.02 60 / 0.35); }
.pc-fchip b { margin-bottom: 14px; }
@keyframes pc-fan-open { from { transform: rotate(0deg) translateY(26px); opacity: 0; } 60% { opacity: 1; } }
.pc-fan.pc-mini { height: 150px; max-width: 260px; }
.pc-fan.pc-mini .pc-fchip { width: 46px; height: 130px; left: calc(50% - 23px); border-radius: 9px; }
.pc-fan.pc-mini .pc-fchip b { display: none; }

/* ---- the welcome ---- */
.pc-hero {
  position: relative; overflow: hidden;
  display: grid; gap: var(--space-4); align-items: center;
  padding: clamp(1.25rem, 0.8rem + 2.5vw, 3rem);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(120% 80% at 50% 0%, color-mix(in oklab, var(--accent) 12%, transparent), transparent 60%),
    var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
}
.pc-hero-text { max-width: 34rem; }
.pc-hero h2 { margin: 0 0 var(--space-3); font-family: var(--font-display); font-weight: 600; font-size: var(--text-hero); line-height: 1.08; letter-spacing: -0.015em; text-wrap: balance; }
.pc-hero p { margin: 0 0 var(--space-6); color: var(--ink-soft); line-height: 1.5; font-size: 1rem; max-width: 46ch; }
.pc-hero .pc-link { margin-top: var(--space-3); }
@media (min-width: 820px) {
  .pc-hero { grid-template-columns: minmax(280px, 0.9fr) 1.1fr; min-height: 420px; }
  .pc-hero .pc-fan { height: 300px; max-width: 420px; order: 2; }
  .pc-hero .pc-fan .pc-fchip { width: 84px; height: 260px; left: calc(50% - 42px); }
}

/* ---- the workspace: photo and palette ---- */
.pc-work { display: grid; gap: var(--space-4); align-items: start; }
@media (min-width: 900px) { .pc-work { grid-template-columns: minmax(0, 1.25fr) minmax(320px, 1fr); gap: var(--space-6); } }
.pc-photo {
  --maxh: 52vh;
  position: relative; margin: 0 auto; width: min(100%, calc(var(--maxh) * var(--ar, 1.333)));
  aspect-ratio: var(--ar, 1.333);
  border-radius: var(--radius-lg); overflow: hidden; isolation: isolate;
  background: var(--surface-sunken);
  box-shadow: 0 1px 2px oklch(20% 0.02 60 / 0.1), 0 18px 44px oklch(20% 0.02 60 / 0.2);
}
@media (min-width: 900px) { .pc-photo { --maxh: 74vh; position: sticky; top: var(--space-4); } }
.pc-photo canvas, .pc-photo img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pc-scan { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.pc-scan::before {
  content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 38%;
  background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--surface-raised) 55%, transparent), transparent);
  transform: translateX(-110%); opacity: 0;
}
.pc-catching .pc-scan::before { animation: pc-scan 900ms var(--ease) both; }
@keyframes pc-scan { 0% { transform: translateX(-110%); opacity: 1; } 100% { transform: translateX(290%); opacity: 1; } }
.pc-pins { position: absolute; inset: 0; }
.pc-pin {
  position: absolute; width: 30px; height: 30px; margin: -15px 0 0 -15px; padding: 0;
  border-radius: 50%; border: 3px solid white; background: var(--c); cursor: pointer;
  box-shadow: 0 0 0 1px oklch(20% 0.02 60 / 0.25), 0 6px 16px oklch(10% 0.02 60 / 0.35);
  transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
  animation: pc-pop 520ms var(--ease) both; animation-delay: calc(560ms + var(--i) * 70ms);
}
.pc-pin:hover, .pc-pin.pc-on { transform: scale(1.35); box-shadow: 0 0 0 1px oklch(20% 0.02 60 / 0.25), 0 0 0 7px color-mix(in oklab, var(--c) 35%, transparent), 0 8px 18px oklch(10% 0.02 60 / 0.4); z-index: 2; }
@keyframes pc-pop { 0% { transform: scale(0); } 70% { transform: scale(1.18); } 100% { transform: scale(1); } }
.pc-status { position: absolute; left: 50%; bottom: var(--space-3); transform: translateX(-50%); padding: 6px 14px; border-radius: 999px; background: color-mix(in oklab, var(--surface-raised) 82%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font-size: 0.8rem; color: var(--ink-soft); white-space: nowrap; transition: opacity 400ms var(--ease); }
.pc-status.pc-gone { opacity: 0; }

.pc-panel { min-width: 0; display: grid; gap: var(--space-3); }
.pc-head { display: flex; align-items: center; gap: var(--space-2); }
.pc-name { margin: 0; flex: 1; min-width: 0; font-family: var(--font-display); font-weight: 600; font-size: clamp(1.45rem, 1.15rem + 1.3vw, 2.1rem); line-height: 1.12; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.pc-sub { margin: -6px 0 0; color: var(--ink-soft); font-size: 0.86rem; }

/* The palette: one paint-chip card, a strip per colour. */
.pc-chips { list-style: none; margin: 0; padding: 0; border-radius: var(--radius-lg); overflow: hidden; box-shadow: 0 1px 2px oklch(20% 0.02 60 / 0.1), 0 12px 30px oklch(20% 0.02 60 / 0.14); background: var(--surface); }
.pc-chips li { margin: 0; }
.pc-chip {
  position: relative; display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: var(--space-3);
  width: 100%; min-height: 60px; padding: 10px var(--space-4); border: 0; margin: 0;
  background: var(--c); color: var(--ink); text-align: left; cursor: pointer; font: inherit;
  transition: transform var(--dur) var(--ease), filter var(--dur) var(--ease);
  animation: pc-in 520ms var(--ease) both; animation-delay: calc(var(--i) * 55ms);
}
.pc-chip > * { color: var(--chip-ink); }
.pc-chip:hover { filter: brightness(1.04) saturate(1.04); }
.pc-chip:hover .pc-chip-go, .pc-chip:focus-visible .pc-chip-go { opacity: 1; transform: translateX(0); }
.pc-chip:focus-visible { outline: 3px solid var(--chip-ink); outline-offset: -6px; }
.pc-chip-name { font-family: var(--font-display); font-weight: 600; font-size: 1.12rem; line-height: 1.15; }
.pc-chip-meta { display: block; grid-column: 1; font-size: 0.75rem; opacity: 0.82; margin-top: 2px; }
.pc-chip-hex { grid-row: 1 / span 2; grid-column: 2; font: 600 0.95rem var(--font-mono); letter-spacing: 0.04em; display: inline-flex; align-items: center; gap: 8px; }
.pc-chip-go { display: inline-block; opacity: 0; transform: translateX(-4px); transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease); }
@keyframes pc-in { from { opacity: 0; transform: translateX(-16px); } }
@media (min-width: 900px) { .pc-chip { min-height: 68px; } }

.pc-count { display: inline-flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; color: var(--ink-soft); font-size: 0.85rem; }
.pc-seg { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--surface-sunken); border: 1px solid var(--line); }
.pc-seg button { min-width: 44px; min-height: 38px; padding: 0 0.6rem; border: 0; border-radius: 999px; background: transparent; color: var(--ink-soft); font: 600 0.9rem var(--font-ui); font-variant-numeric: tabular-nums; cursor: pointer; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
.pc-seg button[aria-pressed="true"] { background: var(--surface-raised); color: var(--ink); box-shadow: 0 1px 3px oklch(20% 0.02 60 / 0.18); }
.pc-seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.pc-actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); padding-top: var(--space-1); }
.pc-actions .pc-btn.pc-primary { grid-column: 1 / -1; min-height: 50px; font-size: 1rem; }
.pc-box-side .pc-actions { grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr)); }
.pc-box-side .pc-actions .pc-btn.pc-primary { min-height: 44px; font-size: 0.92rem; }

/* ---- one colour, up close ---- */
.pc-scrim { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: var(--space-4); background: var(--scrim); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: pc-fade var(--dur) var(--ease); }
@keyframes pc-fade { from { opacity: 0; } }
.pc-sheet {
  width: min(100%, 420px); max-height: calc(100dvh - 2 * var(--space-4)); overflow: auto;
  border-radius: 22px; background: var(--surface-raised); color: var(--ink);
  box-shadow: 0 30px 80px oklch(10% 0.02 60 / 0.4); animation: pc-rise 420ms var(--ease) both;
}
@keyframes pc-rise { from { transform: translateY(28px) scale(0.98); opacity: 0; } }
@media (max-width: 599px) {
  .pc-scrim { place-items: end stretch; padding: 0; }
  .pc-sheet { width: 100%; border-radius: 22px 22px 0 0; padding-bottom: var(--k-safe-bottom, 0px); max-height: 92dvh; }
}
.pc-sheet-top { position: relative; min-height: 190px; padding: var(--space-6) var(--space-4) var(--space-4); background: var(--c); color: var(--chip-ink); display: flex; flex-direction: column; justify-content: flex-end; transition: background-color 360ms var(--ease); }
.pc-sheet-top h3 { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 2rem; line-height: 1.05; }
.pc-sheet-top p { margin: 6px 0 0; font-size: 0.85rem; opacity: 0.85; }
.pc-sheet-nav { position: absolute; top: var(--space-3); right: var(--space-3); display: flex; gap: 6px; }
.pc-sheet-nav button, .pc-sheet-x { width: 40px; height: 40px; border-radius: 50%; border: 1px solid color-mix(in oklab, var(--chip-ink) 35%, transparent); background: color-mix(in oklab, var(--c) 70%, var(--chip-ink) 10%); color: var(--chip-ink); font-size: 1.05rem; cursor: pointer; display: grid; place-items: center; }
.pc-sheet-x { position: absolute; top: var(--space-3); left: var(--space-3); }
.pc-sheet-nav button:focus-visible, .pc-sheet-x:focus-visible { outline: 3px solid var(--chip-ink); outline-offset: 2px; }
.pc-codes { margin: 0; padding: var(--space-2) var(--space-4); display: grid; }
.pc-code { display: grid; grid-template-columns: 4.2rem 1fr auto; align-items: center; gap: var(--space-2); padding: 10px 0; border-bottom: 1px solid var(--line); }
.pc-code:last-child { border-bottom: 0; }
.pc-code dt { font: 600 0.7rem var(--font-ui); letter-spacing: 0.12em; color: var(--ink-faint); }
.pc-code dd { margin: 0; font: 500 0.95rem var(--font-mono); user-select: all; overflow-wrap: anywhere; }
.pc-copy { min-height: 36px; padding: 0 0.85rem; font-size: 0.82rem; }
.pc-contrast { padding: var(--space-3) var(--space-4) var(--space-4); border-top: 1px solid var(--line); background: var(--surface); }
.pc-contrast h4 { margin: 0 0 var(--space-2); font: 600 0.72rem var(--font-ui); letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-faint); }
.pc-pairs { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
.pc-pair { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; background: var(--c); }
.pc-pair b { font-family: var(--font-display); font-size: 1.3rem; line-height: 1; }
.pc-pair span { display: grid; font-size: 0.72rem; line-height: 1.25; }
.pc-pair span strong { font-size: 0.8rem; }
.pc-grade { display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 4px; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.04em; background: color-mix(in oklab, currentColor 16%, transparent); }

/* ---- the gallery ---- */
.pc-gallery-head { margin: 0 0 var(--space-4); color: var(--ink-soft); font-size: 0.9rem; }
.pc-wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: var(--space-4) var(--space-3); align-items: start; }
@media (min-width: 900px) { .pc-wall { grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: var(--space-6) var(--space-4); } }
.pc-card { display: block; width: 100%; padding: 0; margin: 0; border: 0; background: none; color: inherit; text-align: left; cursor: pointer; font: inherit; animation: pc-up 520ms var(--ease) both; animation-delay: calc(min(var(--i), 12) * 45ms); }
@keyframes pc-up { from { opacity: 0; transform: translateY(14px); } }
.pc-card-art { position: relative; border-radius: var(--radius); overflow: hidden; background: var(--surface-sunken); box-shadow: 0 1px 2px oklch(20% 0.02 60 / 0.1), 0 10px 26px oklch(20% 0.02 60 / 0.14); transition: transform var(--dur-slow) var(--ease), box-shadow var(--dur-slow) var(--ease); }
.pc-card-art img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
.pc-card-art .pc-missing { display: grid; place-items: center; aspect-ratio: 4 / 3; padding: var(--space-3); color: var(--ink-faint); font-size: 0.8rem; text-align: center; }
.pc-strip { display: flex; height: 34px; }
.pc-bands { display: flex; aspect-ratio: 4 / 3; width: 100%; }
.pc-bands i { flex: 1; background: var(--c); }
.pc-box-card .pc-bands { border-radius: var(--radius); overflow: hidden; }
.pc-card-art .pc-bands + .pc-strip { display: none; }
.pc-strip i { flex: 1; background: var(--c); transition: flex var(--dur-slow) var(--ease); }
.pc-card:hover .pc-card-art { transform: translateY(-3px); box-shadow: 0 2px 4px oklch(20% 0.02 60 / 0.12), 0 18px 36px oklch(20% 0.02 60 / 0.2); }
.pc-card:hover .pc-strip i:hover { flex: 1.8; }
.pc-card:focus-visible { outline: none; }
.pc-card:focus-visible .pc-card-art { outline: 3px solid var(--accent); outline-offset: 3px; }
.pc-card-cap { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 10px 2px 0; }
.pc-card-cap b { font-family: var(--font-display); font-weight: 600; font-size: 1.02rem; line-height: 1.2; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-card-cap span { color: var(--ink-faint); font-size: 0.75rem; white-space: nowrap; }
.pc-empty { display: grid; justify-items: center; gap: var(--space-2); padding: var(--space-6) var(--space-4) calc(var(--space-6) + var(--space-2)); border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--line); text-align: center; }
.pc-empty h3 { margin: 0; font-family: var(--font-display); font-size: 1.5rem; }
.pc-empty p { margin: 0 0 var(--space-3); color: var(--ink-soft); max-width: 36ch; line-height: 1.45; }

.pc-box { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: var(--space-4); background: var(--scrim); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: pc-fade var(--dur) var(--ease); }
.pc-box-card { width: min(100%, 920px); max-height: calc(100dvh - 2 * var(--space-4)); overflow: auto; display: grid; gap: var(--space-4); padding: var(--space-4); border-radius: 22px; background: var(--surface-raised); box-shadow: 0 30px 80px oklch(10% 0.02 60 / 0.4); animation: pc-rise 420ms var(--ease) both; }
@media (min-width: 760px) { .pc-box-card { grid-template-columns: 1.2fr 1fr; align-items: start; padding: var(--space-6); } }
.pc-box-card img { display: block; width: 100%; max-height: 64vh; object-fit: contain; border-radius: var(--radius); background: var(--surface-sunken); }
.pc-box-side { display: grid; gap: var(--space-3); min-width: 0; }
.pc-box-side .pc-name { font-size: 1.6rem; }
.pc-btn.pc-danger { color: var(--danger); }

@media (prefers-reduced-motion: reduce) {
  .pc *, .pc-scrim, .pc-sheet, .pc-box, .pc-box-card, .pc-fchip, .pc-chip, .pc-pin, .pc-card { animation: none !important; transition: none !important; }
}
`;
