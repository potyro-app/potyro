# 09 · Testing Strategy

Tests are per-WP and ship in the same PR as the code. Two things need special discipline: the
**sealed box** (untrusted code must not escape its sandbox or exceed limits) and the
**capability implementations** (web vs native must behave identically).

## Layers

- **Unit** (Vitest, every package): pure logic — parser, evaluator, validator, query planner,
  migration ops, Store CRUD against `MemoryStore`.
- **Host tests** (`host`): (a) **DirectHost** calls functions in-process and returns correct
  values; (b) the **untrusted contract** (`untrusted-host.test.ts`, `scope-ctx`, `value-gate`,
  `files-ctx`, `words-parity`, `isolate-view-controls`, `computed-def`) runs against **both** sealed
  runners while both exist (`test/runners.ts`): the browser realm — its worker runtime in a Node
  worker thread, the host side the product's — and QuickJS-WASM; (c) a deadline and the realm's
  heartbeat abort a runaway app, and the thread is really gone (`realm-host.test.ts`, with the op
  allow-list, the flood guard and mediated fetch); (d) `makeCtx` mediation: an ungranted cap is
  absent, a granted one is the scoped wrapper; (e) values round-trip. Containment is a browser
  property, so it is asserted in a browser: an adversarial app that tries to reach the network, the
  shell's storage or another identity **fails closed** (`e2e/realm-escape-sandbox.spec.ts`, counted
  at a probe server, with a trusted control), and the shell's `frame-src 'none'` is checked where it
  is served (`e2e/shell-csp-*.spec.ts`). QuickJS's own containment test stays in the contract suite.
- **Integration** (`runtime`): load each `examples/*.app.ts` (via DirectHost), run
  representative JS-filter queries and actions against `MemoryStore` + `FakeCapabilities`,
  assert resolved relations, memoized computed values, and reminder scheduling. Run at least one
  example a second time sealed to prove parity between trusted and untrusted execution; the
  `*-sandbox.spec.ts` e2e specs run every example untrusted in the realm (`POTYRO_QUICKJS=1` runs
  them on the QuickJS fallback, `POTYRO_REALM_BROWSERS=1` the realm's own specs in Firefox and WebKit).
- **View tests** (`views`): render each view against a fixture runtime; assert bindings and,
  for `steps`, the transient done-state behavior.
- **Conformance suite** (`pnpm conformance`): the same behavioural spec run against **both**
  `WebCapabilities` and `CapacitorCapabilities` (over a mocked bridge), so the two targets cannot
  silently diverge — a difference between them does not surface as a failing test but as an app that
  works in the browser and quietly does nothing on a phone. The checks live in
  `packages/capabilities/src/conformance.ts` and each target runs the list:
  `capabilities/test/conformance-web.test.ts`, `native/test/conformance-capacitor.test.ts`. A target
  declares what it legitimately lacks and what it claims about `supportsExactScheduling` (web: no,
  native: yes) — the difference is asserted rather than papered over. Two tests point the suite at
  deliberately wrong targets, so a suite nothing can fail would itself fail. What only a device can
  prove — a notification firing with the app closed — stays the device checklist in docs/13.
  **iOS** runs the same `CapacitorCapabilities`, so the same suite covers it; what differs is
  declared, not forked: on iOS the adapter is built with `maxPendingNotifications: 64` (iOS drops
  pending notifications past 64 per app without an error), and `test/pending-limit.test.ts` holds that
  the soonest 64 are what stays pending whatever the scheduling order. The generated Xcode project's
  patch (`scripts/patch-plist.mjs`) has its own tests beside the manifest's. The iOS device checklist
  is docs/27 §5; nothing in it has been run yet.
- **E2E smoke** (`shell`): headless load of each example, basic navigation, import/export
  round-trip. (jsdom for logic; a real browser runner for the PWA install/offline path.)

## Must-pass invariants (encode as tests)

1. **Untrusted code is contained:** an adversarial app run sealed cannot reach network,
   filesystem, globals, or another app's store; ungranted caps are absent; limits abort runaways.
   (Trusted apps intentionally have full authority — not a failure.)
2. **Every example type-checks (tsc) and validates** (schema Zod over declarative parts) on CI.
3. **Migration determinism:** applying `migrations` from version A→B yields identical data
   regardless of intermediate steps; round-trip export/import is lossless.
4. **Offline:** runtime + store + web capabilities function with network disabled (mock
   `fetch` to throw); only the optional map-tiles and optional push-relay paths may require
   network, and their absence must degrade, not crash.
5. **Seam integrity (architectural test):** `views` must not import `store`/`host`/
   `capabilities`; `runtime` must not import concrete impls; **app functions reach host power
   only via `ctx`** (an app module importing a host internal is a CI failure). Enforce with an
   eslint boundary rule / dependency-cruiser.

## CI

`pnpm -r build && pnpm -r test && pnpm typecheck && pnpm conformance && pnpm lint:boundaries`
on every PR.
Green required to merge. Keep the example apps as living fixtures — if a change breaks one,
that's a real regression, not a fixture to "fix".
