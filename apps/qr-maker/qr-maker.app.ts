// QR Maker — type a text, a link, a Wi‑Fi network or a contact, and a QR code appears as you type:
// big, black on white, ready to hold up. Share it as a picture, keep it for next time, or save a
// copy. Nothing leaves the device: the code is made here (qr.ts), with no library and no network.
//
// Kept codes are records; each one's picture is a PNG in the app's own folder (`ctx.files`), written
// by hand from the matrix (qr.ts `pngOf`), so a code is the same picture on screen, in the Kept
// list and when it is shared. What you last typed is remembered in `ctx.storage`, so the app opens
// on it. Both screens are custom views in plain DOM, so the app runs sealed as well as yours.
//
// In six languages (#303), in words.ts.
import { defineApp } from "potyro";
import type { Ctx, FileInfo, FileRef, Resolved, ViewProps } from "potyro";
import { drawOn, encode, pngOf, versionFor, type Matrix } from "./qr.js";
import { W } from "./words.js";

// ---- what a code can say ----

export type Kind = "text" | "link" | "wifi" | "contact";
export const KINDS: Kind[] = ["text", "link", "wifi", "contact"];

export type Security = "WPA" | "WEP" | "nopass";

/** The fields of each kind, as typed. */
export interface Fields {
  text: string;
  link: string;
  ssid: string;
  password: string;
  security: Security;
  name: string;
  phone: string;
  email: string;
}

export const EMPTY: Fields = { text: "", link: "", ssid: "", password: "", security: "WPA", name: "", phone: "", email: "" };

/** `\`, `;`, `,`, `"` and `:` mean something in a Wi‑Fi string; a network name may contain any of them. */
const wifiEscape = (s: string): string => s.replace(/([\\;,":])/g, "\\$1");

/** What the code carries for a kind, or "" while there is nothing to say yet. */
export function contentOf(kind: Kind, f: Fields): string {
  switch (kind) {
    case "text":
      return f.text.trim();
    case "link": {
      const raw = f.link.trim();
      if (!raw) return "";
      return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    }
    case "wifi": {
      const ssid = f.ssid.trim();
      if (!ssid) return "";
      const t = f.security === "nopass" ? "nopass" : f.security;
      return `WIFI:T:${t};S:${wifiEscape(ssid)};${f.security === "nopass" ? "" : `P:${wifiEscape(f.password)};`};`;
    }
    case "contact": {
      const name = f.name.trim();
      const phone = f.phone.trim();
      const email = f.email.trim();
      if (!name && !phone && !email) return "";
      const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${name};;;`, `FN:${name}`];
      if (phone) lines.push(`TEL:${phone}`);
      if (email) lines.push(`EMAIL:${email}`);
      lines.push("END:VCARD");
      return lines.join("\n");
    }
  }
}

/** What to call a code when it is kept, from what it says: the link's host, the network, the name, the first words. */
export function suggestedLabel(kind: Kind, f: Fields): string {
  switch (kind) {
    case "link":
      try {
        return new URL(contentOf("link", f)).host.replace(/^www\./, "") || f.link.trim();
      } catch {
        return f.link.trim();
      }
    case "wifi":
      return f.ssid.trim();
    case "contact":
      return f.name.trim() || f.phone.trim() || f.email.trim();
    default:
      return f.text.trim().split(/\s+/).slice(0, 5).join(" ").slice(0, 40);
  }
}

/** The fields a kept code's content came from, for "Open in Make": a link and a text are read back exactly; Wi‑Fi and contacts the simple way. */
export function fieldsOf(kind: Kind, content: string): Fields {
  const f = { ...EMPTY };
  if (kind === "text") f.text = content;
  else if (kind === "link") f.link = content;
  else if (kind === "wifi") {
    const part = (k: string) => new RegExp(`${k}:((?:\\\\.|[^;\\\\])*);`).exec(content)?.[1]?.replace(/\\(.)/g, "$1") ?? "";
    f.ssid = part("S");
    f.password = part("P");
    const t = part("T");
    f.security = t === "nopass" ? "nopass" : t === "WEP" ? "WEP" : "WPA";
  } else {
    const line = (k: string) => new RegExp(`^${k}:(.*)$`, "m").exec(content)?.[1] ?? "";
    f.name = line("FN");
    f.phone = line("TEL");
    f.email = line("EMAIL");
  }
  return f;
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "code";

/** A file as a `file` field holds it. */
const refOf = (f: FileInfo): FileRef => ({ id: f.id, path: f.path, name: f.name, mime: f.mime });

const LAST = "last";
const SCALE = 10;
const QUIET = 4;

/** The picture of a code, written into the app's folder. */
async function writePicture(ctx: Ctx, label: string, m: Matrix): Promise<FileInfo> {
  const name = `${slug(label)}-${ctx.now().getTime().toString(36)}.png`;
  return ctx.files.write(`codes/${name}`, pngOf(m, SCALE, QUIET), { mime: "image/png" });
}

/** A kept code: its record, with its picture. */
async function keep(ctx: Ctx, kind: Kind, content: string, label: string): Promise<Resolved> {
  const file = await writePicture(ctx, label, encode(content));
  return ctx.create("code", { label, kind, content, image: refOf(file) });
}

// ---- the demo: three codes, so Kept is never empty on a link ----

async function demo(ctx: Ctx): Promise<void> {
  if ((await ctx.query("code", { limit: 1 })).length) return;
  await keep(ctx, "link", "https://potyro.app", ctx.t(W.demoLink));
  await keep(ctx, "wifi", contentOf("wifi", { ...EMPTY, ssid: "Café Guest", password: "cr0issant!", security: "WPA" }), ctx.t(W.demoWifi));
  await keep(ctx, "text", "4921#", ctx.t(W.demoText));
}

// ---- small DOM helpers ----

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}

const STYLES = `
.qm { color: var(--ink); font-family: var(--font-ui); padding: var(--space-2) 0 var(--space-6); }
.qm *, .qm *::before, .qm *::after { box-sizing: border-box; }
.qm [hidden] { display: none !important; }
.qm-seg { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--surface-sunken); }
.qm-seg button { flex: 1; min-height: 40px; border: 0; border-radius: 999px; background: transparent; color: var(--ink-soft); font: 600 0.92rem var(--font-ui); cursor: pointer; touch-action: manipulation; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
.qm-seg button[aria-pressed="true"] { background: var(--surface-raised); color: var(--ink); box-shadow: var(--shadow); }
.qm-seg button:focus-visible, .qm-btn:focus-visible, .qm-field :is(input, textarea):focus-visible { outline: 3px solid color-mix(in oklab, var(--accent) 60%, transparent); outline-offset: 2px; }
.qm-fields { display: grid; gap: var(--space-3); margin: var(--space-4) 0; }
.qm-field { display: grid; gap: 6px; }
.qm-field > span { font: 600 0.8rem var(--font-ui); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); }
.qm-field :is(input, textarea) { width: 100%; min-height: 46px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-raised); color: var(--ink); font: 1.05rem/1.4 var(--font-ui); resize: vertical; }
.qm-field textarea { min-height: 88px; }
.qm-field .qm-seg { margin-top: 2px; }
.qm-card { position: relative; width: min(100%, 420px); margin: 0 auto; padding: 14px; border-radius: 24px; background: #fff; box-shadow: 0 2px 4px oklch(20% 0.02 60 / 0.08), 0 18px 44px oklch(20% 0.02 60 / 0.16); }
.qm-card canvas { display: block; width: 100%; height: auto; border-radius: 10px; image-rendering: pixelated; }
.qm-card img { display: block; width: 100%; height: auto; border-radius: 10px; image-rendering: pixelated; }
.qm-note { display: grid; place-items: center; aspect-ratio: 1; padding: var(--space-4); color: #6b6560; font: 500 1rem/1.5 var(--font-ui); text-align: center; }
.qm-info { margin: var(--space-2) 0 0; text-align: center; color: var(--ink-soft); font: 500 0.85rem var(--font-ui); overflow-wrap: anywhere; }
.qm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); max-width: 420px; margin: var(--space-4) auto 0; }
.qm-actions .qm-primary { grid-column: 1 / -1; }
.qm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 1.05rem; border-radius: 999px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font: 600 0.95rem var(--font-ui); white-space: nowrap; cursor: pointer; touch-action: manipulation; transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur) var(--ease); }
.qm-btn:hover { transform: translateY(-1px); box-shadow: var(--shadow); }
.qm-btn:active { transform: translateY(1px) scale(0.98); }
.qm-btn[disabled] { opacity: 0.45; pointer-events: none; }
.qm-btn.qm-primary { background: var(--accent); border-color: transparent; color: var(--on-accent); min-height: 52px; font-size: 1.02rem; box-shadow: 0 8px 22px color-mix(in oklab, var(--accent) 36%, transparent); }
.qm-btn.qm-danger { color: var(--danger); }
.qm-list { display: grid; gap: var(--space-2); }
.qm-row { display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: var(--space-3); width: 100%; padding: 10px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface-raised); color: var(--ink); text-align: left; font: inherit; cursor: pointer; touch-action: manipulation; transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur) var(--ease); }
.qm-row:hover { transform: translateY(-1px); box-shadow: var(--shadow); }
.qm-row img { width: 64px; height: 64px; border-radius: 10px; background: #fff; image-rendering: pixelated; }
.qm-row b { display: block; font: 600 1.02rem var(--font-ui); }
.qm-row small { display: block; color: var(--ink-soft); font: 500 0.85rem var(--font-ui); overflow-wrap: anywhere; }
.qm-row .qm-kind { font: 600 0.75rem var(--font-ui); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); }
.qm-empty { text-align: center; color: var(--ink-soft); padding: var(--space-6) var(--space-4); }
.qm-box { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: var(--space-4); background: var(--scrim); }
.qm-box-card { width: min(100%, 460px); max-height: calc(100dvh - 2 * var(--space-4)); overflow: auto; display: grid; gap: var(--space-3); padding: var(--space-4); border-radius: 22px; background: var(--surface-raised); box-shadow: 0 30px 80px oklch(10% 0.02 60 / 0.4); }
.qm-box-card h3 { margin: 0; font: 700 1.3rem var(--font-display, var(--font-ui)); }
.qm-box-card .qm-actions { margin-top: 0; }
@media (prefers-reduced-motion: reduce) { .qm * { transition: none !important; } }
`;

// ---- the Make screen ----

/**
 * What the Make screen holds, kept across mounts: the shell mounts a custom view again when the
 * app's data changes (a code kept, a preference written), and a code half-typed must not vanish.
 */
let making: { kind: Kind; fields: Fields; touched: boolean } = { kind: "text", fields: { ...EMPTY }, touched: false };

function mountMake(el: HTMLElement, props: ViewProps): () => void {
  const ctx = props.runtime.ctx;
  const root = h("div", { class: "qm" });
  const style = h("style", {}, STYLES);
  el.append(style, root);
  let alive = true;
  let kind: Kind = making.kind;
  let fields: Fields = { ...making.fields };
  let matrix: Matrix | null = null;
  let content = "";
  /** Something was typed or chosen here: what was remembered must not overwrite it when it arrives. */
  let touched = making.touched;

  // The kind
  const segButtons = new Map<Kind, HTMLButtonElement>();
  const seg = h("div", { class: "qm-seg", role: "group", "aria-label": ctx.t(W.kind) });
  for (const k of KINDS) {
    const b = h("button", { type: "button", "aria-pressed": "false" }, ctx.t(k === "text" ? W.kindText : k === "link" ? W.kindLink : k === "wifi" ? W.kindWifi : W.kindContact));
    b.addEventListener("click", () => {
      touched = true;
      kind = k;
      show();
      firstInput()?.focus();
    });
    seg.append(b);
    segButtons.set(k, b);
  }

  // The fields, one group per kind
  const input = (key: keyof Fields, label: string, attrs: Record<string, string> = {}, tag: "input" | "textarea" = "input") => {
    const field = h(tag, { class: "qm-input", "aria-label": label, autocomplete: "off", autocapitalize: tag === "textarea" ? "sentences" : "off", ...attrs }) as HTMLInputElement | HTMLTextAreaElement;
    field.addEventListener("input", () => {
      touched = true;
      (fields as unknown as Record<string, string>)[key] = field.value;
      render();
    });
    return { wrap: h("label", { class: "qm-field" }, h("span", {}, label), field), field };
  };
  const text = input("text", ctx.t(W.textLabel), { placeholder: ctx.t(W.textHint) }, "textarea");
  const link = input("link", ctx.t(W.linkLabel), { placeholder: ctx.t(W.linkHint), inputmode: "url", type: "url" });
  const ssid = input("ssid", ctx.t(W.ssid), {});
  const password = input("password", ctx.t(W.password), { type: "text" });
  const securitySeg = h("div", { class: "qm-seg", role: "group", "aria-label": ctx.t(W.security) });
  const securityButtons = new Map<Security, HTMLButtonElement>();
  for (const s of ["WPA", "WEP", "nopass"] as const) {
    const b = h("button", { type: "button", "aria-pressed": "false" }, s === "nopass" ? ctx.t(W.securityNone) : s);
    b.addEventListener("click", () => {
      touched = true;
      fields.security = s;
      show();
    });
    securitySeg.append(b);
    securityButtons.set(s, b);
  }
  const security = h("div", { class: "qm-field" }, h("span", {}, ctx.t(W.security)), securitySeg);
  const name = input("name", ctx.t(W.name), { autocapitalize: "words" });
  const phone = input("phone", ctx.t(W.phone), { type: "tel", inputmode: "tel" });
  const email = input("email", ctx.t(W.email), { type: "email", inputmode: "email" });
  const groups: Record<Kind, HTMLElement[]> = {
    text: [text.wrap],
    link: [link.wrap],
    wifi: [ssid.wrap, password.wrap, security],
    contact: [name.wrap, phone.wrap, email.wrap],
  };
  const fieldsEl = h("div", { class: "qm-fields" }, ...Object.values(groups).flat());
  const firstInput = (): HTMLElement | null => groups[kind][0]!.querySelector("input, textarea");

  // The code
  const canvas = h("canvas", { width: "0", height: "0", role: "img", "aria-label": ctx.t(W.codeLabel) });
  const note = h("div", { class: "qm-note" }, ctx.t(W.empty));
  const card = h("div", { class: "qm-card" }, canvas, note);
  const info = h("p", { class: "qm-info" });
  const share = h("button", { class: "qm-btn qm-primary", type: "button" }, "↗ " + ctx.t(W.share));
  const keepB = h("button", { class: "qm-btn", type: "button" }, ctx.t(W.keep));
  const save = h("button", { class: "qm-btn", type: "button" }, ctx.t(W.save));
  const actions = h("div", { class: "qm-actions" }, share, keepB, save);
  root.append(seg, fieldsEl, card, info, actions);

  const show = () => {
    for (const [k, b] of segButtons) b.setAttribute("aria-pressed", String(k === kind));
    for (const [k, els] of Object.entries(groups) as Array<[Kind, HTMLElement[]]>) for (const e of els) e.hidden = k !== kind;
    for (const [s, b] of securityButtons) b.setAttribute("aria-pressed", String(s === fields.security));
    password.wrap.hidden = kind !== "wifi" || fields.security === "nopass";
    render();
  };

  const fill = () => {
    text.field.value = fields.text;
    link.field.value = fields.link;
    ssid.field.value = fields.ssid;
    password.field.value = fields.password;
    name.field.value = fields.name;
    phone.field.value = fields.phone;
    email.field.value = fields.email;
  };

  let remember: ReturnType<typeof setTimeout> | undefined;
  const render = () => {
    content = contentOf(kind, fields);
    matrix = null;
    if (content) {
      if (versionFor(content, "M") === null) {
        note.textContent = ctx.t(W.tooLong);
      } else {
        matrix = encode(content, "M");
        const side = (matrix.size + QUIET * 2) * SCALE;
        canvas.width = side;
        canvas.height = side;
        drawOn(canvas, matrix, QUIET);
      }
    } else note.textContent = ctx.t(W.empty);
    canvas.hidden = !matrix;
    note.hidden = !!matrix;
    info.textContent = matrix ? (kind === "wifi" || kind === "contact" ? suggestedLabel(kind, fields) : content.length > 90 ? `${content.slice(0, 90)}…` : content) : "";
    for (const b of [share, keepB, save]) b.disabled = !matrix;
    making = { kind, fields: { ...fields }, touched };
    clearTimeout(remember);
    remember = setTimeout(() => void ctx.storage.set(LAST, { kind, fields }).catch(() => undefined), 300);
  };

  const pictureBlob = (): Blob => new Blob([new Uint8Array(pngOf(matrix!, SCALE, QUIET))], { type: "image/png" });
  share.addEventListener("click", () => {
    if (!matrix) return;
    void ctx.ui
      .share({ title: suggestedLabel(kind, fields) || ctx.t(W.appName), text: kind === "wifi" || kind === "contact" ? ctx.t(W.shareText) : content, files: [pictureBlob()] })
      .catch(() => ctx.ui.toast(ctx.t(W.notShared)));
  });
  keepB.addEventListener("click", async () => {
    if (!matrix) return;
    const label = (await ctx.ui.prompt(W.keepName, { default: suggestedLabel(kind, fields) }))?.trim();
    if (!label) return;
    await keep(ctx, kind, content, label);
    ctx.ui.toast(W.keptToast);
  });
  save.addEventListener("click", async () => {
    if (!matrix) return;
    const file = await writePicture(ctx, suggestedLabel(kind, fields) || "code", matrix);
    try {
      await ctx.files.export(refOf(file));
    } catch {
      ctx.ui.toast(ctx.t(W.notSaved));
    } finally {
      // Made to leave the app; the app keeps no copy of it.
      await ctx.files.remove(refOf(file)).catch(() => undefined);
    }
  });

  // Open on what was typed last, or on what a kept code asks for ("Open in Make").
  const asked = (props.param ?? {}) as { kind?: string; content?: string };
  if (asked.kind && KINDS.includes(asked.kind as Kind) && typeof asked.content === "string" && !(touched && making.kind === asked.kind && contentOf(making.kind, making.fields) === asked.content)) {
    kind = asked.kind as Kind;
    fields = fieldsOf(kind, asked.content);
    touched = true;
    fill();
    show();
  } else if (touched) {
    fill();
    show();
  } else {
    show();
    void ctx.storage
      .get<{ kind: Kind; fields: Partial<Fields> }>(LAST)
      .then((last) => {
        if (!alive || touched || !last || !KINDS.includes(last.kind)) return;
        kind = last.kind;
        fields = { ...EMPTY, ...last.fields };
        fill();
        show();
      })
      .catch(() => undefined);
  }

  return () => {
    alive = false;
    clearTimeout(remember);
    root.remove();
    style.remove();
  };
}

// ---- the Kept screen ----

function mountKept(el: HTMLElement, props: ViewProps): () => void {
  const ctx = props.runtime.ctx;
  const root = h("div", { class: "qm" });
  const style = h("style", {}, STYLES);
  el.append(style, root);
  const list = h("div", { class: "qm-list" });
  const empty = h("p", { class: "qm-empty" }, ctx.t(W.noKept));
  root.append(list, empty);
  const urls = new Map<string, string>();
  let alive = true;

  const urlFor = async (ref: FileRef | null): Promise<string | null> => {
    if (!ref) return null;
    const known = urls.get(ref.id);
    if (known) return known;
    const url = await ctx.files.url(ref).catch(() => null);
    if (url) urls.set(ref.id, url);
    return url;
  };
  const kindName = (k: string) => ctx.t(k === "link" ? W.kindLink : k === "wifi" ? W.kindWifi : k === "contact" ? W.kindContact : W.kindText);

  const open = (r: Resolved, url: string | null) => {
    const opener = document.activeElement as HTMLElement | null;
    const picture = url ? h("img", { src: url, alt: ctx.t(W.codeLabel) }) : h("div", { class: "qm-note" }, "…");
    const share = h("button", { class: "qm-btn qm-primary", type: "button" }, "↗ " + ctx.t(W.share));
    const save = h("button", { class: "qm-btn", type: "button" }, ctx.t(W.save));
    const again = h("button", { class: "qm-btn", type: "button" }, ctx.t(W.makeAnother));
    const del = h("button", { class: "qm-btn qm-danger", type: "button" }, ctx.t(W.delete));
    const close = h("button", { class: "qm-btn", type: "button" }, ctx.t(W.close));
    const box = h(
      "div",
      { class: "qm-box", role: "dialog", "aria-modal": "true", "aria-labelledby": "qm-box-title" },
      h("div", { class: "qm-box-card" }, h("h3", { id: "qm-box-title" }, String(r.label)), h("div", { class: "qm-card" }, picture), h("p", { class: "qm-info" }, `${kindName(String(r.kind))} · ${String(r.content).slice(0, 120)}`), h("div", { class: "qm-actions" }, share, save, again, del, close)),
    );
    const shut = () => {
      box.remove();
      opener?.focus();
    };
    box.addEventListener("click", (e) => e.target === box && shut());
    box.addEventListener("keydown", (e) => e.key === "Escape" && shut());
    close.addEventListener("click", shut);
    share.addEventListener("click", () => void ctx.ui.share({ title: String(r.label), text: r.kind === "text" || r.kind === "link" ? String(r.content) : ctx.t(W.shareText), files: [r.image as FileRef] }).catch(() => ctx.ui.toast(ctx.t(W.notShared))));
    save.addEventListener("click", () => void ctx.files.export(r.image as FileRef).catch(() => ctx.ui.toast(ctx.t(W.notSaved))));
    again.addEventListener("click", () => {
      shut();
      props.navigate("make", { kind: String(r.kind), content: String(r.content) });
    });
    del.addEventListener("click", async () => {
      if (!(await ctx.ui.confirm(W.deleteAsk, { ok: W.delete, destructive: true }))) return;
      shut();
      await ctx.delete("code", String(r.id));
      if (r.image) await ctx.files.remove(r.image as FileRef).catch(() => undefined);
    });
    document.body.append(box);
    share.focus();
  };

  const stop = props.runtime.watchQuery("code", { sort: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) }, (state) => {
    if (!alive || state.loading) return;
    list.replaceChildren();
    empty.hidden = state.rows.length > 0;
    for (const r of state.rows) {
      const img = h("img", { alt: "" });
      const row = h("button", { class: "qm-row", type: "button" }, img, h("span", {}, h("b", {}, String(r.label)), h("small", {}, String(r.content).slice(0, 80))), h("span", { class: "qm-kind" }, kindName(String(r.kind))));
      let url: string | null = null;
      void urlFor((r.image as FileRef | null) ?? null).then((u) => {
        url = u;
        if (u) img.src = u;
      });
      row.addEventListener("click", () => open(r, url));
      list.append(row);
    }
  });

  return () => {
    alive = false;
    stop();
    root.remove();
    style.remove();
  };
}

export default defineApp({
  id: "qr-maker",
  name: W.appName,
  icon: "▦",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#1f6feb" },
  nav: "tabs",
  entities: {
    code: {
      label: { en: "Code", "pt-BR": "Código", de: "Code", es: "Código", pl: "Kod", it: "Codice" },
      displayField: "label",
      fields: {
        label: { type: "text", required: true, label: W.name },
        kind: {
          type: "enum",
          options: KINDS,
          default: "text",
          labels: { text: W.kindText, link: W.kindLink, wifi: W.kindWifi, contact: W.kindContact },
          label: W.kind,
        },
        content: { type: "text", required: true, multiline: true, label: W.textLabel },
        image: { type: "file", accept: ".png", folder: "codes", label: W.codeLabel },
      },
    },
  },
  tile: async (ctx) => {
    const codes = await ctx.query("code", { sort: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) });
    return {
      count: codes.length,
      title: codes.length ? ctx.t(W.tileCount, { n: codes.length }) : ctx.t(W.tileNone),
      lines: codes.slice(0, 3).map((c) => String(c.label)),
      image: codes[0]?.image as FileRef | undefined,
    };
  },
  demo,
  pages: [
    { id: "make", title: W.make, icon: "▦", view: { type: "custom", entity: "code", mount: mountMake } },
    { id: "kept", title: W.kept, icon: "🗂", view: { type: "custom", entity: "code", mount: mountKept } },
  ],
});
