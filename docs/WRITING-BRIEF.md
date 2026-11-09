# Brief for writing a page of the new Potyro docs (working file, deleted before merge)

You write pages under docs/<section>/ in the worktree /home/aivuk/potyro-docs-rewrite. Read first:
docs/REWRITE-PLAN.md (structure, the mapping, the file list), then the two finished pages that set
the voice: docs/start/introduction.md and docs/concepts/data-and-sync.md. Match them exactly in
tone and density.

The reader is a developer who wants to build a Potyro app or understand how Potyro behaves. They
have never seen the repository and do not care how it was built or who decided what.

## The rules (not optional)

1. Present tense, second person ("you"). Describe what Potyro does now, never how it came to be.
2. Nothing the reader cannot act on. No dates, issue numbers (#123, KA-12), owner/author decisions,
   measurements (ms, KB, counts), agents, CLAUDE.md, skills, package names, file paths, "docs/NN".
   Contributing pages are the one exception: they may name files and commands.
3. Open with one sentence that says what the page is about. A guide or reference shows code within
   the first screen.
4. One page, one kind. A guide does a task (imperative steps, one worked example). A reference
   lists completely and dryly (tables, signatures, short notes). A concept explains, with little
   code. Do not persuade in a reference and do not teach in a how-to.
5. Sentences under 20 words, one idea each. No nested parentheses, no semicolon chains.
6. Cross-reference by title with a relative link to a file in the plan's file list, e.g.
   [Data and sync](../concepts/data-and-sync.md). Never "docs/04 §3". Never link to the numbered
   notes or to repository files (contributing pages excepted).
7. Rationale only where it changes what the reader does. One short sentence at most.
8. 400–1,000 words a page. Reference pages may run to 2,000 when completeness needs it.
9. End with a "## Next" list of two or three links.

## Truth

Every API name, option, type and command must exist. Verify against the source of truth, never
against memory or the old prose alone:
- packages/schema/src/types/*.ts (app.ts, fields.ts, core.ts, ctx.ts, runtime.ts, sockets.ts,
  speech.ts, faces.ts, tile.ts, localized.ts, words.ts) — the real types with doc comments
- examples/*.app.ts(x) and apps/*/ — real apps that run
- docs/tutorials/code/01-reading-list/2-logic/reading-list.app.ts — a complete small app
- packages/create-potyro/template/ and packages/schema/cli/ — the CLI
When the old doc and the types disagree, the types win. When something is behind a flag or
unfinished, leave it out rather than describe a plan. Code samples must typecheck in your head
against the types: correct property names, correct nesting (e.g. a page is `{ id, title, view: {
type, entity, ... } }`, patches go through `ctx.patch`, not `ctx.data.patch`).

## Frontmatter (every page)

```
---
title: <Title case, short>
description: <one sentence>
section: <start|concepts|guides|reference|contributing>
order: <integer within the section>
---

# <same title>
```

Do not create files outside your assignment. Do not edit the numbered notes, the plan, the brief or
the two finished pages. When done, reply with: the files written, their word counts, and any API
fact you could not verify (say so instead of guessing).
