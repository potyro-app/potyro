import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, fieldValueProblem, isPotyroApp, structureSchema, type Ctx } from "potyro";
import app from "../receipt-split.app.js";

const source = readFileSync(new URL("../receipt-split.app.ts", import.meta.url), "utf8");

/** Just enough ctx for the page action: a picked photo, a scripted AI, and what it writes. */
function fakeCtx(answer: unknown, opts: { ai?: boolean; picked?: boolean } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const toasts: string[] = [];
  const asked: unknown[] = [];
  const photo = { id: "f1", path: "receipts/r.jpg", name: "r.jpg", mime: "image/jpeg", size: 3, hash: "h", origin: "imported", created: "", updated: "" };
  const ctx = {
    caps: opts.ai === false ? {} : { ai: { extract: async (req: unknown) => (asked.push(req), answer), ask: async () => "" } },
    files: { import: async () => (opts.picked === false ? [] : [photo]) },
    ui: { toast: (m: string) => toasts.push(m), progress: () => ({ update: () => {}, done: () => {} }) },
    t: (_w: unknown, vars: { n: number }) => `Added ${vars.n} items`,
    create: async (_e: string, data: Record<string, unknown>) => (created.push(data), data),
  } as unknown as Ctx;
  return { ctx, created, toasts, asked, photo };
}

const read = app.pages[0]!.actions![0]!.run;

describe("Receipt Split", () => {
  it("is a valid app that declares AI and reaches it only through ctx", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
    expect(app.permissions).toEqual({ ai: true });
    expect(source).toContain("ctx.caps.ai");
    expect(source).not.toMatch(/fetch\(|openrouter/i);
  });

  it("reads a photo into items, prices in minor units, and sends the photo and nothing else", async () => {
    const { ctx, created, toasts, asked, photo } = fakeCtx({ shop: "Żabka", items: [{ name: "Mleko", price: 4.99 }, { name: "Chleb", price: 6.5 }] });
    await read(ctx);
    expect(created).toEqual([
      { name: "Mleko", price: 499, shop: "Żabka", receipt: { id: "f1", path: "receipts/r.jpg", name: "r.jpg", mime: "image/jpeg" } },
      { name: "Chleb", price: 650, shop: "Żabka", receipt: { id: "f1", path: "receipts/r.jpg", name: "r.jpg", mime: "image/jpeg" } },
    ]);
    expect(toasts).toEqual(["Added 2 items"]);
    expect(Object.keys(asked[0] as object).sort()).toEqual(["image", "instructions", "schema"]);
    expect((asked[0] as { image: unknown }).image).toBe(photo);
  });

  it("does nothing when the picker is closed, and says so when there is no AI", async () => {
    const closed = fakeCtx({ items: [] }, { picked: false });
    await read(closed.ctx);
    expect(closed.asked).toEqual([]);
    const none = fakeCtx({ items: [] }, { ai: false });
    await read(none.ctx);
    expect(none.toasts).toEqual(["AI isn't available here."]);
  });
});

describe("its sample receipt", () => {
  // The package's seed.json: what a new copy starts with, and what a demo link of it opens on (docs/24 §3).
  it("ships a seed whose every value fits its field", () => {
    const seed = JSON.parse(readFileSync(new URL("../seed.json", import.meta.url), "utf8")) as Record<string, Array<Record<string, unknown>>>;
    expect(Object.keys(seed)).toEqual(["item"]);
    const fields = app.entities.item!.fields;
    expect(seed.item!.length).toBeGreaterThan(2);
    for (const row of seed.item!) {
      for (const [key, value] of Object.entries(row)) {
        expect(fields[key], key).toBeDefined();
        expect(fieldValueProblem(fields[key]!, value, "write", key), `${key}=${JSON.stringify(value)}`).toBeNull();
      }
    }
  });
});
