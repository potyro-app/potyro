# Writing Potyro apps — tutorials

Potyro apps can be described to the Studio, and they can also be **written**: an app is one
TypeScript module that declares what it keeps and shows, with its behaviour as ordinary functions
that receive `ctx`. These tutorials teach the second way, each with a small app that works.

```sh
npm create potyro@latest my-app     # a project with an app in it
npm run build                       # → dist/my-app.potyro-app.zip, for Add an app → From this device
```

Every tutorial's code is in [`code/`](code/), one folder per stage. The repo checks that each stage is
a valid app, packs, typechecks and passes its tests (`pnpm --filter @potyro/tutorials-code test`), so
the code in an article is code that runs.

## The series

✅ written · the rest planned. The reference app in brackets is an app in this repo that already does
it.

**Getting started**
1. ✅ [Your first Potyro app](01-your-first-app.md): entities, pages, an action, pack, install, update
2. How a Potyro app is put together: shape as data, logic as functions, `ctx`; trusted and sealed
3. Developing quickly: the edit–pack–replace loop, typechecking, `ctx.log`

**Data and item types**
4. Designing item types: every field type, groups, `displayField`
5. Customizing how an item type looks: list display, detail page, gallery cards (*recipes, plants*)
6. Computed values (*recipes, split*)
7. Relations between items: relation fields, related sections, timelines and charts
8. Actions in depth: input forms, row and page actions, `ctx.transaction` (*split*)
9. Filtering and sorting with plain JS: filter chips, params, `scope` (*groceries, places*)
10. Changing your data without losing it: `schemaVersion` and migrations (*workout, groceries*)

**Views**
11. The built-in views: list, gallery, table, detail, calendar, map, steps, checklist (*poster-event, places*)
12. Your first custom view (*countdowns, which-is-cheaper*)
13. A custom view in React (*recipes' cook-along, workout*)
14. Asking the person: `ctx.ui` toast, confirm, prompt, pick, sheet, form, progress
15. Navigation and links into a page: `ctx.navigate`, `link.params`, `ctx.ui.share`

**Device features**
16. Using the camera: `ctx.caps.camera.capture`, media fields (*photo-garden, plant-doctor*)
17. The live camera and faces (*mirror-monsters*)
18. Location and maps (*where-i-parked*)
19. Reminders and notifications (*plants, countdowns*)
20. Timers, keeping the screen awake, haptics (*workout*)
21. Voice input: `ctx.caps.speech` (no app uses it yet)

**Files and storage**
22. Using files in your app: `ctx.files`, files shipped in the package (*piano, markdown-notes*)
23. Media, files or `ctx.storage`: which for what
24. Sample data and demos: `seed.json`, `demo` (*countdowns, ticker*)

**Network and real time**
25. Fetching from an API: `ctx.caps.network.fetch` (no app uses it yet)
26. A real-time app with WebSockets: `ctx.caps.network.socket` (*earthquakes, ticker*)
27. A multiplayer app with rooms: `ctx.caps.network.room` (*draw-guess*)
28. Shared apps and people: `ctx.me`, `ctx.space`, member fields, guests

**AI, polish and sharing**
29. AI inside your app: `ctx.caps.ai.extract` and `ask` (*receipt-split, pantry*)
30. A live launcher tile (*countdowns, plants*)
31. Translating your app: catalogs, `ctx.t`, `ctx.format` (docs/30)
32. Theme, icon and accent
33. Your app in the sealed box: permissions, prompts, what a sealed app cannot do
34. Sharing and publishing: share links, Make it mine, the gallery
35. Testing your app
