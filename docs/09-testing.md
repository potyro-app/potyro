# 09 · Testing Strategy

Tests are per-WP and ship in the same PR as the code. Two things need special discipline: the
**host isolate** (untrusted code must not escape its sandbox or exceed limits) and the
**capability implementations** (web vs native must behave identically).

## Layers

- **Unit** (Vitest, every package): pure logic — parser, evaluator, validator, query planner,
  migration ops, Store CRUD against `MemoryStore`.
- **Host / isolate tests** (`host`): (a) **DirectHost** calls functions in-process and returns
  correct values; (b) **IsolateHost** runs untrusted bundles in QuickJS-WASM and an adversarial
  fixture that tries to reach `fetch`/`globalThis`/filesystem/another app's data **fails closed**;
  (c) memory ceiling and timeout abort a runaway app; (d) `makeCtx` mediation: an ungranted cap
  is absent, a granted one is the scoped wrapper; (e) marshalling round-trips records/params/values.
- **Integration** (`runtime`): load each `examples/*.app.ts` (via DirectHost), run
  representative JS-filter queries and actions against `MemoryStore` + `FakeCapabilities`,
  assert resolved relations, memoized computed values, and reminder scheduling. Run at least one
  example a second time via **IsolateHost** to prove parity between trusted and untrusted execution.
- **View tests** (`views`): render each view against a fixture runtime; assert bindings and,
  for `steps`, the transient done-state behavior.
- **Conformance suite** (`pnpm conformance`): the same behavioral spec run against **both**
  `WebCapabilities` and `CapacitorCapabilities` (native via device/emulator or mocked bridge)
  so the two targets can't silently diverge. Notifications assert the
  `supportsExactScheduling` contract per platform.
- **E2E smoke** (`shell`): headless load of each example, basic navigation, import/export
  round-trip. (jsdom for logic; a real browser runner for the PWA install/offline path.)

## Must-pass invariants (encode as tests)

1. **Untrusted code is contained:** an adversarial app run via IsolateHost cannot reach network,
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
