// An app whose pages sit on a picture it ships (`theme.background: { image }`) — the fixture for
// e2e/page-backdrop-trusted.spec.ts. Packed with fixtures/garden-flower.png beside it.
import { defineApp } from "potyro";

export default defineApp({
  id: "backdrop",
  name: "Backdrop",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  theme: { accent: "#3a7d44", background: { image: "garden-flower.png" } },
  entities: { flower: { label: "Flower", displayField: "name", fields: { name: { type: "text" } } } },
  pages: [{ id: "all", title: "Flowers", description: "Everything in bloom", view: { type: "list", entity: "flower" } }],
});
