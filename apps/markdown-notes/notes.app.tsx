// Markdown notes — an app whose notes are FILES (#251, #254). Each note is a `.md` file in the app's
// own folder (`ctx.files`), and a `note` record points at it through a `file` field, so the list can
// be sorted, searched and named like any records while the text stays an ordinary file: bring notes
// in from the device, read them rendered, edit them, save a copy back out.
//
// What it shows about files:
//   - `ctx.files.import({ folder, accept, multiple })` — the person picks; [] when they cancel;
//   - `ctx.files.text(ref)` — `null` while the bytes have not reached this device (a shared app);
//   - `ctx.files.write(path, text)` — create or replace; replacing keeps the file's id, so the
//     `file` field still points at it;
//   - `ctx.files.export(ref)` — a copy outside the app, through the system's save dialog.
//
// The markdown is drawn as React elements, never as HTML from the file: a note someone sent cannot
// put a script on the page.
import { defineApp } from "potyro";
import type { Ctx, FileInfo, FileRef, Resolved, ViewProps } from "potyro";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

const FOLDER = "notes";
const ACCEPT = ".md,.markdown,.txt";

/** What a `file` field holds, from what `ctx.files` returns. */
const refOf = (f: FileInfo): FileRef => ({ id: f.id, path: f.path, name: f.name, mime: f.mime });

/** A note's title: its first heading, else its file's name without the extension. */
export function titleOf(text: string, fileName: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(text)?.[1];
  return heading?.trim() || fileName.replace(/\.(md|markdown|txt)$/i, "");
}

/** `Groceries for Sunday` → `groceries-for-sunday.md`, a name that is safe on every device. */
export function fileNameFor(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "note"}.md`;
}

// ---- markdown, as React ----

/** Bold, italic, code and links inside one line. A link is only followed when it is http(s). */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let at = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const k = `${key}.${n++}`;
    const s = m[0];
    if (m[1]) out.push(<code key={k}>{s.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{s.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={k}>{s.slice(1, -1)}</em>);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(s)!;
      out.push(
        /^https?:\/\//i.test(href!) ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    }
    at = m.index + s.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Headings, paragraphs, lists, quotes and code blocks: enough for notes, and nothing executable. */
export function renderMarkdown(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  const key = () => `b${blocks.length}`;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
      i++;
      blocks.push(<pre key={key()}>{code.join("\n")}</pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1]!.length + 1, 6);
      const H = `h${level}` as "h2";
      blocks.push(<H key={key()}>{inline(heading[2]!.replace(/\s*#+\s*$/, ""), key())}</H>);
      i++;
      continue;
    }
    const listItem = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
    if (listItem.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      for (; i < lines.length && listItem.test(lines[i]!); i++) {
        const [, , body] = listItem.exec(lines[i]!)!;
        const done = /^\[([ xX])\]\s+/.exec(body!);
        items.push(<li key={`${key()}.${items.length}`}>{done ? <>{done[1] === " " ? "☐ " : "☑ "}{inline(body!.slice(done[0].length), key())}</> : inline(body!, key())}</li>);
      }
      blocks.push(ordered ? <ol key={key()}>{items}</ol> : <ul key={key()}>{items}</ul>);
      continue;
    }
    if (line.startsWith(">")) {
      const quoted: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith(">"); i++) quoted.push(lines[i]!.replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key()}>{inline(quoted.join(" "), key())}</blockquote>);
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]!); i++) para.push(lines[i]!.trim());
    blocks.push(<p key={key()}>{inline(para.join(" "), key())}</p>);
  }
  return blocks;
}

// ---- what the app does ----

async function importNotes(ctx: Ctx): Promise<void> {
  const files = await ctx.files.import({ folder: FOLDER, accept: ACCEPT, multiple: true });
  for (const f of files) {
    const text = (await ctx.files.text(f)) ?? "";
    await ctx.create("note", { title: titleOf(text, f.name), doc: refOf(f) });
  }
  if (files.length) ctx.ui.toast(files.length === 1 ? "Added 1 note" : `Added ${files.length} notes`);
}

async function newNote(ctx: Ctx): Promise<void> {
  const title = (await ctx.ui.prompt("What is the note called?"))?.trim();
  if (!title) return;
  const taken = new Set((await ctx.files.list(FOLDER)).map((f) => f.name));
  let name = fileNameFor(title);
  for (let n = 2; taken.has(name); n++) name = fileNameFor(`${title} ${n}`);
  const file = await ctx.files.write(`${FOLDER}/${name}`, `# ${title}\n\n`, { mime: "text/markdown" });
  const note = await ctx.create("note", { title, doc: refOf(file) });
  ctx.navigate("note", { noteId: note.id });
}

/** Writing a note is its own screen (the editor page), not a box in a dialog. */
async function editNote(n: Resolved, ctx: Ctx): Promise<void> {
  const doc = n.doc as FileRef | null;
  if (doc && (await ctx.files.text(doc)) === null) return ctx.ui.toast("This note has not reached this device yet. Try again in a moment.");
  ctx.navigate("edit", { noteId: String(n.id) });
}

/** The note's text, written where its file is NOW (it may have been renamed since the note pointed at
 *  it). Replacing a file keeps its id, so `doc` still points at it; the title follows the first heading. */
export async function saveNote(n: Resolved, text: string, ctx: Ctx): Promise<void> {
  const doc = n.doc as FileRef | null;
  const current = doc ? await ctx.files.stat(doc) : null;
  const path = current?.path ?? `${FOLDER}/${fileNameFor(String(n.title))}`;
  const file = await ctx.files.write(path, text, { mime: "text/markdown" });
  await ctx.patch("note", n.id, { title: titleOf(text, file.name), doc: refOf(file) });
}

// ---- the editor's marks ----

export type Mark = "bold" | "italic" | "code" | "link" | "heading" | "bullets" | "numbers" | "tasks" | "quote";

/** Where the text and the selection are, before and after a mark. */
export interface Edit {
  text: string;
  start: number;
  end: number;
}

const WRAP: Record<"bold" | "italic" | "code", string> = { bold: "**", italic: "*", code: "`" };
const LINE: Record<"bullets" | "numbers" | "tasks" | "quote", RegExp> = {
  bullets: /^(\s*)[-*+] (?!\[[ xX]\] )/,
  numbers: /^(\s*)\d+[.)] /,
  tasks: /^(\s*)[-*+] \[[ xX]\] /,
  quote: /^(\s*)> ?/,
};
/** Any mark a line may start with: a heading, a list item, a task, a quote. */
const ANY_LINE = /^(\s*)(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)/;

/**
 * `mark` applied to the selection `[start, end)` of `text`: wrapped, or each of its lines prefixed —
 * and taken off again when it is already there, so every button is a switch. Pure, so the editor's
 * buttons and keys are one function and the tests can read it.
 */
export function applyMark(e: Edit, mark: Mark): Edit {
  const { text } = e;
  const start = Math.min(e.start, e.end);
  const end = Math.max(e.start, e.end);
  if (mark === "bold" || mark === "italic" || mark === "code") {
    const w = WRAP[mark];
    const picked = text.slice(start, end);
    const before = text.slice(start - w.length, start);
    const after = text.slice(end, end + w.length);
    if (before === w && after === w && (mark !== "italic" || text.slice(start - 2, start) !== "**" || picked.length > 0)) {
      // Already wrapped: unwrap.
      return { text: text.slice(0, start - w.length) + picked + text.slice(end + w.length), start: start - w.length, end: end - w.length };
    }
    if (picked.startsWith(w) && picked.endsWith(w) && picked.length >= 2 * w.length) {
      const inner = picked.slice(w.length, -w.length);
      return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
    }
    return { text: text.slice(0, start) + w + picked + w + text.slice(end), start: start + w.length, end: end + w.length };
  }
  if (mark === "link") {
    const picked = text.slice(start, end);
    if (picked) {
      // The address is what is selected next, ready to be typed over.
      const out = `[${picked}](url)`;
      return { text: text.slice(0, start) + out + text.slice(end), start: start + picked.length + 3, end: start + picked.length + 6 };
    }
    const out = "[text](url)";
    return { text: text.slice(0, start) + out + text.slice(end), start: start + 1, end: start + 5 };
  }
  // Line marks: every line the selection touches.
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEndAt = text.indexOf("\n", Math.max(end, start) - (end > start ? 1 : 0));
  const lineEnd = lineEndAt === -1 ? text.length : lineEndAt;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  let changed: string[];
  if (mark === "heading") {
    // One button, three levels, then none: "# " → "## " → "### " → plain.
    const level = /^(#{1,6}) /.exec(lines[0]!)?.[1].length ?? 0;
    const next = level >= 3 ? 0 : level + 1;
    changed = lines.map((l) => (next ? `${"#".repeat(next)} ` : "") + l.replace(/^#{1,6} /, ""));
  } else {
    const re = LINE[mark];
    const all = lines.every((l) => re.test(l) || !l.trim());
    changed = lines.map((l, i) => {
      if (!l.trim() && lines.length > 1) return l;
      const bare = l.replace(ANY_LINE, "$1");
      if (all) return bare;
      const prefix = mark === "bullets" ? "- " : mark === "numbers" ? `${i + 1}. ` : mark === "tasks" ? "- [ ] " : "> ";
      return bare.replace(/^(\s*)/, `$1${prefix}`);
    });
  }
  const block = changed.join("\n");
  const delta = block.length - (lineEnd - lineStart);
  const out = text.slice(0, lineStart) + block + text.slice(lineEnd);
  // The selection follows the text: the same lines, now marked.
  const newStart = start === lineStart ? lineStart : Math.max(lineStart, start + (changed[0]!.length - lines[0]!.length));
  return { text: out, start: Math.min(newStart, out.length), end: Math.max(newStart, end + delta) };
}

/** What a key does in the editor, or null: B, I, K (link), E (code) with Ctrl or ⌘; Ctrl/⌘+S saves. */
export function markForKey(key: string, mod: boolean): Mark | "save" | null {
  if (!mod) return null;
  switch (key.toLowerCase()) {
    case "b":
      return "bold";
    case "i":
      return "italic";
    case "k":
      return "link";
    case "e":
      return "code";
    case "s":
      return "save";
    default:
      return null;
  }
}

const TOOLS: Array<{ mark: Mark; label: string; title: string }> = [
  { mark: "bold", label: "B", title: "Bold (Ctrl+B)" },
  { mark: "italic", label: "I", title: "Italic (Ctrl+I)" },
  { mark: "heading", label: "H", title: "Heading" },
  { mark: "bullets", label: "•", title: "Bulleted list" },
  { mark: "numbers", label: "1.", title: "Numbered list" },
  { mark: "tasks", label: "☑", title: "Checklist" },
  { mark: "quote", label: "❝", title: "Quote" },
  { mark: "code", label: "<>", title: "Code (Ctrl+E)" },
  { mark: "link", label: "🔗", title: "Link (Ctrl+K)" },
];

const EDITOR_CSS = `
.mn-edit { display: flex; flex-direction: column; height: 100dvh; max-height: 100%; min-height: 0; background: var(--paper, #faf7f1); color: var(--ink, #2b241e); }
.mn-head { flex: none; background: var(--surface, #fff); border-bottom: 1px solid var(--line, #e2dcd2); }
.mn-row { display: flex; align-items: center; gap: 0.3rem; padding: 0.35rem 0.6rem; overflow-x: auto; scrollbar-width: none; }
.mn-row::-webkit-scrollbar { display: none; }
/* The shell's own way out of full screen sits at the top right: the first row leaves it room. */
.mn-actions { padding-right: 3.4rem; border-bottom: 1px solid color-mix(in oklab, var(--line, #e2dcd2) 60%, transparent); }
.mn-row button { flex: none; min-width: 2.4rem; height: 2.4rem; padding: 0 0.6rem; border: 1px solid var(--line, #e2dcd2); border-radius: 0.6rem; background: var(--surface, #fff); color: inherit; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.mn-row button:active { transform: scale(0.95); }
.mn-row button:disabled { opacity: 0.45; cursor: default; }
.mn-row button[aria-pressed="true"] { background: var(--ink, #2b241e); color: var(--surface, #fff); border-color: transparent; }
.mn-row .mn-i { font-style: italic; font-family: Georgia, serif; }
.mn-row .mn-code { font-family: ui-monospace, monospace; font-weight: 600; }
.mn-row .mn-gap { flex: 1; min-width: 0.5rem; }
.mn-row .mn-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; padding-right: 0.4rem; }
.mn-row .mn-save { background: var(--accent, #2b241e); color: var(--on-accent, #fff); border-color: transparent; }
.mn-text { flex: 1; min-height: 0; width: 100%; margin: 0; padding: 1rem calc(1rem + var(--k-safe-right, 0px)) calc(1rem + var(--k-safe-bottom, 0px)) calc(1rem + var(--k-safe-left, 0px)); border: 0; outline: 0; resize: none; background: transparent; color: inherit; font: 1.05rem/1.6 var(--font-ui, system-ui, sans-serif); box-sizing: border-box; }
.mn-preview { flex: 1; min-height: 0; overflow: auto; padding: 0 1rem 2rem; max-width: 44rem; width: 100%; margin: 0 auto; box-sizing: border-box; line-height: 1.55; }
.mn-wait { padding: 1rem; }
`;

/** The note's text, the whole screen: a bar of marks above, the text below, Preview to read it as it will show. */
function NoteEditor({ runtime, param, navigate }: ViewProps) {
  const ctx = runtime.ctx;
  const { record, loading } = runtime.useRecord("note", param?.noteId ?? "");
  const doc = (record?.doc ?? null) as FileRef | null;
  const [initial, setInitial] = useState<string | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // The selection to restore after a mark: set with the text, applied once the textarea has it.
  const pending = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    let live = true;
    if (!doc) {
      setInitial("");
      setText("");
      return;
    }
    ctx.files.text(doc).then(
      (t) => {
        if (!live) return;
        setInitial(t);
        setText(t ?? "");
      },
      () => live && setInitial(""),
    );
    return () => {
      live = false;
    };
  }, [doc?.id]);

  useEffect(() => {
    const sel = pending.current;
    const el = area.current;
    if (!sel || !el) return;
    pending.current = null;
    el.focus();
    el.setSelectionRange(sel.start, sel.end);
  }, [text]);

  const back = () => navigate("note", { noteId: param?.noteId ?? "" });
  const dirty = initial != null && text !== initial;

  const mark = (m: Mark) => {
    const el = area.current;
    if (!el) return;
    const next = applyMark({ text, start: el.selectionStart, end: el.selectionEnd }, m);
    pending.current = { start: next.start, end: next.end };
    setText(next.text);
  };
  const save = async () => {
    if (!record || saving) return;
    setSaving(true);
    try {
      await saveNote(record, text, ctx);
      back();
    } catch (e) {
      setSaving(false);
      ctx.ui.toast(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const cancel = async () => {
    if (dirty && !(await ctx.ui.confirm("Leave without saving?", { detail: "What you changed here will be lost.", ok: "Leave", destructive: true }))) return;
    back();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const what = markForKey(e.key, e.ctrlKey || e.metaKey);
    if (!what) return;
    e.preventDefault();
    if (what === "save") void save();
    else mark(what);
  };

  if (loading || initial === undefined) return <p className="mn-wait">Opening…</p>;
  if (!record) return <p className="mn-wait">This note is gone.</p>;
  if (initial === null) return <p className="mn-wait">This note has not reached this device yet.</p>;
  return (
    <div className="mn-edit">
      <style>{EDITOR_CSS}</style>
      <div className="mn-head">
        <div className="mn-row mn-actions">
          <button type="button" onClick={() => void cancel()}>
            Cancel
          </button>
          <span className="mn-title">{String(record.title)}</span>
          <button type="button" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
            Preview
          </button>
          <button type="button" className="mn-save" disabled={!dirty || saving} onClick={() => void save()}>
            Save
          </button>
        </div>
        <div className="mn-row" role="toolbar" aria-label="Markdown">
          {TOOLS.map((t) => (
            <button key={t.mark} type="button" title={t.title} aria-label={t.title} className={t.mark === "italic" ? "mn-i" : t.mark === "code" ? "mn-code" : undefined} disabled={preview} onMouseDown={(e) => e.preventDefault()} onClick={() => mark(t.mark)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {preview ? (
        <div className="mn-preview">{text.trim() ? renderMarkdown(text) : <p>Nothing written yet.</p>}</div>
      ) : (
        <textarea ref={area} className="mn-text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label="Note text" autoFocus spellCheck />
      )}
    </div>
  );
}

// ---- reading a note ----

function NoteView({ runtime, param, navigate }: ViewProps) {
  const ctx = runtime.ctx;
  const { record, loading } = runtime.useRecord("note", param?.noteId ?? "");
  const doc = (record?.doc ?? null) as FileRef | null;
  // undefined: reading; null: the bytes are not on this device yet.
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!doc) return void setText("");
    setText(undefined);
    ctx.files.text(doc).then(
      (t) => live && setText(t),
      () => live && setText(""),
    );
    return () => {
      live = false;
    };
  }, [doc?.id, record?.updatedAt]);

  if (loading) return <p>Loading…</p>;
  if (!record) return <p>This note is gone.</p>;
  const run = (action: string) => () => void runtime.runAction("note", action, record.id);
  return (
    <article style={{ maxWidth: "44rem", margin: "0 auto", padding: "0 1rem 2rem", lineHeight: 1.55 }}>
      <nav style={{ display: "flex", gap: "0.5rem", margin: "0.75rem 0" }}>
        <button type="button" onClick={() => navigate("notes")}>
          ‹ All notes
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={run("edit")}>
          Edit
        </button>
        <button type="button" onClick={run("saveCopy")}>
          Save a copy
        </button>
      </nav>
      {text === undefined ? <p>Opening…</p> : text === null ? <p>This note has not reached this device yet.</p> : text.trim() ? renderMarkdown(text) : <p>Nothing written yet. Tap Edit.</p>}
    </article>
  );
}

export default defineApp({
  id: "markdown-notes",
  name: "Notes",
  icon: "📝",
  version: "1.0.0",
  schemaVersion: 1,
  category: "notes",
  entities: {
    note: {
      label: "Note",
      icon: "📝",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        doc: { type: "file", accept: ACCEPT, folder: FOLDER, label: "File" },
      },
      actions: {
        edit: editNote,
        saveCopy: async (n, ctx) => {
          const doc = n.doc as FileRef | null;
          if (doc) await ctx.files.export(doc);
        },
      },
    },
  },
  pages: [
    {
      id: "notes",
      title: "Notes",
      actions: [
        { label: "New note", icon: "＋", run: newNote },
        { label: "Bring notes in", icon: "⤓", run: importNotes },
      ],
      view: {
        type: "list",
        entity: "note",
        display: { primary: "title", secondary: (n) => (n.doc as FileRef | null)?.name ?? "" },
        sort: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
        emptyText: "No notes yet. Bring .md files in, or start a new one.",
        onOpen: { page: "note", param: { noteId: "id" } },
      },
    },
    { id: "note", title: "Note", hidden: true, view: { type: "custom", entity: "note", param: "noteId", render: (props) => <NoteView {...props} /> } },
    // Writing takes the whole screen: no bars, a toolbar of marks, the text underneath.
    { id: "edit", title: "Edit note", hidden: true, fullscreen: true, view: { type: "custom", entity: "note", param: "noteId", render: (props) => <NoteEditor {...props} /> } },
  ],
});
