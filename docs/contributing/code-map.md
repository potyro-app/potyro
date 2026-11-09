---
title: Code map
description: Where each concern lives in the source, with the files and entry points for sync, sharing, storage, the sealed realm, ctx, views, the shell, links, design, i18n, the generator, apps, tests and native.
section: contributing
order: 3
---

# Code map

This page says which files own each concern and names the entry points in them. It is for someone
who knows what they want to change and needs the files.

```sh
grep -n "openJazzStore" packages/store/src/jazz-backend.ts
grep -a -n "editText" packages/store/src/jazz-store.ts
pnpm lint:docs        # every path on this page exists
```

Function names are stable; line numbers are not, so none are given. Four files are read by `grep`
as binary and print nothing: use `grep -a` on `packages/shell/src/app-source.ts`,
`packages/store/src/jazz-store.ts`, `packages/host/src/resolve.ts` and
`packages/views/src/board.tsx`. The packages and the seams between them are in
[Running the repository](running-the-repository.md). The reasoning behind each design is in the
[Design notes](design-notes.md).

## Sync and spaces (cojson)

Behaviour: [Data and sync](../concepts/data-and-sync.md). One cojson group, a "space", per synced
app; a root CoMap per app; one CoMap per record. The relay is `jazz-run sync`.

- `packages/store/src/jazz-backend.ts`: opening nodes and spaces, the relay, invites, members,
  names. `openAccountNode`, `openJazzStore` (the browser entry), `createJazzStore`,
  `openDeviceDatabase`, `deviceNode`, `attachRelay`, `reviveOnResume`, `createSpaceInvite`,
  `joinSpace`, `spaceMembers`, `subscribeSpace`, `removeSpaceMember`, `myRole`, `publishName`,
  `peekAppSpace`, `rememberAppSpace` (the `potyro:jazz:group|root|db:<ns>` keys),
  `warmDeviceDatabase`.
- `packages/store/src/jazz-store.ts`: `class JazzStore implements Store`, the CRDT store over CoMaps,
  CoText and binary streams; `SPACE_BUDGET`, what a space may put on the relay. Section index below.
- `packages/store/src/jazz-sqlite-driver.ts`: `createJazzSqliteDriver`, cojson storage over SQLite.
- `packages/shell/src/open-store.ts`: `openStore` picks the store for a namespace (`crdt-worker`
  when the app syncs); `syncRelayUrl`, `canSync`, `linkedDevice`, `watchSpace`, `liveSpace`,
  `onSpaceChange`, `accountNode`, `publishAppListToAccount`, `rememberAppOnAccount`,
  `forgetAppOnAccount`.
- `packages/shell/src/toggle-sync.ts`: `toggleAppSync`. Sync on or off is a copy into the other
  store; `describeTo` runs before the copy so fields that need their own CoValue are created once.
- `packages/shell/src/share-sync.ts`: whole-app invites (`#join=`): `createShareLink`,
  `acceptInvite`, `pendingInvite`. `packages/shell/src/sync-consent.ts`: `askToSync`,
  `rememberSyncConsent`.
- `packages/identity/src/identity.ts`: `ensureIdentity`, `peekIdentity`, `recoveryPassphrase`,
  `signInWithPassphrase`, `portableIdentity`. `packages/identity/src/vault.ts`: the secret vault.
- The relay: `pnpm relay` in the root `package.json` runs `jazz-run sync --port 4201 --in-memory`
  for development. In production it runs from `deploy/containers.sh` behind
  `deploy/potyro.app.Caddyfile`. `VITE_POTYRO_RELAY` overrides the URL. `packages/rooms`,
  `packages/ai-relay` and `packages/platform-requests` are other servers.

## A record shared on its own

Behaviour: [Sharing](../concepts/sharing.md). A `share: "record"` entity puts each record in a group
of its own that extends the space. The records that point at it live there too, listed on it.

- `packages/store/src/record-sharing.ts`: `KIDS`, `kidKey`, `kidId`, `childrenOf`, `roleToAccess`.
- `packages/store/src/types.ts`: the optional `recordAccess`, `createRecordInvite`, `joinRecord`,
  `recordMembers`; `StoreRules.sharedRecords`.
- `packages/store/src/jazz-store.ts`, section "records shared one by one": `homeFor`, `kidsMaps`,
  `recordAccess`, `createRecordInvite` (admin only), `joinRecord`, `assertMayWrite`.
- `packages/shell/src/read-only-store.ts`: forwards every optional Store method by name
  (`readOnlyStore`, `guardedStore`). Its test reads the interface's method list.
- `packages/shell/src/record-share.ts`: `makeRecordLink`, `recordLinkOn` (also the viewer's),
  `prepareRecordShare` (turns sync on first), `recordLinkFor`, `joinRecordInto`, `SyncDeclined`.
- `packages/shell/src/record-link.ts`: the `#rec=` codec (`readRecordLink`, `withRecordLink`) and
  the hand-off across a reload (`holdRecordJoin`, `takeRecordJoin`, `holdRecordShare`,
  `takeRecordShare`).
- `packages/shell/src/main.tsx` `openLinkedApp`; `packages/shell/src/demo.tsx` `openDemo`, a
  stranger's viewer on a synced `demo:<line>` store. `packages/host/src/make-ctx.ts` `checkShare`
  builds `ctx.access`.

## Collaborative text (`ctx.text`)

Behaviour: [Working together](../guides/working-together.md). A `text` field with
`collaborative: true` lives in a `RawCoPlainText`. Edits carry the text they were counted in
(`base`), and the host maps them onto the current text.

- `packages/store/src/text-field.ts`: `TEXT_REF`, `textRefOf`, `textFieldsOf`, the grapheme and
  UTF-16 maps, anchors (`opAnchor`, `positionAnchor`, `END_ANCHOR`).
- `packages/store/src/jazz-store.ts`, section "collaborative text": `editText`, `textRuns`,
  `textAnchor`, `textIndex`, `newText`, `loadText`.
- `packages/host/src/text-queue.ts` `afterEarlierEdits` (one edit at a time per field);
  `packages/host/src/text-transform.ts` `mapEditsOnto`; `packages/host/src/values-gate.ts`
  `assertCollaborativeText`, `checkTextEdits`, `applyTextEdits`, `checkTextBase`.
- `packages/schema/src/types/ctx.ts`: `CtxText`, `TextEdit`, `TextRun`. The realm ops are `text.*`.
- The first consumer: `apps/write-together/loop.ts` (`SyncLoop`, pure), `apps/write-together/diff.ts`
  (`diffEdits`, `merge3`, `fitRuns`, `resolveColors`), `apps/write-together/editor.tsx`
  (`useSharedText`, `Editor`).
- Tests that show the whole chain: `packages/host/test/text-ctx.test.ts`,
  `packages/host/test/text-two-editors.test.ts`, `packages/store/test/jazz-text.test.ts`.

## Storage on the device

Behaviour: [Data and sync](../concepts/data-and-sync.md); migrations in
[Changing an app that has data](../guides/changing-an-app-with-data.md). One storage Worker owns
one OPFS access-handle pool with a database file per app (`/<namespace>.sqlite3`). Older homes are
a per-app pool, IndexedDB snapshots and `localStorage`.

- `packages/store/src/sqlite-worker.ts`: the Worker. `install` (the pools), `open`, `remove`,
  `handle` (run, query, get, close), `letGoWhenIdle` (another tab took the storage).
- `packages/store/src/sqlite-worker-client.ts`: `openWorkerSqlite`, `openWorkerSqliteHandle`,
  `deleteWorkerSqlite`, `workerDbName` (the file name a namespace gets), `workersAvailable`,
  `onStorageElsewhere`, `takeOverStorageOnNextLoad`.
- `packages/store/src/storage-owner.ts`: the cross-tab Web Lock, `ownStorage`,
  `StorageElsewhereError`.
- `packages/store/src/sqlite-store.ts` `SqliteStore`; `packages/store/src/sqlite-backend.ts`
  `initSqlite`, `openOpfsDb`, `createSqliteStore`, `createMemorySqliteStore` (tests);
  `packages/store/src/local-store.ts` `LocalStore`; `packages/store/src/idb-sqlite.ts`;
  `packages/store/src/memory-store.ts`; `packages/store/src/migrate.ts`;
  `packages/store/src/export.ts`; `packages/store/src/copy-store.ts` `copyStoreData`.
- `packages/store/src/file-space.ts`: an app's files over its Store, `fileSpace`, `normalisePath`.
- `packages/shell/src/open-store.ts` `openStore`: the mode order is `crdt-worker`, `worker`, `opfs`,
  `local-storage`; `mayFallBack`, `StoreBusyError`, `adoptLocalStorageData`.
- `packages/shell/src/erase-app-data.ts`: what deleting an app erases. `appStorageKeys`,
  `eraseAppData`, `appOpened` and `appClosed` (the file goes once the app is closed), `settleOwed`.
  `packages/shell/src/remove-app.ts` `confirmAndRemoveApp`; `packages/shell/src/user-apps.ts`
  `removeUserApp`. A new per-app `localStorage` key must be added to `appStorageKeys`.
- **Adding a Store method**: `packages/store/src/types.ts`, then every store, then
  `packages/shell/src/read-only-store.ts`, then the copy site in `packages/shell/src/toggle-sync.ts`,
  then `packages/store/src/peer-harness.ts` for two-node tests, then `ctx`. A method the read-only
  wrapper does not forward makes the host fall back silently.

## Sealed execution (the browser realm, the QuickJS fallback)

Behaviour: [Your apps and other people's apps](../concepts/trusted-and-sealed.md). A sealed app's
logic runs in a Worker inside an opaque-origin sandboxed iframe (`sandbox="allow-scripts"`,
`REALM_CSP`). Each custom view runs in a frame of its own.

- `packages/host/src/realm/realm-host.ts`: the host side, `createRealmLoader`, `RealmLoadedApp`.
  Its `route` method maps every op from the realm onto the real `ctx`, coercing each argument.
- `packages/host/src/realm/frame.ts`: the srcdoc frames, `frameSpawner`, `spawnViewFrame`,
  `realmDocument`, `viewDocument`. `packages/host/src/realm/worker-runtime.ts`: `boot`, `load`,
  `run` inside the Worker. `packages/host/src/realm/view-runtime.ts`: a sealed view inside its
  frame. `packages/host/src/realm/ctx-proxy.ts` `makeRealmCtx`: `ctx` as RPC.
- `packages/host/src/realm/protocol.ts`: `CallKind`, `OPS` (every ctx op by name), `VIEW_OPS`,
  `HostToRealm`, `RealmToHost`, `HostToView`, `ViewToHost`, `REALM_CSP`.
- `packages/host/src/realm/sealed-view.ts` `SealedViewController`;
  `packages/host/src/realm/view-watchdog.ts`; `packages/host/src/realm/view-guard.ts` (the
  crash-loop guard); `packages/host/src/realm/form-submit-shim.ts`;
  `packages/host/src/realm/realm-sockets.ts`; `packages/host/src/realm/realm-speech.ts`;
  `packages/host/src/realm/port-transport.ts`.
- `packages/host/src/isolate/isolate-host.ts` `createIsolateLoader`, `IsolateLoadedApp`;
  `packages/host/src/isolate/harness.ts` `HARNESS_SOURCE`; `packages/host/src/isolate/marshal.ts`.
  The QuickJS fallback is chosen with `localStorage["potyro:sandbox"] = "quickjs"`.
- `packages/shell/src/isolate-bridge.ts` `createSandboxLoader`, `createSharedAppLoader`;
  `packages/shell/src/isolate-stubs/`: the `potyro` and React stand-ins inside the box.
- The shell's own CSP (`frame-src 'none'`): `packages/shell/index.html`,
  `packages/shell/vite.config.ts` (`SHELL_CSP`), `deploy/potyro.app.Caddyfile`. The probe screen:
  `packages/shell/src/realm-probe.ts`.
- In development, `pnpm dev:sandbox` seeds the examples sealed. Specs named `*-sandbox.spec.ts`
  drive them. A sealed app's screens are in `.k-sealed-view iframe` frames; its sheets are on the
  shell's page.

## `ctx` and the host

Behaviour: [The `ctx` reference](../reference/ctx.md).

- `packages/schema/src/types/ctx.ts`: `Ctx`, `Caps`, `CtxUi`, `CtxText`, `CtxFiles`, `CtxStorage`,
  `CtxViews`, `CtxFormat`, `CtxMedia`, `CtxGuests`, `Space`, `Member`, `Person`, `RecordLink`,
  `ShareAppLink`, `Access`. `packages/schema/src/types/app.ts`: `AppDefinition`, `EntityDef`.
  `packages/schema/src/types/fields.ts`: the field types. `packages/schema/src/validate.ts`: Zod for
  the declarative parts.
- `packages/host/src/make-ctx.ts` `buildCtx`: the direct `ctx`; `checkShare`, `checkShareFiles`,
  `filesFor`; `log` prints to the console with the app id. `packages/host/src/values-gate.ts`: every
  check of app input, `assertValuesFit`, `assertPatchFits`, `assertCountable`, the text checks.
  `packages/host/src/resolve.ts` (`grep -a`): relation resolution.
- `packages/runtime/src/core.ts` `RuntimeCore`, the writes proxy that refreshes the screen;
  `packages/runtime/src/create-runtime.ts` `createRuntime`; `packages/runtime/src/activity.ts`, the
  Changes feed as record events.
- The model's view of `ctx`: `packages/generator/src/reference.ts`. `REFERENCE_FILES` is the core
  in every prompt, with a hard budget; `LOOKUP_ONLY_FILES`; `CAPABILITIES` is read on demand, and a
  new member goes there with its `members`; `buildReference`.
  `packages/generator/scripts/build-reference.ts` writes
  `packages/generator/src/reference.generated.ts`; `packages/generator/test/reference.test.ts`
  fails on a stale file or a busted budget.

## Views

Behaviour: [Pages and view options](../reference/pages-and-views.md).

- `packages/views/src/registry.ts` `defaultRegistry` (list, gallery, table, detail, custom,
  calendar, map, steps, checklist, board, timeline, stats, chart, aggregate),
  `resolveViewComponent`.
- `packages/views/src/builtins.tsx` `ListView`, `GalleryView`, `TableView`, `EmptyState`,
  `RowActions`; `packages/views/src/checklist.tsx` `ChecklistView`; `packages/views/src/map.tsx`
  `MapView` (MapLibre); `packages/views/src/board.tsx` (`grep -a`); `packages/views/src/calendar.tsx`;
  `packages/views/src/steps.tsx`; `packages/views/src/timeline.tsx`; `packages/views/src/stats.tsx`;
  `packages/views/src/chart.tsx`; `packages/views/src/aggregate.tsx`.
- `packages/views/src/custom.tsx` `CustomView`, which renders `MountedView` (a trusted `mount`) or
  `SealedCustomView` (a realm frame). `packages/views/src/record-form.tsx` `RecordForm`,
  `ValuesForm`, `createDefaults`.
- `packages/views/src/cells.ts` `useDisplayCells`; `packages/views/src/format.ts` `formatValue`,
  `fieldLabel`, `getView`; `packages/views/src/news.ts` `NewsContext`, `useNews` (a hook: call it
  before any early return); `packages/views/src/page-count.ts`.
- Styles are the shell's: `packages/shell/src/styles.css`, section "Built-in views".

## The shell

Behaviour: [How an app is put together](../concepts/how-an-app-is-put-together.md). The composition
root is `packages/shell/src/main.tsx`.

- `packages/shell/src/main.tsx`: `boot` (identity, routing, first render), `bootUserApp` (opens a
  saved app: the store, the runner by provenance, the runtime, `appOpened` and `appClosed`),
  `bootDemo`, `bootInviteIfPresent`, `openLinkedApp`, `show`, `offerAccountApps`, `exportApp`,
  `importApp`, `registerServiceWorker`, `registerShares`, `registerDeepLinks`.
- `packages/shell/src/App.tsx` `App`: one app's whole screen. Chrome, pages, edit mode, the Studio,
  the "Something's wrong" recorder, Fix this, translate, trust; `GridTile`; `Toasts`.
- `packages/shell/src/chrome.tsx` `AppChrome`, which renders `PhoneChrome` or `WideChrome`;
  `FullscreenFrame`.
- `packages/shell/src/launcher.tsx` `Launcher`, `Tile`, `TileMenu`, `openInstalledApp`;
  `packages/shell/src/launcher-metro.tsx` `MetroHome`, `StartPane`, `AllApps`;
  `packages/shell/src/launcher-store.ts` (entries, order, pins, attention: `listInstalledApps`,
  `useInstalledApps`, `appKey`); `packages/shell/src/user-apps.ts` (the saved apps in
  `localStorage`: `listUserApps`, `saveUserApp`, `removeUserApp`, `setUserAppSync`).
- `packages/shell/src/add-app.ts` `gatherFromFiles`, `gatherFromLink`, `gatherFromPaste`,
  `inspectPackage`, `installPackage`, `applySeed`, `applyShippedFiles`, `remixOf`;
  `packages/shell/src/add-app-dialog.tsx`.
- `packages/shell/src/app-source.ts` (`grep -a`): edits the declarative half of an app by splicing
  text, without a model. `inspect`, `applyEdit`, `declaredSync`, `declaredPermissions`.
- `packages/shell/src/ui-bridge.ts` `createUiBridge` (what `ctx.ui` does in the shell: toasts,
  dialogs, pickers, share, record links), `createNavBridge`; `packages/shell/src/dialog.tsx`
  `DialogHost` (one dialog at a time: anything that asks must run before `dialogs.send`),
  `shellDialogs`; `packages/shell/src/share-body.tsx` `ShareBody` (Copy, Copy link, the device's
  sheet).
- Trust and provenance: `packages/shell/src/trust-dialog.tsx`, `packages/shell/src/promotion.ts`.
  Per-app standings: `packages/shell/src/ai-setting.ts`, `packages/shell/src/app-sockets.ts`,
  `packages/shell/src/app-speech.ts`. The identity panel: `packages/shell/src/identity-panel.tsx`.
  The Data page: `packages/shell/src/data-runtime.ts`. Files: `packages/shell/src/files-panel.tsx`,
  `packages/shell/src/device-files.tsx`, `packages/shell/src/shipped-files.ts`,
  `packages/shell/src/seed-files.ts`.

## Share links, demos, the gallery

Behaviour: [Sharing](../concepts/sharing.md).

- `packages/shell/src/demo-link.ts` `readDemoLink`, `inlineDemoLink`, `demoLinkText`, `remixLink`;
  `packages/shell/src/demo-share.ts` `makeDemoLink`, `previewMeta`;
  `packages/shell/src/share-service.ts` `hostDemo`, `fetchHostedPackage`, `GoneError`,
  `TakenDownError`, `TooManyError`; `packages/shell/src/preview-card.ts` `renderPreviewCard`.
- `packages/shell/src/app-link.ts` `readAppTarget`, `withAppTarget`, `matchLinkedApp`,
  `holdArrival`, `takeArrival`; `packages/shell/src/app-link-make.ts` `makeAppLink`, `demoLinkFor`,
  `siteRoot`.
- `packages/shell/src/demo.tsx` `loadDemoPackage`, `openDemo` (sealed, on records in memory, or live
  on a synced store for a record link), `DemoScreen` (the bar: Keep, Make it mine, Report).
- `packages/share-links/src/`: the share service (`server.ts`, `handler.ts`, `page.ts`, `store.ts`,
  `wire.ts`); `packages/share-links/scripts/takedown.mjs`.
- `gallery/gallery.json` (the page's order), `gallery/shots/`, `gallery/src/build.mjs`
  (`pnpm gallery:build`), `gallery/src/publish.mjs` (`pnpm gallery:publish`), `gallery/test/`.

## Design system, styles, i18n

Behaviour of an app's translations: [Translating your app](../guides/translating-your-app.md).

- Read `packages/design/README.md` first. `packages/design/source/` holds the design system as
  delivered (the design and writing guides, the tokens, the logo); `packages/design/tokens.css`;
  `packages/design/src/` (`color.ts` the colour clock, `seal.ts`, `lucide.ts` `lucidePath`);
  `packages/design/scripts/` (tokens, lucide, split-logo).
- `packages/shell/src/styles.css`; `pnpm lint:tokens` keeps it on the tokens. Its sections, in
  order: Tokens; Edit mode; The ground; Page header; The ONE primary action; Lists; Empty page;
  Gallery; Table; Record page; Camera on; Studio conversation; Model settings; History tab; the
  recorder, Replay report, Cases, FixPanel; Ask; Start screen; Content first; Type rule; Logo;
  Icons; Home; App chrome; Built-in views; The Studio. Grep `/* ----` for the headings.
- `packages/i18n/src/` (`i18n.ts`, `locale.ts`, `format.ts`, `react.tsx`, `app-catalogs.ts`,
  `pseudo.ts`, `wording.ts`); the catalogs `packages/i18n/locales/<lang>/messages.po` (en, de, es,
  it, pl, pt-BR); `pnpm i18n:extract`; `scripts/check-i18n.mjs` behind `pnpm lint:i18n`, where
  `// i18n-ignore — why` is the escape.
- An app's own words: `apps/<id>/locales/<lang>.po` and `examples/files/<id>/locales/`, made by
  `pnpm i18n:app` (the translate tool in `packages/generator`).

## The generator and the Studio

Behaviour: [The Studio](../concepts/the-studio.md); the in-app API in
[ctx.caps.ai](../reference/ctx-caps-ai.md).

- `packages/generator/src/prompt.ts` `SYSTEM_PROMPT`, `buildUserMessage`, `capabilityPassages`;
  `packages/generator/src/agent/system-prompt.ts`,
  `packages/generator/src/agent/create-system-prompt.ts`,
  `packages/generator/src/agent/modify-system-prompt.ts`.
- The loops: `packages/generator/src/agent/loop.ts` `runAgentLoop`;
  `packages/generator/src/agent/create-loop.ts` `runCreateLoop`;
  `packages/generator/src/agent/modify-loop.ts` `runModifyLoop`;
  `packages/generator/src/agent/tools.ts`, `packages/generator/src/agent/discovery-tools.ts`
  (`lookupReference`), `packages/generator/src/agent/ask.ts`,
  `packages/generator/src/agent/conversation.ts`, `packages/generator/src/agent/loop-recovery.ts`,
  `packages/generator/src/agent/verify-claims.ts`, `packages/generator/src/agent/translate-tool.ts`.
- The corpus: `packages/generator/src/corpus.ts` `buildCorpus`,
  `packages/generator/src/corpus-files.ts`, `packages/generator/scripts/build-corpus.ts`, which
  writes `packages/generator/src/corpus.generated.ts` (`pnpm --filter @potyro/generator gen:corpus`;
  `packages/generator/test/corpus.test.ts`).
- Backends: `packages/generator/src/openrouter-backend.ts` (`OPENROUTER_MODELS`),
  `packages/generator/src/claude-backend.ts`, `packages/generator/src/cli-backend.ts`,
  `packages/generator/src/webllm-backend.ts`, `packages/generator/src/gemini-nano-backend.ts`,
  `packages/generator/src/hybrid-backend.ts`, `packages/generator/src/backend.ts`
  (`FixtureBackend`).
- Evals: `packages/generator/src/*-eval.ts`, run by `packages/generator/scripts/run-*-eval.ts`
  (the `eval:*` scripts; they call a model and cost money). `packages/generator/scripts/i18n-app.ts`
  is `pnpm i18n:app`.
- The Studio in the shell: `packages/shell/src/studio.tsx` `Studio`;
  `packages/shell/src/studio-engine.ts`; `packages/shell/src/studio-preview.tsx` `buildPreview`;
  `packages/shell/src/studio-tools.tsx`; `packages/shell/src/studio-thread-view.tsx`,
  `packages/shell/src/studio-thread.ts`, `packages/shell/src/studio-chat.ts`;
  `packages/shell/src/start-create.ts`, `packages/shell/src/start-modify.ts`,
  `packages/shell/src/start-ask.ts`, `packages/shell/src/start-fix.ts`;
  `packages/shell/src/generate-client.ts`.
- Chat between people: `packages/shell/src/chat-panel.tsx`, `packages/shell/src/chat-sync.ts`,
  `packages/shell/src/share-chat.ts`. Requests to the team: `packages/platform-requests/src/`,
  `packages/shell/src/platform-requests.ts`. The free allowance: `packages/ai-relay/src/`.

## Apps, examples, packaging

Behaviour: [Package format](../reference/package-format.md); [CLI](../reference/cli.md).

- `apps/<id>/`: `<id>.app.tsx`, `package.json` (named `@potyro/app-<id>`; its `build` packs with
  `scripts/pack-app.mjs`, optionally `--seed seed.json`), `README.md`, `test/`, its own modules, an
  optional `locales/`. `examples/*.app.ts(x)` are the six fixtures; their shipped files are in
  `examples/files/`.
- `packages/schema/cli/pack.mjs` `pack`, the `potyro pack` CLI, entered from
  `packages/schema/bin/potyro.mjs`; `packages/store/src/app-package.ts` (the zip's shape),
  `packages/store/src/app-lock.ts` (libraries and modules pinned),
  `packages/store/src/carried-code.ts`; `packages/create-potyro/template/`.
- Tutorials: `docs/tutorials/`, with their code in `docs/tutorials/code/`, tested by
  `@potyro/tutorials-code`.

## Tests and the gate

Behaviour: [Tests](tests.md).

- `scripts/ci-local.mjs`: the gate. `STEPS` are install, build, unit, typecheck, lint (boundaries,
  tokens, i18n, docs) and `e2e:1..N`, Chromium shards of the trusted and sandbox projects; `ff:*` is
  Firefox, outside the verdict; `status`, `deploy`; results in `.ci-local/<sha>/`.
- `scripts/ci-watch.mjs` tests `main` and deploys it when green. `scripts/ship.mjs`,
  `scripts/ci-select.mjs` (which specs a change touches), `scripts/ci-timings.mjs`.
- The checks: `scripts/check-boundaries.mjs`, `scripts/check-tokens.mjs`, `scripts/check-i18n.mjs`,
  `scripts/check-doc-paths.mjs`, `scripts/docs-index.mjs`, `scripts/check-agent-map.mjs`.
- `playwright.config.ts`: the projects trusted, sandbox, sandbox-quickjs, the Firefox and WebKit
  variants, prod; `e2e/ports.ts` (`PORT_BLOCK`, `PORTS`); `e2e/console-guard.ts` (`test`: a spec
  fails on an unexpected console error); `e2e/engines.ts` (engine differences, never weaker
  assertions).
- e2e helpers: `e2e/library-demos.ts` (`packApp`, `addAsMine`), `e2e/kitchen.ts`,
  `e2e/launcher-actions.ts` (`tileAction`), `e2e/name-prompt.ts`, `e2e/share-demo.ts`,
  `e2e/stranger-journey.ts`, `e2e/studio-helpers.ts`, `e2e/realm.ts`, `e2e/live-servers.ts`,
  `e2e/ui-questions.ts`, `e2e/voice.ts`. The launcher's own specs are in `e2e/launcher/`.
- Unit tests sit in each package's `test/`. Two-node store tests use
  `packages/store/src/peer-harness.ts`. The untrusted contract runs against both sealed runners
  through `packages/host/test/runners.ts`.

## Native

Behaviour: [Build for Android](../guides/build-for-android.md).

- `packages/native/src/index.ts` (`isNativePlatform`, deep links, the native vault, `fetchOver`,
  the share target, the system locale); `packages/native/src/capacitor-capabilities.ts`;
  `packages/native/capacitor.config.ts`; `packages/native/android-templates/`,
  `packages/native/ios-templates/`, `packages/native/scripts/`. The conformance suite runs the same
  `CapacitorCapabilities` for both platforms: `packages/native/test/conformance-capacitor.test.ts`.

## Section index of the six biggest files

`packages/shell/src/main.tsx`: `route` · `exportApp` · `replaceWithBundle` · `importApp` · `Home` ·
`mount` · `bootInviteIfPresent` · `openLinkedApp` · `bootDemo` · `runMigrationsIfPossible` ·
`bootUserApp` (the store, the runner, the runtime, dispose) · `show` · `canSwitchInPlace` ·
`offerAccountApps` · `openRealmProbe` · `boot` · `registerShares` · `registerDeepLinks` ·
`registerServiceWorker`.

`packages/shell/src/App.tsx`: `readReturning` and `holdReturning` · `GridTile` · `App`:
`landingPage`, `openStudio` and `closeStudio`, `newScope`, Fix this (`runFix`, `applyFix`),
`navigateRaw`, the recorder (`startRecording`, `onStopRecording`), `openRecord`, `triggerQuick`,
`translateInto`, `news`, `rerunApp`, `saveAdjusted`, `askStudioAbout`, `setTrust`, `backTo` ·
`Toasts`.

`packages/shell/src/launcher.tsx`: `openUserApp` · `goHome` · `openInstalledApp` · `Avatar` ·
`SyncMark` · `Tile` · `TileMenu` · `takeAddLink` · `Launcher`: `del`, `restore`, `toggleSync`,
`share`, `rename`, `duplicate`, `menuFor`, `toGallery`, `metroBody` and `body`.

`packages/shell/src/studio.tsx`: `useBarHeight` · `usePhoneFocus` · `useWide` · `nameAfter` ·
`modulesDiffer` · `Studio`: `say`, `engine`, `keep`, `land`, `send`, `fixHeld` and `keepHeld`,
`goBack`, the code by hand (`runDraft`, `saveDraft`), `replay`, the app itself (rename, copy,
`remove`), `copyLink`, `promotePreview`, `startPointing`.

`packages/store/src/jazz-store.ts` (`grep -a`): `SPACE_BUDGET` · `replayDerived` ·
`class JazzStore`: `describe` · `assertCreator` · CoValue plumbing (`loadMap`, `entityIndex`,
`recordMap`, `locate`) · records shared one by one (`homeFor`, `recordAccess`,
`createRecordInvite`, `joinRecord`) · `watchEntity` · lifecycle (`open`, `close`) · reads (`all`,
`get`) · messages (`postMessage`, `subscribeMessages`) · `editHistory` · writes (`insert`,
`update`, `increment`, `delete`, `transaction`) · collaborative text (`editText`, `textRuns`,
`textAnchor`, `textIndex`) · `removals` · `recordMembers` · `subscribe` · blobs (`putBlob`,
`getBlob`, `spaceUsage`) · kv · files (`listFiles`, `setFile`, `subscribeFiles`) · migrations.

`packages/store/src/jazz-backend.ts`: the key names (`groupKey`, `rootKey`, `dbKey`) ·
`createDurabilityTracker` · `browserKeys` · `loadAccountThroughRelay` · `storageOver` ·
`openAccountNode` · `createJazzStore` · `peekAppSpace` and `rememberAppSpace` ·
`warmDeviceDatabase` · `openAccountNodeInBrowser` · `openDeviceDatabase` · `deviceNode` ·
`openJazzStore` · `attachRelay` · `reviveOnResume` · `createSpaceInvite` · `joinSpace` ·
`publishProfileName`, `publishAccountName`, `readProfileName`, `publishName` · `spaceMembers` ·
`subscribeSpace` · `subscribeMemberProfiles` · `removeSpaceMember` · `myRole`.

## Next

- [Running the repository](running-the-repository.md): the packages and the seams this map sits on.
- [Tests](tests.md): the suites that guard these files.
- [Design notes](design-notes.md): the reasoning behind each concern.
