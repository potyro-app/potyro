import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, Fragment } from "react";
import { checkReferences, isPotyroApp, structureSchema } from "potyro";
import type { FileInfo } from "potyro";
import app, { fileNameFor, renderMarkdown, titleOf } from "../notes.app.js";

const html = (md: string): string => renderToStaticMarkup(createElement(Fragment, null, ...renderMarkdown(md)));

describe("markdown notes", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("titles a note by its first heading, else by its file", () => {
    expect(titleOf("intro\n\n## Trip to Lisbon ##\n", "x.md")).toBe("Trip to Lisbon");
    expect(titleOf("no heading here", "packing-list.md")).toBe("packing-list");
  });

  it("names a new note's file safely", () => {
    expect(fileNameFor("Café: plans for Sunday!")).toBe("cafe-plans-for-sunday.md");
    expect(fileNameFor("???")).toBe("note.md");
  });

  it("draws headings, lists, quotes, code and inline marks", () => {
    const out = html("# Plan\n\nBuy **milk** and *eggs*, see `list`.\n\n- [x] bread\n- [ ] jam\n\n1. one\n2. two\n\n> quoted\n\n```\nraw <b>\n```");
    expect(out).toContain("<h2>Plan</h2>");
    expect(out).toContain("<p>Buy <strong>milk</strong> and <em>eggs</em>, see <code>list</code>.</p>");
    expect(out).toContain("<ul><li>☑ bread</li><li>☐ jam</li></ul>");
    expect(out).toContain("<ol><li>one</li><li>two</li></ol>");
    expect(out).toContain("<blockquote>quoted</blockquote>");
    expect(out).toContain("<pre>raw &lt;b&gt;</pre>");
  });

  it("never puts the file's HTML or a script link on the page", () => {
    const out = html('<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) and [site](https://example.com)');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(out).not.toContain("javascript:");
    expect(out).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>');
  });
});

describe("its actions, over a folder", () => {
  /** Just enough of ctx: a folder in a Map, records in an array, and a person who answers. */
  function fakeCtx(picked: Array<{ name: string; text: string }>, answer: string | null = null) {
    const files = new Map<string, { info: FileInfo; text: string }>();
    const records: Array<Record<string, unknown>> = [];
    let n = 0;
    const write = async (path: string, text: string): Promise<FileInfo> => {
      const prior = files.get(path)?.info;
      const info: FileInfo = { id: prior?.id ?? `f${++n}`, path, name: path.split("/").pop()!, mime: "text/markdown", size: text.length, hash: "", origin: "app", created: "", updated: "" };
      files.set(path, { info, text });
      return info;
    };
    const byRef = (ref: { id: string }) => [...files.values()].find((f) => f.info.id === ref.id);
    const ctx = {
      files: {
        import: async (o: { folder?: string }) => Promise.all(picked.map((p) => write(`${o.folder}/${p.name}`, p.text))),
        text: async (ref: { id: string }) => byRef(ref)?.text ?? null,
        stat: async (ref: { id: string }) => byRef(ref)?.info ?? null,
        list: async () => [...files.values()].map((f) => f.info),
        write,
      },
      create: async (_e: string, data: Record<string, unknown>) => {
        const r = { id: `r${records.length + 1}`, ...data };
        records.push(r);
        return r;
      },
      patch: async (_e: string, id: string, data: Record<string, unknown>) => Object.assign(records.find((r) => r.id === id)!, data),
      ui: { toast: () => {}, form: async () => (answer === null ? null : { text: answer }), prompt: async () => answer },
      navigate: () => {},
    };
    return { ctx, files, records };
  }

  it("brings .md files in as notes, titled by their headings", async () => {
    const { ctx, records } = fakeCtx([
      { name: "trip.md", text: "# Lisbon\n\npastéis" },
      { name: "todo.md", text: "- milk" },
    ]);
    const bring = app.pages[0]!.actions!.find((a) => /Bring/.test(String(a.label)))!;
    await bring.run(ctx as never);
    expect(records.map((r) => [r.title, (r.doc as { path: string }).path])).toEqual([
      ["Lisbon", "notes/trip.md"],
      ["todo", "notes/todo.md"],
    ]);
  });

  it("saves an edit into the same file, and takes the new title from it", async () => {
    const { ctx, records, files } = fakeCtx([{ name: "trip.md", text: "# Lisbon" }], "# Lisbon and Porto\n\nfado");
    await app.pages[0]!.actions!.find((a) => /Bring/.test(String(a.label)))!.run(ctx as never);
    const note = records[0]!;
    const edit = app.entities.note!.actions!.edit as (r: unknown, c: unknown) => Promise<void>;
    await edit(note, ctx);
    expect(files.get("notes/trip.md")!.text).toBe("# Lisbon and Porto\n\nfado");
    expect(note.title).toBe("Lisbon and Porto");
    expect((note.doc as { id: string }).id).toBe(files.get("notes/trip.md")!.info.id);
  });
});
