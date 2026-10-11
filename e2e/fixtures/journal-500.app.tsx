// A journal with 500 entries, for the timeline's first-paint budget (#110). The Seed page writes the
// entries once, in one transaction; the Journal page is the timeline under test.

import { defineApp, type ViewProps } from "potyro";
import { useEffect, useState } from "react";

const MOODS = ["good", "okay", "rough"] as const;

// Once per page load: React's development mode runs an effect twice.
let seeding: Promise<void> | null = null;

function Seed({ runtime }: ViewProps) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    seeding ??= (async () => {
      const have = (await runtime.ctx.query("entry")).length;
      if (have < 500) {
        const start = new Date(2026, 8, 9, 20, 0).getTime();
        await runtime.ctx.transaction(async (ctx) => {
          for (let i = have; i < 500; i++) {
            await ctx.create("entry", { text: `Entry ${i + 1}`, at: new Date(start - i * 17 * 3600 * 1000), mood: MOODS[i % 3] });
          }
        });
      }
    })();
    void seeding.then(async () => setCount((await runtime.ctx.query("entry")).length));
  }, [runtime]);
  return <p className="seeded">{count === null ? "Seeding…" : `Seeded ${count}`}</p>;
}

export default defineApp({
  id: "journal-500",
  name: "Journal 500",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    entry: {
      label: "Entry",
      displayField: "text",
      fields: {
        text: { type: "text", required: true },
        at: { type: "datetime", precision: "minute", required: true },
        mood: { type: "enum", options: ["good", "okay", "rough"], colors: { good: "green", okay: "yellow", rough: "red" } },
      },
    },
  },
  pages: [
    { id: "seed", title: "Seed", view: { type: "custom", entity: "entry", render: (props) => Seed(props) } },
    {
      id: "journal",
      title: "Journal",
      view: { type: "timeline", entity: "entry", date: "at", color: "mood", display: { primary: "text", secondary: "mood" } },
    },
  ],
});
