---
name: ctx-member
description: Add a member or capability to ctx (the host API apps receive) across every runner — types, direct ctx, the realm bridge, the QuickJS fallback, the store when needed, docs, the model-facing reference, the corpus. Use for "apps need to be able to…", a new ctx.caps.*, a new Store-backed ctx feature.
---

# A new `ctx` member

`ctx` is the only way app code reaches host power (CLAUDE.md rule 2). A member exists in every
runner or it does not exist: the direct ctx, the browser realm (over a MessagePort) and the QuickJS
fallback. Worked examples to copy from: `ctx.text` (collaborative text, 2026-11-06) and `ctx.access`
(per-record sharing) — grep for `text` and `access` in each file below.

## The chain, in order

1. **Types** — `packages/schema/src/types/ctx.ts`: the member on `Ctx` (or `CtxUi`, `CtxCaps`…),
   with a short comment: the comment is what the model reads. Keep it short; the reference has a
   budget. If the declarative side changes (a field option, an entity option), `types/fields.ts` or
   `types/app.ts` and the Zod schema in `packages/schema/src/validate.ts`.
2. **Store**, when the member needs storage — `packages/store/src/types.ts` (optional method on
   `Store`), the Jazz implementation (`jazz-store.ts`) and Memory/Sqlite where it makes sense; then
   EVERY place that enumerates Store methods: `packages/shell/src/read-only-store.ts` (forwards by
   name; its test lists the interface's methods), the copy site in `toggle-sync.ts`, the peer tests
   (`packages/store/src/peer-harness.ts`, `test/jazz-*.test.ts`).
3. **Direct ctx** — `packages/host/src/make-ctx.ts`; checks in `values-gate.ts` when app input
   must be validated (a position, a base text, a role).
4. **The realm** — `packages/host/src/realm/protocol.ts` (the message kind), `realm/ctx-proxy.ts`
   (the app's side, in the Worker), `realm/realm-host.ts` (the host's side). A member that returns a
   handle (like `ctx.text(...)`) is a family of kinds, one per method.
5. **QuickJS** — `packages/host/src/isolate/harness.ts` and `isolate/isolate-host.ts`, the same.
6. **Runtime** — `packages/runtime/src/core.ts` when writes must go through the WRITES proxy
   (so the screen refreshes), `create-runtime.ts` for rules the runtime passes down.
7. **Capabilities** — a `ctx.caps.*` member also needs `packages/capabilities` (interface, web
   implementation, the fake, the conformance suite) and `packages/native` when it has a native side.
8. **Docs** — docs/04 (the member, with an example an app would write) and docs/05 (the interface),
   in the same PR.
9. **The model** — `packages/generator/src/reference.ts`: a `CAPABILITIES` entry with `members`
   naming the new member, so it leaves the core and is read on demand; then
   `pnpm --filter @potyro/generator gen:reference` and `gen:corpus`. `test/reference.test.ts`
   fails when the core exceeds its budget: trim comments, never raise the budget.
10. **Spike stand-ins** — `docs/spikes/browser-realm/src/ctx-proxy.ts` has a ctx stand-in that
    must still type-check: add a stub.

## Tests

- `packages/host/test/<member>-ctx.test.ts`: the direct ctx AND both sealed runners, the refusals
  (`values-gate`), and a two-store flow where it applies (`createPeerPair` + `createHost`, as
  `text-two-editors.test.ts`).
- `packages/shell/test/read-only-store.test.ts` catches a Store method not forwarded.
- A browser spec with a real app using it, trusted and sealed.

## Traps

- A method missing from `read-only-store.ts` makes the host think the store cannot do it and fall
  back silently (whole-text rewrites doubled a document once).
- Position-based input must carry what it was counted against (`base`), and the host maps it.
- `schemaVersion` is never bumped for an additive, optional member.
- Potyro's own words in the shell for the feature go through `t`…`` and the catalogs.
