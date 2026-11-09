# Potyro

**The app you need, made by you.** Describe it in a sentence, or start from one somebody else made,
and use it on your phone a minute later: a list for the garden, a game for the table, a ledger for
the trip. Your data stays on your device unless you choose to share it. Apps other people made run
in a safe box, so you can try a stranger's app without fear.

<!-- shot: launcher -->

Try it at [potyro.app](https://potyro.app); browse the apps at [potyro.com](https://potyro.com).

## For developers

Potyro is an offline-first runtime for small personal apps. An app is one TypeScript module: its
**structure** (entities, fields, pages) is plain data, and all its **logic** (computed values,
filters, actions, reminders, custom views) is ordinary TypeScript receiving `ctx`, the host's API.
No expression language, no per-app build, no cloud requirement. The runtime renders the module as a
working app with local persistence, device capabilities, sync, sharing and a model-driven Studio
that writes and changes apps from a description.

Two things make it safe to run anyone's code: the host hands app code its power only through `ctx`,
and **where** code runs is decided by who wrote it. Your own apps run directly; an app someone sent
you runs in a sandboxed browser realm with capabilities denied by default and granted on consent.
Same language, same functions, different authority.

**Start here:** the [documentation](https://potyro.com/docs/) ([docs/](docs/README.md) in this
repository): [Introduction](docs/start/introduction.md), then
[Your first app](docs/start/your-first-app.md) after `npm create potyro@latest my-app`. How Potyro
is put together, for someone changing it: [How Potyro works](docs/00-how-potyro-works.md).
An agent asked to make an app as a package reads [AGENTS.md](AGENTS.md).

## What is in the box

- **Runtime and shell**: records in SQLite in the browser's private storage, forms, views, migrations,
  export; a PWA and, through Capacitor, Android and iOS from the same code.
- **Capabilities** through `ctx.caps`: camera, notifications, geolocation, files, network and
  sockets, the share sheet, voice, AI.
- **Together**: end-to-end encrypted sync between your devices and the people you invite, demo links
  anyone can try, rooms for multiplayer apps, documents several people write at once.
- **The Studio**: describe an app, change it, fix it by showing what went wrong; a free allowance or
  your own model key.
- **Apps**: the real ones in `apps/`, the example fixtures in `examples/`, all on potyro.com.

## Repository map

```
docs/README.md                  ← every page of the documentation, and the engineering notes
docs/start, concepts, guides,   ← the documentation as published at potyro.com/docs
  reference, contributing
docs/00-how-potyro-works.md     ← the architecture, layer by layer, for someone changing Potyro
docs/32-code-map.md             ← where each concern lives: the files and entry points
CLAUDE.md                       ← the working agreement for agents and people working here
packages/                       ← the workspace: schema, store, host, runtime, views, shell, …
apps/                           ← the real apps, each an installable package
examples/                       ← the living fixtures the tests are written against
docs/tutorials/code/            ← the tutorials' code, one folder per stage
gallery/                        ← the gallery site on potyro.com
e2e/                            ← the browser suite
```

## Run it

Node 22 and pnpm.

```sh
pnpm i
pnpm dev            # the shell on Vite's dev server; the examples are seeded as your own apps
pnpm dev:sandbox    # the same, with the examples seeded as shared apps, to exercise the sandbox
pnpm -r test        # unit tests, every package
pnpm e2e            # the browser suite (one worker, on purpose)
```

The tests, and what must stay green: [Tests](docs/contributing/tests.md).

## Open source, hosted by us

Everything here is Apache License 2.0: the runtime, the shell, the Studio, the apps and the servers
around them. potyro.app and potyro.com are hosted instances of this code, run by the maintainer;
[Self-host Potyro](docs/guides/self-host.md) says how to run your own.
[Your apps and other people's apps](docs/concepts/trusted-and-sealed.md) explains the sandbox, what
our servers can see and what is not protected; to report a vulnerability
see [SECURITY.md](SECURITY.md), never a public issue.

© 2026 Edgar Zanella Alvarenga. [LICENSE](LICENSE), third-party material in [NOTICE](NOTICE); the
tutorial code and the `npm create potyro` template are MIT No Attribution. Contributions are welcome
under [CONTRIBUTING.md](CONTRIBUTING.md); [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies.
