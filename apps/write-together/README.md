# Write Together

A markdown document several people type into at once, each in their own colour, with comments
pinned to the words — an Etherpad for Potyro.

Open a document and write. Everyone who has the app with you sees your words as you type, under
your colour; theirs come in under theirs. **Preview** reads the document as a page. Select some
words (or just put the caret somewhere) and tap **+ Comment**: the comment stays on those words
through everyone's edits, and says so when they are deleted. **Invite** hands out the app's own
"Use it together" link; alone, the app is simply a notebook, and the words become shared the moment
the app is.

## How it works

The document's text is a `text` field declared `collaborative: true` (docs/04 "Writing together").
That is the platform's own CRDT doing the work: the words live in a text CoValue of their own, so two
people's keystrokes merge character by character and every character remembers the account that
typed it. The editor never saves the whole text — it sends what changed (`ctx.text(...).edit`), and
reads who wrote what (`runs`) rather than anything a copy could claim.

- `loop.ts` — the editor's sync loop, pure: differential sync between the screen and the text the
  host last confirmed, with what was typed meanwhile merged in (`merge3`).
- `diff.ts` — what changed between two texts, where the caret goes when the text changes under it,
  the runs under the keys, the backdrop's segments, the writers' colours.
- `editor.tsx` — the screen: a transparent textarea over a backdrop that draws the same text with
  each writer's tint; the toolbar's marks (`marks.ts`, as Notes has them); the comments panel.
- `markdown.tsx` — the preview, drawn as React elements, never as HTML from the text.
- `write-together.app.tsx` — the app: `doc`, `comment` (anchored with `ctx.text(...).anchor`) and
  `writer` (one colour per person, resolved in creation order so two people who opened the document
  at the same moment never share one).

Colours appear once a second person has written in a document; alone, a document is just a document.

## Build, test, check

```
pnpm --filter @potyro/app-write-together build      # → dist/write-together.potyro-app.zip
pnpm --filter @potyro/app-write-together test
pnpm --filter @potyro/app-write-together typecheck
pnpm e2e e2e/write-together-trusted.spec.ts         # two browsers, one document, the real sync relay
```

The platform half is tested where it lives: `packages/store/test/jazz-text.test.ts` (the CRDT),
`packages/host/test/text-ctx.test.ts`, `text-transform.test.ts` and `text-two-editors.test.ts`
(the ctx, both sealed runners, two editors over two real stores).
