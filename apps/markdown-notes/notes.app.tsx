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
import { useEffect, useState, type ReactNode } from "react";

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

async function editNote(n: Resolved, ctx: Ctx): Promise<void> {
  const doc = n.doc as FileRef | null;
  const text = doc ? await ctx.files.text(doc) : "";
  if (text === null) return ctx.ui.toast("This note has not reached this device yet. Try again in a moment.");
  const answer = await ctx.ui.form<{ text: string }>({
    title: `Edit: ${String(n.title)}`,
    fields: { text: { type: "text", multiline: true, label: "Text" } },
    initial: { text },
    submit: "Save",
  });
  if (!answer) return;
  // Written where the file is NOW (it may have been renamed since the note pointed at it). Replacing a
  // file keeps its id, so `doc` still points at it.
  const current = doc ? await ctx.files.stat(doc) : null;
  const path = current?.path ?? `${FOLDER}/${fileNameFor(String(n.title))}`;
  const file = await ctx.files.write(path, answer.text, { mime: "text/markdown" });
  await ctx.patch("note", n.id, { title: titleOf(answer.text, file.name), doc: refOf(file) });
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
  ],
});
