// The voice fixture (docs/29): "Dictate" listens, writes what it hears live into the screen's status
// line, and keeps the whole text as a note once the listening ends. "Stop" ends it.
import { defineApp, type Ctx, type SpeechSession } from "potyro";

let heard: SpeechSession | null = null;

const note = (ctx: Ctx, text: string) => ctx.create("note", { text });

export default defineApp({
  id: "voice-notes",
  name: "Voice Notes",
  version: "1.0.0",
  schemaVersion: 1,
  permissions: { speech: true },
  entities: {
    note: { fields: { text: { type: "text", required: true } } },
  },
  pages: [
    {
      id: "notes",
      title: "Notes",
      view: { type: "list", entity: "note", display: { primary: "text" } },
      actions: [
        {
          label: "Dictate",
          run: async (ctx) => {
            if (!ctx.caps.speech) return void (await note(ctx, "no speech"));
            try {
              heard = await ctx.caps.speech.listen();
            } catch (e) {
              await note(ctx, `refused ${String((e as { code?: string }).code)}`);
              return;
            }
            await note(ctx, `listening ${heard.language} ${heard.engine}`);
            // Not awaited: the action returns, so the person can press Stop while it listens.
            void heard.result.then(
              (words) => note(ctx, `heard: ${words}`),
              (e: { code?: string }) => note(ctx, `failed ${String(e.code)}`),
            );
          },
        },
        { label: "Stop", run: async () => heard?.stop() },
      ],
    },
  ],
});
