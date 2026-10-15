// Receipt Split: photograph a receipt, and its lines become items you can split (docs/23).
//
// The smallest app that shows `ctx.caps.ai`: one page action picks a photo, `extract` reads it into a
// plain shape — validated by the host before the app sees it — and each line becomes a record. The
// photo goes to the AI service and nothing else does: no record is ever passed.

import { defineApp, type AiValue, type Ctx } from "potyro";

/** What a receipt is read into. `price` comes back a number; a line without one is not an item. */
const RECEIPT = {
  shop: "text?",
  items: [{ name: "text", price: "number" }],
} as const;

type Receipt = AiValue<typeof RECEIPT>;

async function readReceipt(ctx: Ctx): Promise<void> {
  const ai = ctx.caps.ai;
  if (!ai) {
    ctx.ui.toast("AI isn't available here.");
    return;
  }
  const [photo] = await ctx.files.import({ folder: "receipts", accept: "image/*" });
  if (!photo) return; // the person closed the picker
  const bar = ctx.ui.progress("Reading the receipt…");
  let receipt: Receipt;
  try {
    receipt = await ai.extract({
      image: photo,
      instructions: "A shop or restaurant receipt. One item per line bought, with its final price. Skip totals, subtotals, tax, tips, discounts and payment lines.",
      schema: RECEIPT,
    });
  } finally {
    bar.done();
  }
  const shop = receipt.shop ?? "";
  for (const line of receipt.items) {
    await ctx.create("item", { name: line.name, price: Math.round(line.price * 100), shop, receipt: { id: photo.id, path: photo.path, name: photo.name, mime: photo.mime } });
  }
  const n = receipt.items.length;
  ctx.ui.toast(n === 0 ? "No items found on that receipt." : ctx.t({ en: "{n, plural, one {Added # item} other {Added # items}}" }, { n }));
}

export default defineApp({
  id: "receipt-split",
  name: "Receipt Split",
  icon: "🧾",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  permissions: { ai: true },
  entities: {
    item: {
      label: "Item",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        price: { type: "money" },
        shop: { type: "text" },
        who: { type: "text", label: "Who pays" },
        receipt: { type: "file", folder: "receipts" },
      },
    },
  },
  pages: [
    {
      id: "items",
      title: "Items",
      icon: "🧾",
      actions: [{ label: "Read a receipt", icon: "📷", run: readReceipt }],
      summary: [
        { label: "Items", op: "count" },
        { label: "Total", field: "price", op: "sum" },
      ],
      view: {
        type: "list",
        entity: "item",
        display: { primary: "name", secondary: (r, ctx) => [ctx.format.money(Number(r.price ?? 0)), r.who ? `· ${r.who}` : ""].join(" ").trim() },
        emptyText: "Tap “Read a receipt” and choose a photo of one.",
      },
    },
  ],
});
