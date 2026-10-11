// Sample records must point at each other the way real ones do (#262).
//
// The smoke run seeded a relation only when it was a field of its own. A relation INSIDE a list row
// — a recipe's `ingredients: [{ ingredient, quantity }]`, an invoice's lines, a workout's sets — was
// left out, so every row's reference was undefined and every computed or filter that followed it
// threw. Those failures were the harness's, not the app's; the Studio's run gate then refused a
// change to recipes that never touched them. Shapes below are generic on purpose: what matters is a
// relation in a list row, at any name.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineApp } from "potyro";
import { smokeApp, smokeReport } from "../src/smoke.js";
import { loadApp } from "../src/score.js";

const orders = defineApp({
  id: "orders",
  name: "Orders",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    product: { label: "Product", displayField: "name", fields: { name: { type: "text", required: true }, price: { type: "number" } } },
    customer: { label: "Customer", displayField: "name", fields: { name: { type: "text", required: true } } },
    order: {
      label: "Order",
      displayField: "ref",
      fields: {
        ref: { type: "text", required: true },
        customer: { type: "relation", to: "customer", required: true },
        lines: {
          type: "list",
          of: {
            item: { type: "relation", to: "product", required: true },
            extras: { type: "relation", to: "product", many: true },
            qty: { type: "number", required: true },
          },
        },
      },
      computed: {
        total: (o: { lines: Array<{ item: { price?: number }; qty: number }> }) => o.lines.reduce((n, l) => n + (l.item.price ?? 0) * l.qty, 0),
        extrasNamed: (o: { lines: Array<{ extras: Array<{ name: string }> }> }) => o.lines.flatMap((l) => l.extras.map((e) => e.name)).join(", "),
        who: (o: { customer: { name: string } }) => o.customer.name,
      },
    },
  },
  pages: [
    {
      id: "with-items",
      title: "With items",
      view: {
        type: "list",
        entity: "order",
        filter: (o: { lines: Array<{ item: { id: string } }> }) => o.lines.every((l) => typeof l.item.id === "string"),
        display: { primary: "ref" },
      },
    },
  ],
} as never);

describe("seeding relations", () => {
  it("fills relations inside list rows, single and many, so the app's own logic can follow them", async () => {
    const report = smokeReport(await smokeApp(orders as never));
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("runs the recipes example as it ships without failures of its own making", async () => {
    const dir = fileURLToPath(new URL("../../../examples/", import.meta.url));
    const app = await loadApp(readFileSync(`${dir}recipes.app.tsx`, "utf8"), dir);
    expect(smokeReport(await smokeApp(app as never)).errors).toEqual([]);
  });
});
