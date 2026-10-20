import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, Fragment } from "react";
import { checkReferences, isPotyroApp, structureSchema } from "potyro";
import type { FileInfo } from "potyro";
import app, { applyMark, fileNameFor, markForKey, renderMarkdown, saveNote, titleOf, type Edit } from "../notes.app.js";

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
      navigate: (_page: string, _param?: Record<string, string>) => {},
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

  it("Edit opens the editor screen for the note, and saving writes the same file and takes the new title from it", async () => {
    const { ctx, records, files } = fakeCtx([{ name: "trip.md", text: "# Lisbon" }]);
    const opened: Array<[string, Record<string, string> | undefined]> = [];
    ctx.navigate = (page: string, param?: Record<string, string>) => void opened.push([page, param]);
    await app.pages[0]!.actions!.find((a) => /Bring/.test(String(a.label)))!.run(ctx as never);
    const note = records[0]!;
    const edit = app.entities.note!.actions!.edit as (r: unknown, c: unknown) => Promise<void>;
    await edit(note, ctx);
    expect(opened).toEqual([["edit", { noteId: "r1" }]]);
    await saveNote(note as never, "# Lisbon and Porto\n\nfado", ctx as never);
    expect(files.get("notes/trip.md")!.text).toBe("# Lisbon and Porto\n\nfado");
    expect(note.title).toBe("Lisbon and Porto");
    expect((note.doc as { id: string }).id).toBe(files.get("notes/trip.md")!.info.id);
  });
});

// The editor's marks are one pure function: a button or a key wraps or prefixes the selection, and
// pressed again takes the mark off.
describe("the editor's marks", () => {
  const at = (text: string, start: number, end = start): Edit => ({ text, start, end });
  const picked = (e: Edit) => e.text.slice(e.start, e.end);

  it("wraps a selection in bold, and unwraps it again", () => {
    const bold = applyMark(at("buy milk", 4, 8), "bold");
    expect(bold.text).toBe("buy **milk**");
    expect(picked(bold)).toBe("milk");
    const plain = applyMark(bold, "bold");
    expect(plain.text).toBe("buy milk");
    expect(picked(plain)).toBe("milk");
  });

  it("with nothing selected, puts the cursor between the marks so typing lands inside", () => {
    const e = applyMark(at("buy ", 4), "italic");
    expect(e.text).toBe("buy **");
    expect(e.start).toBe(5);
    expect(e.end).toBe(5);
    expect(applyMark(at("x", 1), "code").text).toBe("x``");
  });

  it("makes a link of the selection and selects the address to type over", () => {
    const e = applyMark(at("see the site", 8, 12), "link");
    expect(e.text).toBe("see the [site](url)");
    expect(picked(e)).toBe("url");
    expect(picked(applyMark(at("", 0), "link"))).toBe("text");
  });

  it("prefixes every line the selection touches, and takes the prefix off again", () => {
    const list = applyMark(at("eggs\nmilk\nbread", 2, 12), "bullets");
    expect(list.text).toBe("- eggs\n- milk\n- bread");
    expect(applyMark(list, "bullets").text).toBe("eggs\nmilk\nbread");
    expect(applyMark(at("a\nb", 0, 3), "numbers").text).toBe("1. a\n2. b");
    expect(applyMark(at("a", 0), "tasks").text).toBe("- [ ] a");
    expect(applyMark(at("a", 0), "quote").text).toBe("> a");
  });

  it("swaps one line mark for another instead of stacking them", () => {
    expect(applyMark(at("- eggs", 3), "numbers").text).toBe("1. eggs");
    expect(applyMark(at("> said", 2), "tasks").text).toBe("- [ ] said");
  });

  it("steps a heading through three levels and back to plain text", () => {
    let e = applyMark(at("Plan", 2), "heading");
    expect(e.text).toBe("# Plan");
    e = applyMark(e, "heading");
    expect(e.text).toBe("## Plan");
    e = applyMark(e, "heading");
    expect(e.text).toBe("### Plan");
    expect(applyMark(e, "heading").text).toBe("Plan");
  });

  it("keeps the selection on the lines it marked", () => {
    const e = applyMark(at("one\ntwo", 0, 7), "quote");
    expect(picked(e)).toBe("> one\n> two");
  });

  it("knows its keys", () => {
    expect(markForKey("b", true)).toBe("bold");
    expect(markForKey("K", true)).toBe("link");
    expect(markForKey("s", true)).toBe("save");
    expect(markForKey("b", false)).toBeNull();
    expect(markForKey("z", true)).toBeNull();
  });
});
