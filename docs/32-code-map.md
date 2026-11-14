---
title: Code map
description: Where each concern lives in the code — the files and entry points for sync, sharing, storage, the sealed realm, ctx, views, the shell, links, design, i18n, the generator, apps, CI — and a section index of the six biggest files.
status: current
order: 32
---

# Code map: where each concern lives

For an agent or a developer who knows what they want to change and needs the files. Each section
names the files that own a concern, the entry points in them, and the page that explains the design.
Function names are stable; line numbers are not, so none are given — `grep -n` the name. Four files
are read by `grep` as binary and print nothing: use `grep -a` on `packages/shell/src/app-source.ts`,
`packages/store/src/jazz-store.ts`, `packages/host/src/resolve.ts`, `packages/views/src/board.tsx`.
`pnpm lint:docs` checks that every path here exists.

The architecture itself is docs/00; the package table and the seams are docs/00 §The package map.

## Sync and spaces (cojson / Jazz)

Design: docs/00 §Sync, CRDT and identity; docs/adr/0001-sync-engine-and-identity.md. One cojson group ("space") per synced app,
a root CoMap per app, one CoMap per record; Potyro's relay is pinned `jazz-run sync`.

- `packages/store/src/jazz-backend.ts` — opening nodes and spaces, the relay, invites, members, names:
  `openAccountNode`, `openJazzStore` (the browser entry), `createJazzStore`, `openDeviceDatabase`,
  `deviceNode`, `attachRelay`, `reviveOnResume`, `createSpaceInvite`, `joinSpace`, `spaceMembers`,
  `subscribeSpace`, `removeSpaceMember`, `myRole`, `publishName`, `peekAppSpace`, `rememberAppSpace`
  (the `potyro:jazz:group|root|db:<ns>` keys), `warmDeviceDatabase`.
- `packages/store/src/jazz-store.ts` — `class JazzStore implements Store`: the CRDT store over CoMaps,
  CoText and binary streams; `SPACE_BUDGET` (what a space may put on the relay). Section index below.
- `packages/store/src/jazz-sqlite-driver.ts` — `createJazzSqliteDriver`: cojson storage over SQLite.
- `packages/shell/src/open-store.ts` — `openStore` picks the store for a namespace (`crdt-worker` when
  the app syncs); `syncRelayUrl`, `canSync`, `linkedDevice`, `watchSpace`/`liveSpace`/`onSpaceChange`,
  `accountNode`, `publishAppListToAccount`, `rememberAppOnAccount`, `forgetAppOnAccount`.
- `packages/shell/src/toggle-sync.ts` — `toggleAppSync`: sync on or off is a COPY into the other store
  (`describeTo` before the copy, so fields that need their own CoValue are created once).
- `packages/shell/src/share-sync.ts` — whole-app invites (`#join=`): `createShareLink`, `acceptInvite`,
  `pendingInvite`. `packages/shell/src/sync-consent.ts` — `askToSync`, `rememberSyncConsent`.
- `packages/identity/src/identity.ts` — `ensureIdentity`, `peekIdentity`, `recoveryPassphrase`,
  `signInWithPassphrase`, `portableIdentity`; `packages/identity/src/vault.ts` — the secret vault.
- The relay: dev `pnpm relay` (root `package.json`, `jazz-run sync --port 4201 --in-memory`); prod
  `deploy/containers.sh` `relay()` behind `deploy/potyro.app.Caddyfile`; docs/16 §3. Override with
  `VITE_POTYRO_RELAY`. (`packages/rooms`, `ai-relay`, `platform-requests` are other servers.)

## A record shared on its own

Design: docs/24 §12. A `share: "record"` entity puts each record in a group of its own that extends
the space; the records that point at it live there too, listed on it (`KIDS`).

- `packages/store/src/record-sharing.ts` — `KIDS`, `kidKey`, `kidId`, `childrenOf`, `roleToAccess`.
- `packages/store/src/types.ts` — the optional `recordAccess`, `createRecordInvite`, `joinRecord`,
  `recordMembers`; `StoreRules.sharedRecords`.
- `packages/store/src/jazz-store.ts` §"records shared one by one" — `homeFor`, `kidsMaps`,
  `recordAccess`, `createRecordInvite` (admin only), `joinRecord`, `assertMayWrite`.
- `packages/shell/src/read-only-store.ts` — forwards every optional Store method by name
  (`readOnlyStore`, `guardedStore`); its test reads the interface's method list.
- `packages/shell/src/record-share.ts` — `makeRecordLink`, `recordLinkOn` (also the viewer's),
  `prepareRecordShare` (turns sync on first), `recordLinkFor`, `joinRecordInto`, `SyncDeclined`.
- `packages/shell/src/record-link.ts` — the `#rec=` codec (`readRecordLink`, `withRecordLink`) and the
  hand-off across a reload (`holdRecordJoin`/`takeRecordJoin`, `holdRecordShare`/`takeRecordShare`).
- `packages/shell/src/main.tsx` `openLinkedApp`; `packages/shell/src/demo.tsx` `openDemo` (a stranger's
  viewer on a synced `demo:<line>` store). `packages/host/src/make-ctx.ts` `checkShare` → `ctx.access`.

## Collaborative text (`ctx.text`)

Design: docs/04 §Writing together. A `text` field with `collaborative: true` lives in a
`RawCoPlainText`; edits carry the text they were counted in (`base`) and the host maps them.

- `packages/store/src/text-field.ts` — `TEXT_REF`, `textRefOf`, `textFieldsOf`, grapheme/UTF-16 maps,
  anchors (`opAnchor`, `positionAnchor`, `END_ANCHOR`).
- `packages/store/src/jazz-store.ts` §"collaborative text" — `editText`, `textRuns`, `textAnchor`,
  `textIndex`, `newText`, `loadText`.
- `packages/host/src/text-queue.ts` `afterEarlierEdits` (one edit at a time per field);
  `packages/host/src/text-transform.ts` `mapEditsOnto`; `packages/host/src/values-gate.ts`
  `assertCollaborativeText`, `checkTextEdits`, `applyTextEdits`, `checkTextBase`.
- `packages/schema/src/types/ctx.ts` — `CtxText`, `TextEdit`, `TextRun`. Realm ops `text.*`.
- The first consumer: `apps/write-together/loop.ts` (`SyncLoop`, pure), `diff.ts` (`diffEdits`,
  `merge3`, `fitRuns`, `resolveColors`), `editor.tsx` (`useSharedText`, `Editor`).
- Tests that show the whole chain: `packages/host/test/text-ctx.test.ts`,
  `packages/host/test/text-two-editors.test.ts`, `packages/store/test/jazz-text.test.ts`.

## Storage on the device

Design: docs/00 §Storage; docs/06. One storage Worker owns one OPFS SAH pool with a database file per
app (`/<namespace>.sqlite3`); older homes are a per-app pool, IndexedDB snapshots and `localStorage`.

- `packages/store/src/sqlite-worker.ts` — the Worker: `install` (the pools), `open`, `remove`
  (delete op), `handle` (run/query/get/close), `letGoWhenIdle` (another tab took the storage).
- `packages/store/src/sqlite-worker-client.ts` — `openWorkerSqlite`, `openWorkerSqliteHandle`,
  `deleteWorkerSqlite`, `workerDbName` (the file name a namespace gets), `workersAvailable`,
  `onStorageElsewhere`, `takeOverStorageOnNextLoad`.
- `packages/store/src/storage-owner.ts` — the cross-tab Web Lock: `ownStorage`, `StorageElsewhereError`.
- `packages/store/src/storage-rescue.ts` — a browser that refuses its own storage: `setAside`, `putBack`, `StorageStuckError`; the screen is `StuckScreen` in `packages/shell/src/storage-elsewhere.tsx`.
- `packages/store/src/sqlite-store.ts` `SqliteStore`; `sqlite-backend.ts` `initSqlite`, `openOpfsDb`,
  `createSqliteStore`, `createMemorySqliteStore` (tests); `local-store.ts` `LocalStore`;
  `idb-sqlite.ts`; `memory-store.ts`; `migrate.ts`; `export.ts`; `copy-store.ts` `copyStoreData`.
- `packages/store/src/file-space.ts` — an app's Files over its Store: `fileSpace`, `normalisePath`.
- `packages/shell/src/open-store.ts` `openStore` — the mode order: `crdt-worker`, `worker`, `opfs`,
  `local-storage`; `mayFallBack`, `StoreBusyError`, `adoptLocalStorageData`.
- `packages/shell/src/erase-app-data.ts` — what deleting an app erases: `appStorageKeys`,
  `eraseAppData`, `appOpened`/`appClosed` (the file goes once the app is closed), `settleOwed`;
  `packages/shell/src/remove-app.ts` `confirmAndRemoveApp`; `user-apps.ts` `removeUserApp`.
- **Adding a Store method**: `types.ts` → the stores → `read-only-store.ts` → the copy site in
  `toggle-sync.ts` → `peer-harness.ts` for two-node tests → `ctx` (skill `ctx-member`).

## Sealed execution (the browser realm, the QuickJS fallback)

Design: docs/07; docs/22; docs/31. The app's logic runs in a Worker inside an opaque-origin sandboxed
iframe (`sandbox="allow-scripts"`, `REALM_CSP`); each custom view in a frame of its own.

- `packages/host/src/realm/realm-host.ts` — the host side: `createRealmLoader`, `RealmLoadedApp`.
- `packages/host/src/realm/frame.ts` — the srcdoc frames: `frameSpawner`, `spawnViewFrame`,
  `realmDocument`, `viewDocument`; `worker-runtime.ts` (`boot`, `load`, `run` inside the Worker);
  `view-runtime.ts` (a sealed view inside its frame); `ctx-proxy.ts` `makeRealmCtx` (ctx as RPC).
- `packages/host/src/realm/protocol.ts` — `CallKind`, `OPS` (every ctx op by name), `VIEW_OPS`,
  `HostToRealm`/`RealmToHost`, `HostToView`/`ViewToHost`, `REALM_CSP`.
- `packages/host/src/realm/sealed-view.ts` `SealedViewController`; `place-watch.ts` (told when the view's
  place moves, so its height is measured again); `view-watchdog.ts`; `view-guard.ts` (crash-loop
  guard); `form-submit-shim.ts`; `realm-sockets.ts`; `realm-speech.ts`; `port-transport.ts`.
- `packages/host/src/isolate/isolate-host.ts` `createIsolateLoader`, `IsolateLoadedApp`; `harness.ts`
  `HARNESS_SOURCE`; `marshal.ts`. (Behind a flag: `localStorage["potyro:sandbox"] = "quickjs"`.)
- `packages/shell/src/isolate-bridge.ts` `createSandboxLoader`, `createSharedAppLoader`;
  `packages/shell/src/isolate-stubs/` (the `potyro` and React stand-ins inside the box).
- The shell's own CSP (`frame-src 'none'`): `packages/shell/index.html`, `packages/shell/vite.config.ts`
  (`SHELL_CSP`), `deploy/potyro.app.Caddyfile`. The probe screen: `packages/shell/src/realm-probe.ts`.
- Dev: `pnpm dev:sandbox` seeds the examples sealed; specs named `*-sandbox.spec.ts`; a sealed
  app's screens are in `.k-sealed-view iframe` frames, its sheets on the shell's page.

## `ctx` and the host

Design: docs/04 (every member, with examples); docs/05 (the interfaces).

- `packages/schema/src/types/ctx.ts` — `Ctx`, `Caps`, `CtxUi`, `CtxText`, `CtxFiles`, `CtxStorage`,
  `CtxViews`, `CtxFormat`, `CtxMedia`, `CtxGuests`, `Space`, `Member`, `Person`, `RecordLink`,
  `ShareAppLink`, `Access`; `types/app.ts` (`AppDefinition`, `EntityDef`), `types/fields.ts`,
  `validate.ts` (Zod for the declarative parts).
- `packages/host/src/make-ctx.ts` `buildCtx` — the direct ctx; `checkShare`, `checkShareFiles`,
  `filesFor`. `values-gate.ts` — every check of app input: `assertValuesFit`, `assertPatchFits`,
  `assertCountable`, the text checks. `resolve.ts` (grep -a) — relation resolution.
- `packages/runtime/src/core.ts` `RuntimeCore` (the WRITES proxy that refreshes the screen);
  `create-runtime.ts` `createRuntime`; `activity.ts` (the Changes feed as record events).
- The model's view of ctx: `packages/generator/src/reference.ts` — `REFERENCE_FILES` (the CORE in
  every prompt, with a hard budget), `LOOKUP_ONLY_FILES`, `CAPABILITIES` (read on demand; a new
  member goes here with `members`), `buildReference`; `packages/generator/scripts/build-reference.ts` writes
  `reference.generated.ts`; `test/reference.test.ts` fails on a stale file or a busted budget.

## Views

Design: docs/05 §View contract; docs/03 (the declarative side).

- `packages/views/src/registry.ts` `defaultRegistry` (list, gallery, table, detail, custom, calendar,
  map, steps, checklist, board, timeline, stats, chart, aggregate), `resolveViewComponent`.
- `packages/views/src/builtins.tsx` `ListView`, `GalleryView`, `TableView`, `EmptyState`,
  `RowActions`; `checklist.tsx` `ChecklistView`; `map.tsx` `MapView` (MapLibre); `board.tsx` (grep -a);
  `calendar.tsx`; `steps.tsx`; `timeline.tsx`; `stats.tsx`; `chart.tsx`; `aggregate.tsx`.
- `packages/views/src/custom.tsx` `CustomView` → `MountedView` (trusted `mount`) or
  `SealedCustomView` (a realm frame). `record-form.tsx` `RecordForm`, `ValuesForm`, `createDefaults`.
- `packages/views/src/cells.ts` `useDisplayCells`; `format.ts` `formatValue`, `fieldLabel`, `getView`;
  `news.ts` `NewsContext`, `useNews` (a hook: call it before any early return); `page-count.ts`.
- Styles are the shell's: `packages/shell/src/styles.css` §Built-in views (section index below).

## The shell

Design: docs/00 §An app's life; the composition root is `main.tsx`.

- `packages/shell/src/main.tsx` — `boot` (identity, routing, first render), `bootUserApp` (opens a
  saved app: the store, the runner by provenance, the runtime, `appOpened`/`appClosed`), `bootDemo`,
  `bootInviteIfPresent`, `openLinkedApp`, `show`, `offerAccountApps`, `exportApp`/`importApp`,
  `registerServiceWorker`, `registerShares`, `registerDeepLinks`.
- `packages/shell/src/App.tsx` `App` — one app's whole screen: chrome, pages, edit mode, Studio,
  "Something's wrong" recorder, Fix this, translate, trust; `GridTile`; `Toasts`.
- `packages/shell/src/chrome.tsx` `AppChrome` → `PhoneChrome` / `WideChrome`, `FullscreenFrame`.
- `packages/shell/src/launcher.tsx` `Launcher`, `Tile`, `TileMenu`, `openInstalledApp`;
  `launcher-metro.tsx` `MetroHome`, `StartPane`, `AllApps`; `launcher-store.ts` (entries, order,
  pins, attention: `listInstalledApps`, `useInstalledApps`, `appKey`); `user-apps.ts` (the saved apps
  in `localStorage`: `listUserApps`, `saveUserApp`, `removeUserApp`, `setUserAppSync`…).
- `packages/shell/src/add-app.ts` `gatherFromFiles`/`gatherFromLink`/`gatherFromPaste`,
  `inspectPackage`, `installPackage`, `applySeed`, `applyShippedFiles`, `remixOf`; `add-app-dialog.tsx`.
- `packages/shell/src/app-source.ts` (grep -a) — edits the declarative half of an app by splicing
  text, no model: `inspect`, `applyEdit`, `declaredSync`, `declaredPermissions`.
- `packages/shell/src/ui-bridge.ts` `createUiBridge` (what `ctx.ui` does in the shell: toasts,
  dialogs, pickers, share, record links), `createNavBridge`; `dialog.tsx` `DialogHost` (ONE dialog at
  a time), `shellDialogs`; `share-body.tsx` `ShareBody` (Copy, Copy link, the device's sheet).
- Trust and provenance: `trust-dialog.tsx`, `promotion.ts`; per-app standings: `ai-setting.ts`,
  `app-sockets.ts`, `app-speech.ts`; identity panel: `identity-panel.tsx`; the Data page:
  `data-runtime.ts`; files: `files-panel.tsx`, `device-files.tsx`, `shipped-files.ts`, `seed-files.ts`.

## Share links, demos, the gallery

Design: docs/24 (§11 a link to a page, §12 a link to a record, §10 the gallery).

- `packages/shell/src/demo-link.ts` `readDemoLink`, `inlineDemoLink`, `demoLinkText`, `remixLink`;
  `demo-share.ts` `makeDemoLink`, `previewMeta`; `share-service.ts` `hostDemo`, `fetchHostedPackage`,
  `GoneError`/`TakenDownError`/`TooManyError`; `preview-card.ts` `renderPreviewCard`.
- `packages/shell/src/app-link.ts` `readAppTarget`, `withAppTarget`, `matchLinkedApp`,
  `holdArrival`/`takeArrival`; `app-link-make.ts` `makeAppLink`, `demoLinkFor`, `siteRoot`.
- `packages/shell/src/demo.tsx` `loadDemoPackage`, `openDemo` (sealed, on records in memory, or live
  on a synced store for a record link), `DemoScreen` (the bar: Keep, Make it mine, Report).
- `packages/share-links/src/` — the share service (server.ts, handler.ts, page.ts, store.ts, wire.ts);
  `packages/share-links/scripts/takedown.mjs`.
- `gallery/gallery.json` (the page's order), `gallery/shots/`, `gallery/src/build.mjs`
  (`pnpm gallery:build`), `gallery/src/publish.mjs` (`pnpm gallery:publish`), `gallery/test/`.

## Design system, styles, i18n

- `packages/design/README.md` first. `packages/design/source/` (DESIGN.md, REDACAO.md, the tokens
  and logo as delivered), `packages/design/tokens.css`, `packages/design/src/` (`color.ts` the colour
  clock, `seal.ts`, `lucide.ts` `lucidePath`), `packages/design/scripts/` (tokens, lucide, split-logo).
- `packages/shell/src/styles.css` (18k lines; `pnpm lint:tokens` keeps it on the tokens). Its sections,
  in order: Tokens; Edit mode; The ground; Page header; The ONE primary action; Lists; Empty page;
  Gallery; Table; Record page; Camera on; Studio conversation; Model settings; History tab; the
  recorder, Replay report, Cases, FixPanel; Ask; Start screen; Content first; Type rule; Logo; Icons;
  Home; App chrome; Built-in views; The Studio. Grep `/* ----` for the headings.
- `packages/i18n/src/` (i18n.ts, locale.ts, format.ts, react.tsx, app-catalogs.ts, pseudo.ts,
  wording.ts); catalogs `packages/i18n/locales/<lang>/messages.po` (en, de, es, it, pl, pt-BR);
  `pnpm i18n:extract`; `scripts/check-i18n.mjs` (`pnpm lint:i18n`; `// i18n-ignore — why` is the escape).
- An app's own words: docs/30 — `apps/<id>/locales/<lang>.po`, `examples/files/<id>/locales/`,
  made by `pnpm i18n:app` (`packages/generator`, the translate tool).

## The generator and the Studio

Design: docs/00 §The Studio and the generator; docs/23 (AI in apps).

- `packages/generator/src/prompt.ts` `SYSTEM_PROMPT`, `buildUserMessage`, `capabilityPassages`;
  `agent/system-prompt.ts`, `agent/create-system-prompt.ts`, `agent/modify-system-prompt.ts`.
- Loops: `agent/loop.ts` `runAgentLoop`; `agent/create-loop.ts` `runCreateLoop`; `agent/modify-loop.ts`
  `runModifyLoop`; `agent/tools.ts`, `agent/discovery-tools.ts` (`lookupReference`), `agent/ask.ts`,
  `agent/conversation.ts`, `agent/loop-recovery.ts`, `agent/verify-claims.ts`, `agent/translate-tool.ts`.
- The corpus: `src/corpus.ts` `buildCorpus`, `src/corpus-files.ts`, `packages/generator/scripts/build-corpus.ts` →
  `src/corpus.generated.ts` (`pnpm --filter @potyro/generator gen:corpus`; `test/corpus.test.ts`).
- Backends: `openrouter-backend.ts` (`OPENROUTER_MODELS`), `claude-backend.ts`, `cli-backend.ts`,
  `webllm-backend.ts`, `gemini-nano-backend.ts`, `hybrid-backend.ts`, `backend.ts` (`FixtureBackend`).
- Evals: `packages/generator/src/*-eval.ts` run by `packages/generator/scripts/run-*-eval.ts`
  (the `eval:*` scripts; paid — never without being asked). `packages/generator/scripts/i18n-app.ts` is `pnpm i18n:app`.
- The Studio in the shell: `studio.tsx` `Studio`; `studio-engine.ts`; `studio-preview.tsx`
  `buildPreview`; `studio-tools.tsx`; `studio-thread-view.tsx`, `studio-thread.ts`, `studio-chat.ts`;
  `start-create.ts`, `start-modify.ts`, `start-ask.ts`, `start-fix.ts`; `generate-client.ts`.
- Chat between people: `chat-panel.tsx`, `chat-sync.ts`, `share-chat.ts`. Requests to the team:
  `packages/platform-requests/src/`, `packages/shell/src/platform-requests.ts`. The free allowance:
  `packages/ai-relay/src/`.

## Apps, examples, packaging

- `apps/<id>/` — `<id>.app.tsx`, `package.json` (`@potyro/app-<id>`; `build` packs with
  `scripts/pack-app.mjs`, optional `--seed seed.json`), `README.md`, `test/`, own modules, optional
  `locales/`. Skill `new-app` has the recipe. `examples/*.app.ts(x)` are the six fixtures; their
  shipped files in `examples/files/`.
- `packages/schema/cli/pack.mjs` `pack` (the `potyro pack` CLI, `packages/schema/bin/potyro.mjs`);
  `packages/store/src/app-package.ts` (the zip's shape), `app-lock.ts` (libraries and modules
  pinned), `carried-code.ts`; `packages/create-potyro/template/`.
- Tutorials: `docs/tutorials/`, code in `docs/tutorials/code/` (`@potyro/tutorials-code` tests it).

## Tests, CI, shipping

Design: docs/09; `CONTRIBUTING.md` §The gate; skill `ship-pr`. (The owner's operations notes are private.)

- `scripts/ci-local.mjs` — the gate: `STEPS` install, build, unit, typecheck, lint (boundaries,
  tokens, i18n, docs), `e2e:1..N` (Chromium shards of the trusted and sandbox projects); `ff:*` is
  Firefox, outside the verdict; `status [--post]`, `deploy`; results in `.ci-local/<sha>/`.
- `scripts/ci-watch.mjs` — the watcher on the CI machine: tests main, deploys potyro.app when green.
  `scripts/ship.mjs`, `scripts/ci-select.mjs` (which specs a change touches), `scripts/ci-timings.mjs`.
- Checks: `scripts/check-boundaries.mjs`, `scripts/check-tokens.mjs`, `scripts/check-i18n.mjs`,
  `scripts/check-doc-paths.mjs`, `scripts/docs-index.mjs`, `scripts/check-agent-map.mjs`.
- `playwright.config.ts` — projects trusted, sandbox, sandbox-quickjs, the Firefox and WebKit
  variants, prod; `e2e/ports.ts` (`PORT_BLOCK`, `PORTS`); `e2e/console-guard.ts` (`test`: a spec fails
  on an unexpected console error); `e2e/engines.ts` (engine differences, never weaker assertions).
- e2e helpers: `e2e/library-demos.ts` (`packApp`, `addAsMine`), `e2e/kitchen.ts`, `e2e/launcher-actions.ts`
  (`tileAction`), `e2e/name-prompt.ts`, `e2e/share-demo.ts`, `e2e/stranger-journey.ts`,
  `e2e/studio-helpers.ts`, `e2e/realm.ts`, `e2e/live-servers.ts`, `e2e/ui-questions.ts`, `e2e/voice.ts`.
- Unit tests sit in each package's `test/`; two-node store tests use `packages/store/src/peer-harness.ts`.

## Native

- `packages/native/src/index.ts` (`isNativePlatform`, deep links, the native vault, `fetchOver`,
  share target, system locale); `capacitor-capabilities.ts`; `capacitor.config.ts`;
  `packages/native/android-templates/`, `ios-templates/`, `scripts/`. docs/13 (Android), docs/27 (iOS).

## Section index of the six biggest files

`packages/shell/src/main.tsx` — `route` · `exportApp` · `replaceWithBundle` · `importApp` · `Home` ·
`mount` · `bootInviteIfPresent` · `openLinkedApp` · `bootDemo` · `runMigrationsIfPossible` ·
`bootUserApp` (the store, the runner, the runtime, dispose) · `show` · `canSwitchInPlace` ·
`offerAccountApps` · `openRealmProbe` · `boot` · `registerShares` · `registerDeepLinks` ·
`registerServiceWorker`.

`packages/shell/src/App.tsx` — `readReturning`/`holdReturning` · `GridTile` · `App`: `landingPage`,
`openStudio`/`closeStudio`, `newScope`, Fix this (`runFix`, `applyFix`), `navigateRaw`, the recorder
(`startRecording`, `onStopRecording`), `openRecord`, `triggerQuick`, `translateInto`, `news`,
`rerunApp`, `saveAdjusted`, `askStudioAbout`, `setTrust`, `backTo` · `Toasts`.

`packages/shell/src/launcher.tsx` — `openUserApp` · `goHome` · `openInstalledApp` · `Avatar` ·
`SyncMark` · `Tile` · `TileMenu` · `takeAddLink` · `Launcher`: `del`, `restore`, `toggleSync`,
`share`, `rename`, `duplicate`, `menuFor`, `toGallery`, `metroBody`/`body`.

`packages/shell/src/studio.tsx` — `useBarHeight` · `usePhoneFocus` · `useWide` · `nameAfter` ·
`modulesDiffer` · `Studio`: `say`, `engine`, `keep`, `land`, `send`, `fixHeld`/`keepHeld`, `goBack`,
the code by hand (`runDraft`, `saveDraft`), `replay`, the app itself (rename, copy, `remove`),
`copyLink`, `promotePreview`, `startPointing`.

`packages/store/src/jazz-store.ts` (grep -a) — `SPACE_BUDGET` · `replayDerived` · `class JazzStore`:
`describe` · `assertCreator` · §CoValue plumbing (`loadMap`, `entityIndex`, `recordMap`, `locate`) ·
§records shared one by one (`homeFor`, `recordAccess`, `createRecordInvite`, `joinRecord`) ·
`watchEntity` · §lifecycle (`open`, `close`) · §reads (`all`, `get`) · §messages (`postMessage`,
`subscribeMessages`) · `editHistory` · §writes (`insert`, `update`, `increment`, `delete`,
`transaction`) · §collaborative text (`editText`, `textRuns`, `textAnchor`, `textIndex`) · `removals` ·
`recordMembers` · `subscribe` · §blobs (`putBlob`, `getBlob`, `spaceUsage`) · §kv · §files
(`listFiles`, `setFile`, `subscribeFiles`) · §migrations.

`packages/store/src/jazz-backend.ts` — the key names (`groupKey`, `rootKey`, `dbKey`) ·
`createDurabilityTracker` · `browserKeys` · `loadAccountThroughRelay` · `storageOver` ·
`openAccountNode` · `createJazzStore` · `peekAppSpace`/`rememberAppSpace` · `warmDeviceDatabase` ·
`openAccountNodeInBrowser` · `openDeviceDatabase` · `deviceNode` · `openJazzStore` · `attachRelay` ·
`reviveOnResume` · `createSpaceInvite` · `joinSpace` · `publishProfileName`/`publishAccountName`/
`readProfileName`/`publishName` · `spaceMembers` · `subscribeSpace` · `subscribeMemberProfiles` ·
`removeSpaceMember` · `myRole`.
