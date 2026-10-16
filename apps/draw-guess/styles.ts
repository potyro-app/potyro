// Draw & Guess's stylesheet: a sketchbook on a dotted desk. The paper you draw on is always paper —
// cream, whatever the theme, because the ink colours are chosen for it — and everything around it
// follows the shell's light and dark tokens. Chunky inked outlines with a hard offset shadow, rounded
// type, code tiles like a board game's: a party game, not a form.
export const STYLES = `
.dg {
  --dg-hot: #ff5a3c;
  --dg-on-hot: #22140f;
  --dg-sun: #ffd23f;
  --dg-mint: #3ccf91;
  --dg-sky: #5aa9ff;
  --dg-cream: #fffdf7;
  --dg-cream-ink: #1d1a26;
  --dg-edge: var(--ink);
  --dg-pop: 3px 3px 0 var(--dg-edge);
  --dg-pop-big: 5px 5px 0 var(--dg-edge);
  --dg-card: var(--surface-raised);
  --dg-dot: color-mix(in oklab, var(--ink) 10%, transparent);
  --dg-font: ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Arial Rounded MT Bold", var(--font-ui);
  position: relative;
  min-height: 60vh;
  color: var(--ink);
  font-family: var(--dg-font);
  padding: var(--space-2) 0 var(--space-4);
  background-image: radial-gradient(var(--dg-dot) 1.2px, transparent 1.4px);
  background-size: 18px 18px;
  border-radius: var(--radius-lg);
  /* clip, not hidden: hidden would make this a scroller and stop the lobby's Start from sticking. */
  overflow: clip;
}
.dg *, .dg *::before, .dg *::after { box-sizing: border-box; }
.dg-screen { position: relative; padding: 0 var(--space-3); }
.dg[data-reconnecting]::after {
  content: "";
  position: absolute; inset: 0 0 auto 0; height: 4px;
  background: repeating-linear-gradient(90deg, var(--dg-hot) 0 18px, var(--dg-sun) 18px 36px);
  animation: dg-crawl 900ms linear infinite;
}
@keyframes dg-crawl { to { background-position: 36px 0; } }

/* ---- type, buttons, fields ---- */
.dg-title {
  margin: 0;
  font-family: var(--dg-font);
  font-weight: 900;
  font-size: clamp(2.1rem, 1.4rem + 3.4vw, 3.6rem);
  line-height: 0.95;
  letter-spacing: -0.03em;
  transform: rotate(-2deg);
  transform-origin: left center;
}
.dg-title::after {
  content: "";
  display: block;
  width: 62%;
  height: 0.28em;
  margin-top: 0.08em;
  background: var(--dg-sun);
  border-radius: 999px 40% 999px 30%;
  transform: rotate(1.5deg);
  opacity: 0.9;
}
.dg-label { display: block; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); margin: 0 0 6px; }
.dg-hint { color: var(--ink-soft); font-size: 0.86rem; line-height: 1.35; }
.dg-note { margin: var(--space-3) 0 0; color: var(--ink-soft); font-size: 0.95rem; }
.dg-note:empty { margin: 0; }
.dg-note-bad { color: var(--danger); font-weight: 700; }
.dg-row { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }

.dg-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 48px; padding: 0 1.15rem;
  border: 2px solid var(--dg-edge); border-radius: 14px;
  background: var(--dg-card); color: var(--ink);
  font: 800 1rem var(--dg-font);
  cursor: pointer;
  box-shadow: var(--dg-pop);
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease), filter var(--dur) var(--ease);
  -webkit-tap-highlight-color: transparent;
}
.dg-btn:hover:not(:disabled) { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--dg-edge); }
.dg-btn:active:not(:disabled) { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--dg-edge); }
.dg-btn:focus-visible, .dg-seg-btn:focus-visible, .dg-swatch:focus-visible, .dg-size:focus-visible, .dg-tool:focus-visible, .dg-choice:focus-visible, .dg-sound:focus-visible, .dg-how summary:focus-visible {
  outline: 3px solid var(--dg-sky); outline-offset: 3px;
}
.dg-btn:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
.dg-btn-hot { background: var(--dg-hot); color: var(--dg-on-hot); }
.dg-btn-go { background: var(--dg-mint); color: #0d2b1f; min-height: 56px; font-size: 1.12rem; padding: 0 1.6rem; }
.dg-btn-quiet { background: transparent; box-shadow: none; border-color: color-mix(in oklab, var(--ink) 30%, transparent); }
.dg-btn-quiet:hover:not(:disabled) { box-shadow: none; transform: none; border-color: var(--ink); }
.dg-btn-small { min-height: 38px; padding: 0 0.8rem; font-size: 0.88rem; border-radius: 11px; }

.dg-input {
  width: 100%; min-height: 50px; padding: 0 14px;
  border: 2px solid var(--dg-edge); border-radius: 14px;
  background: var(--surface); color: var(--ink);
  font: 700 1.05rem var(--dg-font);
  box-shadow: inset 0 3px 0 color-mix(in oklab, var(--ink) 7%, transparent);
}
.dg-input::placeholder { color: var(--ink-faint); font-weight: 600; }
.dg-input:focus { outline: none; border-color: var(--dg-sky); box-shadow: 0 0 0 3px color-mix(in oklab, var(--dg-sky) 35%, transparent); }
.dg-code-in { text-transform: uppercase; letter-spacing: 0.12em; font-family: var(--font-mono); font-weight: 800; flex: 1 1 12rem; }

.dg-sound {
  flex: none; width: 40px; height: 40px; border-radius: 50%; padding: 0;
  border: 2px solid color-mix(in oklab, var(--ink) 25%, transparent);
  background: var(--dg-card); font-size: 1.05rem; cursor: pointer;
}
.dg-sound[aria-pressed="true"] { border-color: var(--dg-edge); box-shadow: 2px 2px 0 var(--dg-edge); }

/* ---- start ---- */
.dg-start { display: grid; gap: var(--space-4); max-width: 920px; margin: 0 auto; padding-top: var(--space-4); }
.dg-hero { display: grid; grid-template-columns: 1fr auto; gap: var(--space-3); align-items: center; }
.dg-hero-text { min-width: 0; }
.dg-tagline { margin: var(--space-3) 0 0; font-size: 1.05rem; font-weight: 600; color: var(--ink-soft); max-width: 26rem; line-height: 1.35; }
.dg-hero-art {
  width: clamp(120px, 34vw, 240px); aspect-ratio: 1;
  background: var(--dg-cream); border: 2px solid var(--dg-edge); border-radius: 6px;
  box-shadow: var(--dg-pop); transform: rotate(3deg); overflow: hidden;
}
.dg-hero-art canvas { display: block; }
.dg-start-card {
  background: var(--dg-card); border: 2px solid var(--dg-edge); border-radius: 22px;
  padding: var(--space-4); box-shadow: var(--dg-pop-big);
  display: grid; gap: var(--space-2);
}
.dg-new { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; margin-top: var(--space-2); }
.dg-new .dg-btn { min-height: 56px; font-size: 1.12rem; padding: 0 1.4rem; }
.dg-new .dg-hint { flex: 1 1 10rem; }
.dg-or { height: 2px; margin: var(--space-3) 0 var(--space-2); background: repeating-linear-gradient(90deg, color-mix(in oklab, var(--ink) 22%, transparent) 0 8px, transparent 8px 14px); }
.dg-join .dg-row { flex-wrap: nowrap; }
.dg-how {
  border: 2px dashed color-mix(in oklab, var(--ink) 28%, transparent); border-radius: 18px;
  padding: var(--space-3) var(--space-4); background: color-mix(in oklab, var(--dg-card) 70%, transparent);
}
.dg-how summary { cursor: pointer; font-weight: 800; list-style: none; display: flex; align-items: center; gap: 8px; }
.dg-how summary::before { content: "👋"; }
.dg-how summary::after { content: "＋"; margin-left: auto; font-weight: 900; }
.dg-how[open] summary::after { content: "－"; }
.dg-how ol { margin: var(--space-3) 0 0; padding-left: 1.3rem; display: grid; gap: var(--space-2); line-height: 1.45; color: var(--ink-soft); }
.dg-how li::marker { font-weight: 900; color: var(--dg-hot); }

/* ---- waiting ---- */
.dg-wait { display: grid; justify-items: center; gap: var(--space-3); text-align: center; padding: 14vh var(--space-4) var(--space-6); }
.dg-wait h2 { margin: 0; font-weight: 900; font-size: 1.6rem; }
.dg-wait p { margin: 0; max-width: 26rem; color: var(--ink-soft); line-height: 1.45; }
.dg-big { font-size: 3.4rem; }
.dg-pencil { font-size: 2.6rem; animation: dg-scribble 900ms var(--ease) infinite alternate; }
@keyframes dg-scribble { from { transform: rotate(-18deg) translateX(-10px); } to { transform: rotate(10deg) translateX(10px); } }
.dg-code-small { font-family: var(--font-mono); font-weight: 800; letter-spacing: 0.1em; }

/* ---- lobby ---- */
.dg-lobby { display: grid; gap: var(--space-4); max-width: 980px; margin: 0 auto; padding-top: var(--space-2); }
.dg-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.dg-head-acts { display: flex; gap: var(--space-2); align-items: center; }
.dg-head h2 { margin: 0; font-weight: 900; font-size: clamp(1.4rem, 1.1rem + 1.4vw, 2rem); letter-spacing: -0.02em; }
.dg-code-card {
  background: var(--dg-sun); color: var(--dg-cream-ink);
  border: 2px solid var(--dg-edge); border-radius: 22px; padding: var(--space-4);
  box-shadow: var(--dg-pop-big); display: grid; gap: var(--space-3); justify-items: start;
}
.dg-code-card .dg-label, .dg-code-card .dg-hint { color: color-mix(in oklab, var(--dg-cream-ink) 72%, transparent); margin: 0; }
.dg-tiles { display: grid; grid-template-columns: repeat(4, 1fr) 0.45fr repeat(4, 1fr) 0.45fr repeat(4, 1fr); gap: 4px; width: 100%; max-width: 34rem; }
.dg-tile {
  --dg-i: 0;
  display: grid; place-items: center;
  width: 100%; aspect-ratio: 0.86; min-width: 0;
  background: var(--dg-cream); color: var(--dg-cream-ink);
  border: 2px solid var(--dg-cream-ink); border-radius: 8px;
  font: 900 clamp(1rem, 0.7rem + 1.4vw, 1.7rem) var(--font-mono);
  box-shadow: 0 3px 0 var(--dg-cream-ink);
  transform: rotate(var(--dg-r, 0deg));
  animation: dg-drop 420ms var(--ease) both; animation-delay: calc(var(--dg-i) * 28ms);
}
.dg-tile-gap { width: 100%; }
.dg-still .dg-tile { animation: none; }
@keyframes dg-drop { from { opacity: 0; transform: translateY(-14px) rotate(-12deg); } }
.dg-lobby-side { display: grid; gap: var(--space-3); align-content: start; }
.dg-lobby-code { display: grid; gap: var(--space-4); align-content: start; }
.dg-people { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-2); }
.dg-person {
  display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 6px 10px;
  background: var(--dg-card); border: 2px solid var(--dg-edge); border-radius: 16px; box-shadow: var(--dg-pop);
  min-width: 0;
}
.dg-person-text { display: grid; gap: 2px; min-width: 0; }
.dg-person-name { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.dg-person-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.dg-person-empty { border-style: dashed; box-shadow: none; opacity: 0.55; background: transparent; }
.dg-pop { animation: dg-pop 380ms var(--ease) both; }
@keyframes dg-pop { from { opacity: 0; transform: scale(0.85); } }
.dg-avatar {
  --dg-hue: 20;
  flex: none; display: grid; place-items: center;
  width: 34px; height: 34px; border-radius: 50%;
  background: hsl(var(--dg-hue) 80% 66%); color: hsl(var(--dg-hue) 60% 16%);
  border: 2px solid var(--dg-edge); font: 900 0.95rem var(--dg-font);
}
.dg-avatar-empty { background: transparent; color: var(--ink-faint); border-style: dashed; }
.dg-avatar-big { width: 64px; height: 64px; font-size: 1.6rem; }
.dg-tag { font-size: 0.72rem; font-weight: 800; padding: 2px 7px; border-radius: 999px; background: var(--surface-sunken); color: var(--ink-soft); white-space: nowrap; }
.dg-tag-host { background: color-mix(in oklab, var(--dg-sun) 45%, var(--surface)); color: var(--ink); }
.dg-settings {
  display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  padding: var(--space-3); border-radius: 18px; background: color-mix(in oklab, var(--dg-card) 75%, transparent);
  border: 2px solid color-mix(in oklab, var(--ink) 16%, transparent);
}
.dg-setting { min-width: 0; }
.dg-seg { display: flex; border: 2px solid var(--dg-edge); border-radius: 12px; overflow: hidden; background: var(--surface); }
.dg-seg-btn { flex: 1; min-height: 40px; border: 0; border-left: 2px solid var(--dg-edge); background: transparent; color: var(--ink); font: 800 0.98rem var(--dg-font); cursor: pointer; }
.dg-seg-btn:first-child { border-left: 0; }
.dg-seg-btn[aria-pressed="true"] { background: var(--dg-ink-bg, var(--ink)); color: var(--paper); }
.dg-seg-btn:disabled { cursor: default; }
.dg-seg-btn:disabled:not([aria-pressed="true"]) { color: var(--ink-faint); }
.dg-select { width: 100%; min-height: 44px; border: 2px solid var(--dg-edge); border-radius: 12px; background: var(--surface); color: var(--ink); font: 800 1rem var(--dg-font); padding: 0 10px; }
.dg-lobby-foot { display: flex; justify-content: flex-start; position: sticky; bottom: calc(var(--k-chrome-bottom, 0px) + var(--space-3)); z-index: 3; }
.dg-lobby-foot .dg-btn-go { width: min(100%, 22rem); }
.dg-lobby-foot .dg-note { margin: 0; padding: 10px 14px; border-radius: 14px; background: var(--dg-card); border: 2px dashed color-mix(in oklab, var(--ink) 25%, transparent); }
@media (min-width: 760px) {
  .dg-lobby { grid-template-columns: minmax(280px, 0.9fr) 1.1fr; grid-template-areas: "head head" "code side"; align-items: start; }
  .dg-head { grid-area: head; }
  .dg-lobby-code { grid-area: code; }
  .dg-code-card { transform: rotate(-1.2deg); }
  .dg-lobby-side { grid-area: side; }
}

/* ---- the game ---- */
.dg-play { display: grid; gap: var(--space-2); grid-template-areas: "strip" "stage" "tools" "side"; justify-items: center; }
.dg-play.dg-wide { grid-template-columns: auto minmax(240px, 1fr); grid-template-areas: "strip strip" "stage tools" "stage side"; grid-template-rows: auto auto 1fr; align-items: start; justify-items: stretch; column-gap: var(--space-4); }
.dg-wide .dg-tools { align-self: start; }
.dg-wide .dg-stage { grid-row: 2 / span 2; }
.dg-strip { grid-area: strip; width: 100%; display: grid; grid-template-columns: 1fr auto auto; grid-template-areas: "word timer sound" "round timer sound"; align-items: center; gap: 2px var(--space-2); min-height: 52px; margin-bottom: 6px; }
.dg-strip .dg-sound { grid-area: sound; }
.dg-wide .dg-strip { grid-template-columns: auto 1fr auto auto; grid-template-areas: "round word timer sound"; }
.dg-round { grid-area: round; font-size: 0.8rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); }
.dg-word { grid-area: word; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; justify-content: flex-start; }
.dg-wide .dg-word { justify-content: center; }
.dg-word-label { font-weight: 700; color: var(--ink-soft); }
.dg-word strong { font-size: clamp(1.35rem, 1rem + 1.6vw, 2rem); font-weight: 900; letter-spacing: 0.01em; }
.dg-word-turn { color: var(--dg-hot); }
.dg-word-mine strong { background: var(--dg-sun); color: var(--dg-cream-ink); padding: 0 10px; border-radius: 8px; border: 2px solid var(--dg-edge); transform: rotate(-1.5deg); display: inline-block; }
.dg-mask { display: inline-flex; gap: 0.32em; flex-wrap: wrap; font-size: clamp(1.15rem, 0.9rem + 1.2vw, 1.6rem); }
.dg-mask > span { display: inline-grid; place-items: end center; width: 0.95em; height: 1.45em; font-weight: 900; }
.dg-blank { border-bottom: 4px solid var(--ink); border-radius: 2px; }
.dg-shown { border-bottom: 4px solid var(--dg-hot); color: var(--dg-hot); animation: dg-pop 300ms var(--ease) both; }
.dg-space { width: 0.6em !important; }
.dg-timer {
  --dg-left: 1;
  grid-area: timer; position: relative; width: 52px; height: 52px; border-radius: 50%;
  display: grid; place-items: center;
  background: conic-gradient(var(--dg-mint) calc(var(--dg-left) * 360deg), color-mix(in oklab, var(--ink) 12%, transparent) 0);
  border: 2px solid var(--dg-edge);
}
.dg-timer::before { content: ""; position: absolute; inset: 6px; border-radius: 50%; background: var(--dg-card); border: 2px solid var(--dg-edge); }
.dg-timer span { position: relative; font: 900 1.05rem var(--dg-font); font-variant-numeric: tabular-nums; }
.dg-timer[hidden] { display: none; }
.dg-timer.dg-hurry { background: conic-gradient(var(--dg-hot) calc(var(--dg-left) * 360deg), color-mix(in oklab, var(--ink) 12%, transparent) 0); animation: dg-throb 1s var(--ease) infinite; }
@keyframes dg-throb { 50% { transform: scale(1.08); } }

.dg-stage { grid-area: stage; position: relative; }
.dg-paper { position: relative; background: var(--dg-cream); border: 2px solid var(--dg-edge); border-radius: 6px; box-shadow: var(--dg-pop-big); line-height: 0; }
.dg-paper::before, .dg-paper::after {
  content: ""; position: absolute; top: -9px; width: 64px; height: 18px; z-index: 1;
  background: color-mix(in oklab, var(--dg-sun) 70%, transparent); border: 1px solid color-mix(in oklab, var(--dg-cream-ink) 15%, transparent);
  pointer-events: none;
}
.dg-paper::before { left: 18px; transform: rotate(-6deg); }
.dg-paper::after { right: 18px; transform: rotate(5deg); }
.dg-canvas { display: block; border-radius: 5px; touch-action: none; cursor: default; }
.dg-canvas.dg-can-draw { cursor: crosshair; }

.dg-overlay {
  position: absolute; inset: 0; z-index: 2; display: grid; place-content: center; justify-items: center; gap: var(--space-3);
  padding: var(--space-4); text-align: center; color: var(--dg-cream-ink);
  background: color-mix(in oklab, var(--dg-cream) 82%, transparent); backdrop-filter: blur(2px); border-radius: 6px;
  animation: dg-fade 240ms var(--ease) both;
}
.dg-overlay[hidden] { display: none; }
.dg-overlay p { margin: 0; font-weight: 800; font-size: 1.1rem; }
.dg-overlay h3 { margin: 0; font-weight: 900; font-size: 1.35rem; }
.dg-overlay .dg-hint { color: color-mix(in oklab, var(--dg-cream-ink) 65%, transparent); font-weight: 600; font-size: 0.85rem; max-width: 18rem; }
@keyframes dg-fade { from { opacity: 0; } }
.dg-choices { display: grid; gap: var(--space-2); width: min(100%, 17rem); }
.dg-choice {
  --dg-i: 0;
  min-height: 52px; padding: 0 1rem; border: 2px solid var(--dg-cream-ink); border-radius: 14px;
  background: #fff; color: var(--dg-cream-ink); font: 900 1.15rem var(--dg-font); cursor: pointer;
  box-shadow: 3px 3px 0 var(--dg-cream-ink);
  animation: dg-in 380ms var(--ease) both; animation-delay: calc(var(--dg-i) * 70ms);
  transition: transform var(--dur-fast) var(--ease), background var(--dur) var(--ease);
}
.dg-choice:nth-child(1) { background: #ffe4dc; } .dg-choice:nth-child(2) { background: #fff3c4; } .dg-choice:nth-child(3) { background: #d9f5e8; }
.dg-choice:hover { transform: translate(-1px, -2px) rotate(-1deg); }
.dg-choice:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--dg-cream-ink); }
@keyframes dg-in { from { opacity: 0; transform: translateY(14px) scale(0.96); } }
.dg-overlay-reveal { background: color-mix(in oklab, var(--dg-cream) 90%, transparent); }
.dg-reveal-head { font-size: 1.25rem !important; }
.dg-reveal-word { display: grid; gap: 2px; }
.dg-reveal-word span { font-size: 0.85rem; font-weight: 700; opacity: 0.7; }
.dg-reveal-word strong { font-size: clamp(1.8rem, 1.2rem + 3vw, 2.8rem); font-weight: 900; background: var(--dg-sun); padding: 0 14px; border-radius: 10px; border: 2px solid var(--dg-cream-ink); transform: rotate(-2deg); animation: dg-pop 420ms var(--ease) both; }
.dg-gains { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.dg-gains li { padding: 4px 10px; border-radius: 999px; background: #fff; border: 2px solid var(--dg-cream-ink); font-weight: 800; }
.dg-gains b { color: #138a5a; }

.dg-tools {
  grid-area: tools; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3);
  padding: 8px 10px; background: var(--dg-card); border: 2px solid var(--dg-edge); border-radius: 16px; box-shadow: var(--dg-pop);
  max-width: 100%;
}
.dg-tools[hidden] { display: none; }
.dg-swatches, .dg-sizes, .dg-acts { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dg-swatch {
  --dg-swatch: #000;
  width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--dg-edge); background: var(--dg-swatch); cursor: pointer; padding: 0;
  transition: transform var(--dur-fast) var(--ease); color: var(--dg-cream-ink); font-size: 0.9rem; line-height: 1;
}
.dg-swatch[aria-pressed="true"] { transform: scale(1.18); box-shadow: 0 0 0 3px var(--dg-card), 0 0 0 5px var(--dg-edge); }
.dg-eraser { background: repeating-linear-gradient(45deg, #fff 0 4px, #f1ece0 4px 8px); }
.dg-size, .dg-tool {
  width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px;
  border: 2px solid color-mix(in oklab, var(--ink) 25%, transparent); background: var(--surface); color: var(--ink); cursor: pointer; font-size: 1.1rem; padding: 0;
}
.dg-size span { width: var(--dg-dot); height: var(--dg-dot); border-radius: 50%; background: var(--ink); }
.dg-size[aria-pressed="true"] { border-color: var(--dg-edge); box-shadow: 2px 2px 0 var(--dg-edge); }
.dg-tool:disabled { opacity: 0.45; cursor: default; }

.dg-side { grid-area: side; width: 100%; display: grid; gap: var(--space-2); align-content: start; min-width: 0; }
.dg-wide .dg-side { height: 100%; grid-template-rows: auto minmax(120px, 1fr) auto auto auto; }
.dg-scores { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.dg-wide .dg-scores { flex-direction: column; flex-wrap: nowrap; }
.dg-score {
  display: flex; align-items: center; gap: 8px; flex: none; padding: 4px 10px 4px 4px;
  border: 2px solid var(--dg-edge); border-radius: 999px; background: var(--dg-card);
}
.dg-wide .dg-score { border-radius: 14px; padding: 6px 10px; }
.dg-score .dg-avatar { width: 28px; height: 28px; font-size: 0.8rem; }
.dg-score-name { font-weight: 800; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
.dg-wide .dg-score-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.dg-score-n { font-variant-numeric: tabular-nums; font-weight: 900; }
.dg-score-me { background: color-mix(in oklab, var(--dg-sky) 22%, var(--dg-card)); }
.dg-score-away { opacity: 0.55; }
.dg-feed {
  list-style: none; margin: 0; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px;
  min-height: 3.4rem; max-height: 8.5rem; overflow-y: auto;
  background: var(--surface); border: 2px solid color-mix(in oklab, var(--ink) 18%, transparent); border-radius: 14px;
}
.dg-wide .dg-feed { max-height: none; min-height: 0; }
.dg-play:not(.dg-wide) .dg-feed:empty { display: none; }
.dg-line { font-size: 0.95rem; line-height: 1.3; overflow-wrap: anywhere; }
.dg-line b { color: hsl(var(--dg-hue, 20) 60% 38%); }
:root[data-theme="dark"] .dg-line b { color: hsl(var(--dg-hue, 20) 80% 72%); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .dg-line b { color: hsl(var(--dg-hue, 20) 80% 72%); } }
.dg-line-close { color: var(--warn); font-weight: 800; }
.dg-line-got { color: var(--ok); font-weight: 900; }
.dg-line-quiet { color: var(--ink-faint); font-size: 0.85rem; }
.dg-line-pending { opacity: 0.55; font-style: italic; }
.dg-guess { display: flex; gap: var(--space-2); }
.dg-guess[hidden] { display: none; }
.dg-guess .dg-btn { flex: none; }
.dg-drawer-note { margin: 0; padding: 10px 12px; border-radius: 14px; background: color-mix(in oklab, var(--dg-sun) 30%, var(--surface)); font-weight: 800; }
.dg-drawer-note[hidden] { display: none; }
.dg-side > .dg-btn-small { justify-self: start; }

/* ---- the end ---- */
.dg-final { display: grid; justify-items: center; gap: var(--space-4); text-align: center; padding: var(--space-6) 0; max-width: 760px; margin: 0 auto; }
.dg-final .dg-title { transform: rotate(-2deg); transform-origin: center; }
.dg-final .dg-title::after { margin-inline: auto; }
.dg-podium { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 150px)); align-items: end; gap: var(--space-2); width: 100%; justify-content: center; }
.dg-step { --dg-i: 0; display: grid; justify-items: center; gap: 6px; animation: dg-rise 620ms var(--ease) both; animation-delay: calc(var(--dg-i) * 160ms + 120ms); min-width: 0; }
.dg-step-1 { order: 2; } .dg-step-2 { order: 1; } .dg-step-3 { order: 3; }
.dg-step-name { font-weight: 900; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dg-step-block {
  width: 100%; display: grid; place-items: start center; padding-top: 8px; font-size: 1.8rem;
  border: 2px solid var(--dg-edge); border-radius: 12px 12px 4px 4px; box-shadow: var(--dg-pop);
}
.dg-step-1 .dg-step-block { height: 130px; background: var(--dg-sun); }
.dg-step-2 .dg-step-block { height: 90px; background: color-mix(in oklab, var(--dg-sky) 55%, var(--dg-card)); }
.dg-step-3 .dg-step-block { height: 64px; background: color-mix(in oklab, var(--dg-hot) 45%, var(--dg-card)); }
@keyframes dg-rise { from { opacity: 0; transform: translateY(30px); } }
.dg-rest { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; width: min(100%, 22rem); }
.dg-rest li { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 12px; background: var(--dg-card); border: 2px solid color-mix(in oklab, var(--ink) 18%, transparent); }
.dg-rest li span:not(.dg-avatar) { flex: 1; text-align: left; font-weight: 800; }
.dg-final-acts { justify-content: center; }
.dg-confetti { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10; }

/* ---- phones held sideways: the strip and the tools tighten ---- */
@media (max-height: 520px) {
  .dg { padding-top: 0; }
  .dg-strip { min-height: 44px; }
  .dg-timer { width: 44px; height: 44px; }
  .dg-swatch { width: 28px; height: 28px; }
  .dg-size, .dg-tool { width: 34px; height: 34px; }
  .dg-wait { padding-top: 4vh; }
  .dg-wide .dg-scores { flex-direction: row; flex-wrap: wrap; }
  .dg-wide .dg-score { border-radius: 999px; padding: 4px 10px 4px 4px; }
  .dg-wide .dg-score-name { flex: none; }
}

@media (prefers-reduced-motion: reduce) {
  .dg *, .dg *::before, .dg *::after { animation: none !important; transition: none !important; }
}
`;
