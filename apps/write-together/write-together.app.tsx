// Write Together — a markdown document several people type into at once, each in their own
// colour, with comments pinned to the words (an Etherpad for Potyro).
//
// The document's text is a `text` field declared `collaborative: true` (docs/04 "Writing
// together"): Potyro's own CRDT keeps everyone's keystrokes, merges them, and remembers who typed
// what, so the editor (editor.tsx) sends what changed rather than the whole text, and reads the
// colours from the store rather than from anything a copy could claim. Sharing is the ordinary
// "Use it together": whoever has the app's space has the document, live, and Invite in the editor
// hands out the same link. Alone, it is simply a notebook; the words become shared the moment the
// app is.
//
// Comments are records anchored to characters (`ctx.text(...).anchor`), so they follow their
// words through everyone's edits. A writer's colour is a record too (`writer`), one per person and
// document. Both point at the document, so they go wherever it goes: a document is shared on its
// own (`share: "record"`, docs/24 §12) — its link, from Invite, brings one document and nothing else,
// to write in or only to read.
import { defineApp } from "potyro";
import type { Ctx, Resolved } from "potyro";
import { Editor } from "./editor.js";
import { W } from "./words.js";

/**
 * The first line of a document that says more than its title, for the list: never a heading (the
 * title says that), and read as words, not markdown — a list's dash, a quote's mark, bold and links
 * stripped.
 */
export function firstLine(body: unknown, title = ""): string {
  const text = typeof body === "string" ? body : "";
  const plain = (l: string) =>
    l
      .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`/g, (_m, a, b, c, d) => a ?? b ?? c ?? d)
      .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
      .trim();
  const line = text
    .split("\n")
    .filter((l) => !/^\s{0,3}#{1,6}\s/.test(l))
    .map(plain)
    .find((l) => l && l !== title.trim());
  return (line ?? "").slice(0, 120);
}

async function newDocument(ctx: Ctx): Promise<void> {
  const title = (await ctx.ui.prompt(ctx.t(W.newDocTitle)))?.trim();
  if (title === undefined) return;
  const doc = await ctx.create("doc", { title: title || ctx.t(W.untitled), body: "" });
  ctx.navigate("doc", { docId: String(doc.id) });
}

export default defineApp({
  id: "write-together",
  name: W.appName,
  icon: "users-round",
  version: "1.0.0",
  schemaVersion: 1,
  category: "notes",
  language: "en",
  theme: { accent: "#4761e4" },
  entities: {
    doc: {
      label: W.doc,
      icon: "file-text",
      displayField: "title",
      // Each document is shared by its own link, with its comments and writers (docs/24 §12).
      share: "record",
      fields: {
        title: { type: "text", required: true },
        // Several people type into it at once: edited with ctx.text, never saved whole.
        body: { type: "text", multiline: true, collaborative: true, hidden: true },
      },
    },
    comment: {
      label: W.comment,
      icon: "message-square",
      displayField: "text",
      fields: {
        doc: { type: "relation", to: "doc", required: true },
        text: { type: "text", multiline: true, required: true },
        // Where it is: anchors from ctx.text(...).anchor, which follow their characters.
        from: { type: "text", hidden: true },
        to: { type: "text", hidden: true },
        // The words it was about when it was written, for when they are gone.
        quote: { type: "text", hidden: true },
        done: { type: "boolean", default: false },
      },
    },
    writer: {
      label: W.writer,
      icon: "palette",
      displayField: "person",
      fields: {
        doc: { type: "relation", to: "doc", required: true },
        person: { type: "member", required: true },
        color: { type: "number", integer: true, min: 0, max: 7, required: true },
      },
    },
  },
  pages: [
    {
      id: "docs",
      title: W.docs,
      icon: "file-text",
      add: 0,
      actions: [{ label: W.newDoc, icon: "plus", run: newDocument }],
      view: {
        type: "list",
        entity: "doc",
        display: { primary: "title", secondary: (d: Resolved) => firstLine(d.body, String(d.title ?? "")) },
        sort: (a: Resolved, b: Resolved) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
        emptyText: W.emptyList,
        onOpen: { page: "doc", param: { docId: "id" } },
      },
    },
    // Writing takes the whole screen: the editor has its own top row and its way back.
    // A document's link lands here, on that document (docs/24 §12).
    { id: "doc", title: W.doc, hidden: true, fullscreen: true, link: { params: ["docId"] }, view: { type: "custom", entity: "doc", param: "docId", render: (props) => <Editor {...props} /> } },
  ],
});
