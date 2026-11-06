// The editor's stylesheet. One writing surface, the writers' colours as the only ornament: the
// textarea is transparent over a backdrop that draws the same text with each person's tint under
// their words, so wrapping, caret and selection are the browser's own.
export const CSS = `
.wt { display: flex; flex-direction: column; height: 100dvh; max-height: 100%; min-height: 0; background: var(--bg, #fff); color: var(--ink, #231f20); font-family: var(--font-body, system-ui, sans-serif); }
.wt-head { flex: none; background: var(--surface, #f3f3f4); border-bottom: 1px solid var(--line, #e6e5e7); padding-top: var(--k-safe-top, 0px); }
.wt-row { display: flex; align-items: center; gap: 0.35rem; padding: 0.4rem 0.6rem; overflow-x: auto; scrollbar-width: none; }
.wt-row::-webkit-scrollbar { display: none; }
.wt-top { padding-right: 3.4rem; overflow: hidden; }
.wt-row .wt-narrow, .wt-narrow { display: none; }
@media (max-width: 600px) {
  .wt-row .wt-wide, .wt-wide { display: none; }
  .wt-row .wt-narrow, .wt-narrow { display: inline-flex; }
  .wt-top { padding-right: 3rem; }
}
.wt-row button, .wt-row .wt-btn { flex: none; min-width: 2.4rem; height: 2.4rem; padding: 0 0.7rem; border: 1px solid var(--line-strong, #8c8a8e); border-radius: 0.7rem; background: var(--bg, #fff); color: inherit; font: inherit; font-weight: 600; cursor: pointer; touch-action: manipulation; display: inline-flex; align-items: center; gap: 0.35rem; }
.wt-row button:active { transform: scale(0.96); }
.wt-row button:disabled { opacity: 0.45; cursor: default; }
.wt-row button[aria-pressed="true"] { background: var(--ink, #231f20); color: var(--bg, #fff); border-color: transparent; }
.wt-row .wt-i { font-style: italic; font-family: Georgia, serif; }
.wt-row .wt-code { font-family: var(--font-mono, ui-monospace, monospace); font-weight: 600; }
.wt-row .wt-gap { flex: 1; min-width: 0.5rem; }
.wt-title { flex: 1; min-width: 3rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; height: 2.4rem; padding: 0 0.5rem; border: 1px solid transparent; border-radius: 0.7rem; background: transparent; color: inherit; font: inherit; font-weight: 700; font-size: 1.05rem; }
.wt-title:hover, .wt-title:focus { border-color: var(--line-strong, #8c8a8e); background: var(--bg, #fff); outline: none; }
.wt-count { display: inline-block; min-width: 1.3rem; padding: 0 0.35rem; border-radius: 1rem; background: var(--accent, #ca2b70); color: var(--on-accent, #fff); font-size: 0.8rem; line-height: 1.3rem; text-align: center; }
.wt-people { display: flex; gap: 0.25rem; align-items: center; flex: none; }
.wt-swatch { width: 2rem; height: 2rem; border-radius: 50%; border: 2px solid var(--wt-stroke); background: var(--wt-tint); color: var(--ink, #231f20); font-size: 0.75rem; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; padding: 0; min-width: 0 !important; }
.wt-swatch.wt-me { cursor: pointer; }
.wt-body { flex: 1; min-height: 0; display: flex; position: relative; }
.wt-editor { flex: 1; min-width: 0; position: relative; }
.wt-backdrop, .wt-text { position: absolute; inset: 0; margin: 0; padding: 1rem calc(1rem + var(--k-safe-right, 0px)) calc(2rem + var(--k-safe-bottom, 0px)) calc(1rem + var(--k-safe-left, 0px)); box-sizing: border-box; font: 1.05rem/1.65 var(--font-body, system-ui, sans-serif); letter-spacing: normal; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; tab-size: 4; }
.wt-backdrop { overflow: hidden; color: transparent; pointer-events: none; }
.wt-backdrop span { border-radius: 0.2em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.wt-backdrop .wt-c { border-bottom: 2px solid var(--accent, #ca2b70); background-image: linear-gradient(color-mix(in oklab, var(--accent, #ca2b70) 18%, transparent), color-mix(in oklab, var(--accent, #ca2b70) 18%, transparent)); }
.wt-backdrop .wt-c.wt-point { border-left: 2px solid var(--accent, #ca2b70); }
.wt-text { border: 0; outline: 0; resize: none; background: transparent; color: var(--ink, #231f20); caret-color: var(--ink, #231f20); overflow: auto; width: 100%; height: 100%; }
.wt-text::placeholder { color: var(--muted, #6d6b6e); }
.wt-preview { flex: 1; min-width: 0; overflow: auto; padding: 0.5rem 1rem 3rem; box-sizing: border-box; line-height: 1.6; }
.wt-preview > * { max-width: 44rem; margin-left: auto; margin-right: auto; }
.wt-preview pre { background: var(--surface, #f3f3f4); padding: 0.75rem; border-radius: 0.6rem; overflow: auto; font-family: var(--font-mono, ui-monospace, monospace); }
.wt-preview blockquote { border-left: 3px solid var(--line-strong, #8c8a8e); margin-left: 0; padding-left: 0.75rem; color: var(--muted, #6d6b6e); }
.wt-panel { flex: none; width: 21rem; max-width: 100%; border-left: 1px solid var(--line, #e6e5e7); background: var(--surface, #f3f3f4); display: flex; flex-direction: column; min-height: 0; }
.wt-panel-head { flex: none; display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.8rem; font-weight: 700; border-bottom: 1px solid var(--line, #e6e5e7); }
.wt-panel-head .wt-gap { flex: 1; }
.wt-panel-head button { border: 0; background: transparent; font: inherit; color: var(--muted, #6d6b6e); cursor: pointer; padding: 0.2rem 0.4rem; }
.wt-list { flex: 1; min-height: 0; overflow: auto; padding: 0.5rem 0.6rem calc(0.5rem + var(--k-safe-bottom, 0px)); display: flex; flex-direction: column; gap: 0.5rem; }
.wt-empty { color: var(--muted, #6d6b6e); padding: 0.5rem 0.3rem; font-size: 0.95rem; }
.wt-note { background: var(--bg, #fff); border: 1px solid var(--line, #e6e5e7); border-left: 4px solid var(--wt-stroke, var(--line-strong)); border-radius: 0.6rem; padding: 0.55rem 0.7rem; cursor: pointer; }
.wt-note[aria-current="true"] { border-color: var(--accent, #ca2b70); }
.wt-note.wt-done { opacity: 0.6; }
.wt-note-who { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--muted, #6d6b6e); }
.wt-note-who b { color: var(--ink, #231f20); }
.wt-note-who time { margin-left: auto; }
.wt-quote { margin: 0.3rem 0; padding: 0.1rem 0.4rem; border-radius: 0.3rem; background: var(--surface-2, #e6e5e7); font-size: 0.85rem; color: var(--muted, #6d6b6e); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-quote.wt-gone { font-style: italic; }
.wt-note p { margin: 0.25rem 0 0.35rem; white-space: pre-wrap; }
.wt-note-acts { display: flex; gap: 0.3rem; }
.wt-note-acts button { border: 0; background: transparent; font: inherit; font-size: 0.85rem; color: var(--muted, #6d6b6e); cursor: pointer; padding: 0.2rem 0.4rem; border-radius: 0.4rem; }
.wt-note-acts button:hover { background: var(--surface-2, #e6e5e7); color: var(--ink, #231f20); }
.wt-compose { flex: none; border-top: 1px solid var(--line, #e6e5e7); padding: 0.6rem 0.7rem calc(0.6rem + var(--k-safe-bottom, 0px)); background: var(--bg, #fff); }
.wt-compose textarea { width: 100%; box-sizing: border-box; min-height: 4.5rem; padding: 0.5rem; border: 1px solid var(--line-strong, #8c8a8e); border-radius: 0.6rem; background: var(--bg, #fff); color: inherit; font: inherit; resize: vertical; }
.wt-compose-acts { display: flex; justify-content: flex-end; gap: 0.4rem; margin-top: 0.4rem; }
.wt-compose-acts button { height: 2.2rem; padding: 0 0.8rem; border-radius: 0.6rem; border: 1px solid var(--line-strong, #8c8a8e); background: var(--bg, #fff); color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.wt-compose-acts .wt-primary { background: var(--accent, #ca2b70); color: var(--on-accent, #fff); border-color: transparent; }
.wt-compose-acts button:disabled { opacity: 0.45; }
.wt-wait { padding: 1rem; color: var(--muted, #6d6b6e); }
@media (max-width: 860px) {
  .wt-panel { position: absolute; left: 0; right: 0; bottom: 0; width: auto; max-height: 70%; border-left: 0; border-top: 1px solid var(--line, #e6e5e7); border-radius: 1rem 1rem 0 0; box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.12); z-index: 2; }
}
`;
