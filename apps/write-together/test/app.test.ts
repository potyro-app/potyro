import { describe, expect, it } from "vitest";
import { checkReferences, isPotyroApp, structureSchema } from "potyro";
import app, { firstLine } from "../write-together.app.js";

describe("Write Together", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    const parsed = structureSchema.safeParse(app);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("keeps the document's words in a collaborative text, and comments anchored to it", () => {
    expect(app.entities.doc!.fields.body).toMatchObject({ type: "text", multiline: true, collaborative: true });
    expect(app.entities.comment!.fields).toMatchObject({ doc: { type: "relation", to: "doc" }, from: { type: "text" }, to: { type: "text" }, done: { type: "boolean" } });
    expect(app.entities.writer!.fields).toMatchObject({ person: { type: "member" }, color: { type: "number", min: 0, max: 7 } });
  });

  it("opens on the list of documents and writes on its own full screen", () => {
    const [docs, doc] = app.pages;
    expect(docs).toMatchObject({ id: "docs", add: 0, view: { type: "list", entity: "doc", onOpen: { page: "doc", param: { docId: "id" } } } });
    expect(doc).toMatchObject({ id: "doc", hidden: true, fullscreen: true, view: { type: "custom", entity: "doc", param: "docId" } });
  });

  it("lists a document by its first line that says more than the title", () => {
    expect(firstLine("# Plan\n\n- buy milk")).toBe("Plan");
    expect(firstLine("# Plan\n\n- buy milk", "Plan")).toBe("buy milk");
    expect(firstLine("\n\n- buy milk\nmore")).toBe("buy milk");
    expect(firstLine("")).toBe("");
    expect(firstLine(null)).toBe("");
  });
});
