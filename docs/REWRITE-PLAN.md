# Rewrite plan for potyro.com/docs (working file, deleted before merge)

## Goal

Documentation a developer can read: how to build an app, how Potyro behaves, what the API is.
Not: how the system was designed, who decided what and when, how the team works.

## Structure (the skeleton 9 of 10 comparable projects use)

```
docs/
  start/          Introduction · Your first app · Developing (edit, build, replace; typecheck; tests)
  concepts/       How an app is put together · Your apps and other people's apps · Data and sync ·
                  Sharing · The Studio · Why Potyro
  guides/         Entities and fields · Pages and views · Computed, actions, reminders · Custom views ·
                  Asking the person (ctx.ui) · Working together · Changing an app that has data ·
                  Translating your app · Device capabilities · Build for Android · Self-host Potyro
  reference/      defineApp · Field types · Pages and view options · ctx · ctx.caps.camera ·
                  ctx.caps.network (sockets, rooms) · ctx.caps.ai · ctx.caps.speech · Package format · CLI
  contributing/   Running the repository · Tests · Code map · Design notes (links to the numbered notes)
  NN-*.md         the engineering notes, unchanged, `audience: internal`, not on the site
```

Roughly 30 pages at 400–1,000 words each (about 20k words) in place of 116k.

## Where each current page goes

| Current | Keep | Goes to |
|---|---|---|
| 00 How Potyro works | ~50%: On one screen, the one idea, an app's life, overviews | concepts/* (split) |
| 01 Vision | ~35% | concepts/why-potyro |
| 02 Architecture (retired) | – | drop |
| 03 Definition model | ~70% | reference/define-app, field-types, pages-and-views |
| 04 App module API | ~55% | reference/ctx (+ guides for ui, timers, text); Studio edit boundary → internal |
| 05 Runtime interfaces | ~40% | contributing (host API, not for app authors) |
| 06 Persistence & migrations | ~60% | guides/changing-an-app-with-data |
| 07 Execution, trust & targets | ~45% | concepts/trusted-and-sealed; guides (libraries, packaging) |
| 09 Testing strategy, 12 Testing guide | ~30–45% | contributing/running, contributing/tests; start/developing |
| 13 Native Android | ~55% | guides/build-for-android |
| 16 Deployment | ~40% | guides/self-host; the rest internal |
| 17 Concurrency hazards | hazard table | concepts/data-and-sync (done) |
| 20 Multi-language (inline maps) | – | drop |
| 21 Glossary | English terms | contributing (translators) |
| 22 Browser realm | ~15% | concepts/trusted-and-sealed; the rest internal |
| 23 AI in apps | ~45% | reference/ctx-caps-ai |
| 24 Share links | ~45% | concepts/sharing; reference (page and record links) |
| 25 Live camera | ~55% | reference/ctx-caps-camera |
| 26 Rooms relay, 28 Live connections | ~65–75% | reference/ctx-caps-network |
| 27 iOS | – | internal (owner note, unverified) |
| 29 Voice | ~50% | reference/ctx-caps-speech |
| 30 App translations | ~50% | guides/translating-your-app |
| 31 Security model | ~85% | concepts/trusted-and-sealed |
| 32 Code map | ~90% | contributing/code-map |
| tutorials/01 | ~95% | start/your-first-app (as is) |
| adr/0001 | – | linked from contributing/design-notes |

## Writing rules

1. Present tense, second person. Describe what Potyro does, not how it came to be.
2. Nothing a reader cannot act on: no dates, issue numbers, owner decisions, measurements,
   agents, CLAUDE.md, package names, file paths (contributing pages excepted).
3. A page opens with one defining sentence and shows code within the first screen.
4. One page, one kind: a tutorial teaches, a guide does a task, a reference lists, a concept explains.
5. Sentences under 20 words, one idea each. No nested parentheses.
6. Cross-reference by title with a link, never "docs/04 §3".
7. Rationale only where it changes what the reader does; everything else in Why Potyro.
8. 400–1,000 words a page. If it needs more, it is two pages.

## Why the numbered notes stay where they are

512 source files and the generator's corpus refer to them as `docs/NN`. They become `audience:
internal`: kept in the repository as the engineering record, skipped by the site. The reference
pages can replace docs/04–05 in the corpus later, measured with the eval, as a separate change.

## Site changes

`site/src/docs.mjs`: read `docs/<section>/*.md`, group by `section`, sidebar in section order,
skip `audience: internal`; `scripts/docs-index.mjs` lists the sections first, the notes last.

## The files (link targets; every page links by these relative paths)

start/introduction.md · start/your-first-app.md · start/developing.md
concepts/how-an-app-is-put-together.md · concepts/trusted-and-sealed.md · concepts/data-and-sync.md ·
concepts/sharing.md · concepts/the-studio.md · concepts/why-potyro.md
guides/entities-and-fields.md · guides/pages-and-views.md · guides/computed-actions-reminders.md ·
guides/custom-views.md · guides/asking-the-person.md · guides/working-together.md ·
guides/changing-an-app-with-data.md · guides/translating-your-app.md · guides/device-capabilities.md ·
guides/build-for-android.md · guides/self-host.md
reference/define-app.md · reference/field-types.md · reference/pages-and-views.md · reference/ctx.md ·
reference/ctx-caps-camera.md · reference/ctx-caps-network.md · reference/ctx-caps-ai.md ·
reference/ctx-caps-speech.md · reference/package-format.md · reference/cli.md
contributing/running-the-repository.md · contributing/tests.md · contributing/code-map.md ·
contributing/design-notes.md

Frontmatter on every page: title, description (one sentence), section (start|concepts|guides|reference|contributing), order (integer within the section).
