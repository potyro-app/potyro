# Potyro

**Potyro is an offline-first runtime that loads a TypeScript app module and runs it as a
working, native-capable personal app.**

You write (or have a model write) a `*.app.ts` module: it declares your data **shape** (entities,
fields, pages) as plain data, and everything that is **logic** (computed values, filters, actions,
reminders, even whole custom views) as ordinary TypeScript functions. Full language. Real imports,
loops, conditionals, types, debugging. A single runtime shell loads that module and renders a usable
app with local persistence, camera, notifications, geolocation, sync and sharing. No per-app build.
No cloud requirement. No visual builder. No little DSL to hit the wall of.

<!-- shot: launcher -->

**Start here:** [How Potyro works](docs/00-how-potyro-works.md), the architecture layer by layer for a
developer. The gallery of apps is at [potyro.com](https://potyro.com).

## The core decision

Logic is JavaScript/TypeScript, not a restricted expression language. Every "safe little DSL"
eventually reinvents variables, conditionals, loops and a bad module system; you end up rebuilding JS
badly and still hitting walls. Potyro refuses that. **The language is unrestricted. What Potyro
controls is the *capability surface* handed to your code (`ctx`) and the *execution boundary* it runs
in, two things that are independent of the language.**

- **Structure stays declarative.** Entities, fields and view layout are data. That gives you storage,
  forms, validation and migrations for free; it is a schema, not a DSL.
- **Logic is full code.** Computed, filter, action, reminder and custom view are functions that
  receive `ctx`, the host API surface. Full control means a rich `ctx`, not a permissive parser.

## Power and safety are different axes

The only property worth protecting is: *I can open an app someone sent me without it wrecking my
machine.* That is **not** a language restriction. It is an execution choice, made per app by
**provenance**:

- **Your own apps run direct.** Full host context, real imports, the device's capabilities. Zero
  sandbox, zero ceremony. This is the daily driver and the "I just want to write code" path.
- **Received and shared apps run sealed.** The *same source* runs in a Worker inside an opaque-origin
  sandboxed iframe with a strict CSP, reaching host power only through the same `ctx`, mediated:
  capabilities denied by default and granted per consent, a watchdog on every call, each custom view
  in a sandboxed frame of its own. Same language, same functions; only the injected authority
  differs. (QuickJS-WASM remains as the fallback box behind a flag.)

Same code, two authority levels. The language is never the thing that is limited.

## Non-negotiable invariants

1. **Logic is real TS; structure is declarative data.** Don't reintroduce an expression DSL.
2. **`ctx` is the whole API surface.** All host power (data, time, caps, storage, files, people, ui,
   nav) reaches app code through `ctx`. Enriching the system = enriching `ctx`.
3. **Execution boundary is chosen by provenance, not by the app.** Trusted → direct; untrusted →
   the sealed realm with mediated caps and a permission prompt.
4. **Offline-first, including authoring.** Runtime and authoring work with no network. Servers are
   optional (sync, demo links, rooms, AI) and clearly separated.
5. **One codebase, two targets.** PWA and Capacitor share the runtime; native is additive.
6. **Everything behind a seam.** `Store` (persistence) and `Capabilities` (device) are interfaces;
   they *are* what `ctx` exposes. Swapping SQLite for the CRDT store, or web for native, never
   touches app code or views.

## What works today

- Your own apps run direct; apps from anyone else run sealed in the browser realm, with consent
  prompts, a watchdog and a crash-loop guard.
- Records in SQLite over OPFS, in a worker, with one tab owning the storage; migrations; export to
  a zip with a real SQLite file, JSON and CSV inside.
- Sync, opt-in per app: end-to-end encrypted spaces on Jazz (cojson) behind a relay that holds only
  ciphertext; an identity derived from a seed with no signup; recovery words for a second device.
- Sharing three ways: an invite into an app's data, a demo link anyone can try with sample records,
  and rooms for multiplayer apps.
- Device capabilities through `ctx.caps`: camera, live camera, notifications, geolocation, haptics,
  files, network and sockets, AI, the share sheet, voice.
- Android and iOS through Capacitor, with native capabilities and the platform keystore.
- The Studio: describe an app, change it, fix it by recording what went wrong, point at the part you
  mean, in your language, with one of five model engines, every candidate gated before it is kept.
- Twenty-one real apps in `apps/`, six example apps in `examples/`, the gallery on potyro.com, and a
  tutorial for writing apps outside this repo.

## Repository map

```
README.md                       ← you are here
docs/00-how-potyro-works.md     ← START HERE: the architecture, layer by layer
docs/README.md                  ← every doc, with its status
CLAUDE.md                       ← the working agreement for agents and people working here
packages/                       ← the workspace: schema, store, host, runtime, views, shell, …
apps/                           ← 21 real apps, each an installable package
examples/                       ← the six living fixtures the tests are written against
docs/tutorials/                 ← writing Potyro apps outside this repo
gallery/                        ← the gallery site on potyro.com
e2e/                            ← the browser suite
```

## Run it

Node 22 and pnpm.

```sh
pnpm i
pnpm dev            # the shell on Vite's dev server; the examples are seeded as your own apps
pnpm dev:sandbox    # the same, with the examples seeded as shared apps, to exercise the sealed box
pnpm -r test        # unit tests, every package
pnpm e2e            # the browser suite (one worker, on purpose)
```

To write an app outside this repo: `npm create potyro@latest my-app`, then
[Your first Potyro app](docs/tutorials/01-your-first-app.md).

## Testing

The strategy is docs/09 and the one-page summary is in
[How Potyro works](docs/00-how-potyro-works.md#testing-in-one-page). To try Potyro and give feedback,
see docs/12.
