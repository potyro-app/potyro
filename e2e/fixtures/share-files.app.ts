// `ctx.ui.share({ files })` (docs/04 §Share): a card's picture — a Blob the app made, and the same
// picture kept in the app's folder beside a small CSV — handed to the share dialog. Installed trusted
// and sealed by the specs, so the files are checked crossing the realm too.

import { defineApp } from "potyro";

/** A 120×90 palette card, five colour bands (a PNG made once, kept as base64). */
const CARD =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAABaCAIAAAD8YgW4AAAFOklEQVR42u3QV1eTBxzA4f/ncTDyZge1rqq9qgMHyBIBGaIy3bWVoQjIRpZ7t7Z2OdhLViCEMEIYYTpw167b8gnKze943pOTc55P8Mj8vQBE+75ViJyrRxHarxIR/35wI2TurgXRFhGAOH8lHaFsOYj45/0kwhv9uaJn71gQrREBCLVF//1uAqG66HOX0xGqi565Y0Fw0WkIZUsC4q+34wiZuW1BtIQHIDw2evq2BYFF16QhlM0JiD/fjCGw6ObwAER2TRpCddFTt8yI5nALIrsmFUFFf3o9hlBfdHUqQrM5HvHptQsh7ltmRFOYBZFVnYqgov9YcCHEfdOM8NzoUQQW3RhmQWRVpSCo6I+vRhEyedOMUF30pjjEx1dOhEzeMCOo6MyqFAQV/eGlEyETN8yIhlALIrMyBcFFjyAWo02IhlAzIrMyGUFFv38xgpDx6yZEfagZ4Y3+TNEZFckIzaZYxLvnwwgZu25CqC3af1Msgou+ZkLUhZgRGRVJCP8vYxFv54cQ4rpmQlDRZy8lITw2ujbEjOCiDyDezA8ixHXVhPDY6LlBhIxeNSFqQxhqi34950AsRhsRT/eaEN+VH0Fg0bMOhDivGBGeGr0w60B4bvTGGMTCzABCRq4YEU/2mhDflh1B+G2MQbyaGUDIyGUjgos+jMCip+0IGb5sRDwONiHUFv1y2o5QX3TpYYTfxmjEy6l+hAzVGBGPgxlnSg8jqOgXU/2IxWgD4lGwEXGm9BDCb0M04oXbhlBfdMkhBBX93G1DyGC1AfF7kBGhuuhJG0J10d+UHEL4bYhCzE/2IcRRbUBg0cWJCCx6og8hjioD4rcgI4KK9t0QhZib6EXIQJUBQUWfLk5EYNHjvQgs+tc9jNNFiQjf9fsRs+NWhNgr9Qgu+iACix6zIrzRS5gZ60FIf6Ue8cseA+JU4UEEFu3qQUh/hR7hqdHTrh4EFv3zbgPiVGECwnd9JGLa1Y0QW4UegUUXJCCo6KnRboTYLukRVPTJggSE77pIxNRoF0L6LukRD3cbEFS0z7pIhNvZhViM1iEe7tYjThbEI3zW7UO4nZ0I6S3XIajoExfjEVT05EgnAov+aZceob7oDoRYy3UIT42eGO5AiLVMh/hxlx5xIj8eobronjIdgoo+nh+H8FkbgRgfeobwRn+26FId4sFOPeJ4XhyCih4bbEdId6kO8WAn41heHGLl2ggEGK1F/LBThziWF4ugol2ONoR0lWgRWHRuLGLl2nCEN3qp6C/CEaMDrQjpLNEivg/UIY7mxiLUF12sRWDRFw4gqGinvRUhHcVaxP1AHYKLDkM47S0Ib/QSRvpbEPKsSIu4H8hIzzmA4KKbEYvRCuLeDi0iPScGQUUP25oR0l6kINQWvWJNGGLY1oSQ9kIFcXeHFpF2PgaxYk0oYsjWhPBGLxXd14iQtkIFwUVHI6jowb5GhLQVKIg727WItHPRCCy6txEhrQUKgopOPReNWLEmBOHobUBI60UFcXs7Q3XR1gaEtFxUEKqLXh2CGLDWIxajNQgsOjsKgUX31COkOV+DuLVNQaRkRyGWrw5B2HvqEB4cvRdh765DSFO+BoFFZ0UhqOj+7lqENOVpEDe3KYjkrP0ILLqrFuGNXoKtqxYhjXkaxI2tjOTM/Yjlq4IRts6nCGnM1SA8Nbqv8ylCGnL9EVR0UmYkAovueILAoq9v1SCSMiIRqouuv+CP8NTo3mePEVj0ta81iCMZkYhlq4IQWHTdBX8EFn12H2JZQBDC2v4IIXU5/ghv9P/7Dwk7DCCpQ4GVAAAAAElFTkSuQmCC";

function card(): Uint8Array {
  const bin = atob(CARD);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default defineApp({
  id: "share-files",
  name: "Cards",
  version: "1.0.0",
  schemaVersion: 1,
  quickActions: [{ id: "new", label: "New card", entity: "card", mode: "instant", open: true, prefill: { title: "Autumn" } }],
  entities: {
    card: {
      label: "Card",
      displayField: "title",
      fields: { title: { type: "text", required: true } },
      actions: {
        // One picture the app made, with words: the share sheet's ordinary case.
        sharePicture: async (c, ctx) => {
          const sent = await ctx.ui.share({ title: `Share ${c.title}`, text: `${c.title} palette 🎨`, files: [new Blob([card() as BlobPart], { type: "image/png" })] });
          ctx.ui.toast(sent ? "Sent" : "Not sent");
        },
        // Files of the app's folder: the picture kept there, and a CSV beside it.
        shareKept: async (c, ctx) => {
          const kept = await ctx.files.write(`cards/${c.title}.png`, card(), { mime: "image/png" });
          const colours = await ctx.files.write(`cards/${c.title}.csv`, "name,hex\nochre,#e4a93c\nterracotta,#c4623d\n", { mime: "text/csv" });
          const sent = await ctx.ui.share({ title: `Share ${c.title} files`, files: [kept, colours] });
          ctx.ui.toast(sent ? "Sent" : "Not sent");
        },
      },
    },
  },
  pages: [
    { id: "cards", title: "Cards", view: { type: "list", entity: "card", display: { primary: "title" }, onOpen: { page: "card", param: { cardId: "id" } } } },
    { id: "card", title: "Card", hidden: true, view: { type: "detail", entity: "card", param: "cardId", actions: ["sharePicture", "shareKept"] } },
  ],
});
