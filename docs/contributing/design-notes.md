---
title: Design notes
description: The numbered engineering notes in the repository, what each holds, and where to read them.
section: contributing
order: 4
---

# Design notes

The numbered files under `docs/` and `docs/adr/` are Potyro's engineering record: design decisions,
measurements, prototypes and the reasoning behind the code. They are kept for people changing
Potyro. They are not maintained as user documentation and are not on this site. A note marked
historical describes a design that was later replaced, and says so at the top. When a note and the
code disagree, the code wins.

Read them on GitHub, under `https://github.com/potyro-app/potyro/blob/main/docs/`.

## The notes

- [00 How Potyro works](https://github.com/potyro-app/potyro/blob/main/docs/00-how-potyro-works.md): the architecture, layer by layer.
- [01 Vision and scope](https://github.com/potyro-app/potyro/blob/main/docs/01-vision-and-scope.md): the problem, the insight, goals and non-goals.
- [02 Architecture](https://github.com/potyro-app/potyro/blob/main/docs/02-architecture.md): the design before the browser realm; historical.
- [03 Definition model](https://github.com/potyro-app/potyro/blob/main/docs/03-definition-model.md): entities, fields, pages and views as first designed.
- [04 App module API](https://github.com/potyro-app/potyro/blob/main/docs/04-app-module-api.md): `defineApp` and every `ctx` member, with examples.
- [05 Runtime interfaces](https://github.com/potyro-app/potyro/blob/main/docs/05-runtime-interfaces.md): the contracts at the seams: `Store`, `Capabilities`, the host, the view contract.
- [06 Persistence and migrations](https://github.com/potyro-app/potyro/blob/main/docs/06-persistence-and-migrations.md): the storage model, media, schema evolution, migration steps.
- [07 Execution and targets](https://github.com/potyro-app/potyro/blob/main/docs/07-execution-and-targets.md): provenance, the realm, libraries and modules, the two build targets.
- [09 Testing strategy](https://github.com/potyro-app/potyro/blob/main/docs/09-testing.md): the test layers and the must-pass invariants.
- [12 Testing guide](https://github.com/potyro-app/potyro/blob/main/docs/12-testing-guide.md): a hands-on walk through every feature.
- [13 Native Android](https://github.com/potyro-app/potyro/blob/main/docs/13-native-android.md): the Capacitor build and the device checklist.
- [16 Deployment](https://github.com/potyro-app/potyro/blob/main/docs/16-deployment.md): what runs on potyro.app: the shell, the relay, the services, Caddy.
- [17 Concurrency hazards](https://github.com/potyro-app/potyro/blob/main/docs/17-concurrency-hazards.md): the bugs that appear when an app is shared; historical.
- [20 Multi-language apps](https://github.com/potyro-app/potyro/blob/main/docs/20-multi-language-apps.md): the first design for an app's translations; historical.
- [21 Glossary](https://github.com/potyro-app/potyro/blob/main/docs/21-glossary.md): Potyro's own words in six languages, for translators.
- [22 Browser realm](https://github.com/potyro-app/potyro/blob/main/docs/22-browser-realm-prototype.md): the sealed realm's prototype, its measurements, what shipped.
- [23 AI in apps](https://github.com/potyro-app/potyro/blob/main/docs/23-ai-in-apps.md): `ctx.caps.ai`, the permission, who pays.
- [24 Share links](https://github.com/potyro-app/potyro/blob/main/docs/24-share-links.md): links as working demos, the share service, page and record links, the gallery.
- [25 Live camera](https://github.com/potyro-app/potyro/blob/main/docs/25-live-camera.md): `ctx.caps.camera.live()` and faces.
- [26 Rooms relay](https://github.com/potyro-app/potyro/blob/main/docs/26-rooms-relay.md): the relay for multiplayer apps, its protocol and limits.
- [28 Live connections](https://github.com/potyro-app/potyro/blob/main/docs/28-sockets.md): `ctx.caps.network.socket` and `.room`.
- [29 Voice input](https://github.com/potyro-app/potyro/blob/main/docs/29-voice.md): the Studio's microphone and `ctx.caps.speech`.
- [30 App translations](https://github.com/potyro-app/potyro/blob/main/docs/30-app-translations.md): one language in the source, catalogs beside it.
- [31 Security model](https://github.com/potyro-app/potyro/blob/main/docs/31-security-model.md): what keeps a shared app in its box, what the servers see, how to report a hole.
- [32 Code map](https://github.com/potyro-app/potyro/blob/main/docs/32-code-map.md): the source of this site's [Code map](code-map.md).
- [ADR 0001 Sync engine and identity](https://github.com/potyro-app/potyro/blob/main/docs/adr/0001-sync-engine-and-identity.md): why cojson, the identity model, spaces, the relay, the alternatives measured.

The notes refer to one another by the two digits at the start of a file name.

## Next

- [Code map](code-map.md): where each concern lives in the source.
- [Running the repository](running-the-repository.md): getting the source running.
