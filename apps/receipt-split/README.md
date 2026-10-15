# Receipt Split

Photograph a receipt and its lines become items: name, price, the shop. Then say who pays for what.

It is the smallest app that uses AI (`ctx.caps.ai`, docs/23): one page action, **Read a receipt**,
picks a photo (`ctx.files.import`), and `ctx.caps.ai.extract` reads it into a plain shape —

```ts
const RECEIPT = { shop: "text?", items: [{ name: "text", price: "number" }] } as const;
const receipt = await ctx.caps.ai.extract({ image: photo, instructions: "A shop receipt…", schema: RECEIPT });
```

— which the host checks before the app sees it: `price` is always a number, a missing shop is
`null`, and an answer that does not fit is asked for again once, then refused. The app turns each
line into a record (prices in minor units, as a `money` field keeps them).

Only the photo and the app's instructions are sent. No record is ever passed to the AI.

```
receipt-split.app.ts   the app: one entity, one page, the action that reads a receipt
test/                  its shape, and the action against a scripted AI
```

**Permission.** It declares `permissions: { ai: true }`. Shared with someone, it asks them first —
"“Receipt Split” wants to send a photo to an AI service (OpenRouter) to read it." — and AI can be
turned off for it in Edit tile. Who pays: the free allowance first, then the person's own OpenRouter
key (Model settings).
