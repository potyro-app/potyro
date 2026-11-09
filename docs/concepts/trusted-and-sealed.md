---
title: Your apps and other people's apps
description: Why an app you wrote runs with full access while one from someone else runs sealed, what sealing enforces, and what it does not protect.
section: concepts
order: 2
---

# Your apps and other people's apps

Where an app came from decides how it runs. Your own app runs direct, with everything your device
can do. An app from anyone else runs sealed, with nothing until it asks and you agree.

## Provenance decides, not the app

| The app is | Because | It runs |
|---|---|---|
| **Yours** (trusted) | you made it in the Studio, or you said "run it as mine" | direct, in Potyro's own page, every capability, no prompts |
| **Someone else's** (sealed) | it came from a link, a shared package, a file or a demo | in a sandbox, with only the capabilities it declared and you allowed |

Everything arrives sealed. Installing from a file or pasted source lets you tick "I wrote this".
A link never does. An update that arrives by link puts a trusted app back in the sandbox. A link
can never slip new code into an app that has your full authority. An update from a file keeps the
trust the app had.

The language is never restricted. A sealed app is the same TypeScript as a trusted one. Only the
authority handed to it differs, and the code cannot tell which it has.

## What sealed means

A sealed app's logic runs in a Worker inside a sandboxed frame with an opaque origin. It cannot
read Potyro's page, cookies or storage. It cannot fetch, open a socket or load anything from the
network by itself. The frame cannot navigate anywhere.

The only way out is `ctx`. Each call the app makes becomes a message to the host. The host runs
the method a trusted app would call, on a `ctx` whose capabilities are already decided. Data
crosses by copy. Functions never cross.

A watchdog gives every call a deadline. An app that spins is stopped, and the next call starts it
fresh. The deadline pauses while the app waits on the person or the network, so a slow prompt is not
a crash.

## Permissions: declared, then asked

An app declares what it needs:

```ts
permissions: {
  camera: true,
  network: { hosts: ["api.openweathermap.org"] },
  notifications: true,
  ai: true,
},
```

For a sealed app the rules are:

- **Only what is declared exists.** Without `camera: true`, `ctx.caps.camera` is `undefined`.
- **Each sensitive capability asks first**, naming the app and what it wants. That covers camera,
  location, files, network, notifications, AI and voice. Haptics is declared but not asked.
- **What is granted is scoped.** `network` reaches only the hosts named. A socket to a host is asked
  once per host. Files are saved under the app's own area.
- **Sync is asked before the app's data first leaves the device.** Declaring `sync: true` changes
  the wording of that question, not whether it is asked. Refusing leaves the app local-only.
- **AI is asked once per app**, and the answer is kept. Every app that has used AI gets an on/off
  switch, and that switch applies to your own apps too.

Your own app gets every capability the device has, with no prompts.

## What the host enforces in every case

These checks hold for every app, trusted or sealed:

- **Data is per app.** An app reads and writes its own records, files and storage, and no other
  app's.
- **Writes must fit the fields.** A value that does not match the entity's declaration is refused.
  In a shared app the other copies would otherwise have to live with it.
- **Authorship is stamped.** `createdBy` comes from the account, never from a value the app
  supplied.
- **Keys stay with Potyro.** The key that pays for AI is never visible to app code.

## Custom views in a sealed app

A sealed app's own screens draw in a sandboxed frame of their own, one per view. The view has the
same authority as the logic and no more. Potyro keeps the header and navigation around the frame.

A view that stops answering, or blocks the page, is removed and the page shows the app's plain
version. A view that froze the tab once is not drawn again on that device until you ask for it.

A library imported by a sealed app is more code in the same Worker, with no document and no
`fetch`. A library that reaches for `window` while loading fails under its own name. The app then
says it can only run as yours.

## Letting an app run as yours

You can promote a sealed app to trusted at any time. It is offered from the shield badge, the
tile menu, the Studio, and the screen that says the app could not open. Every route opens the same dialog with
the same warning, and nothing happens until you confirm. Promotion can be undone.

Promotion is never offered as the fix for a failure it would not fix. An app whose code does not
match the lock it was installed with, for example, stays refused.

Run an app as yours only if you would run its code.

## What sealing does not protect

- **Your own apps have your full authority.** A trusted app can do anything a script on Potyro's
  page can do.
- **A record's link is the record.** Whoever has it can read the record for as long as it exists.
  If the link said so, they can write it too. See [Sharing](sharing.md).
- **An invite link is the whole capability.** Anyone with it joins the space. See
  [Data and sync](data-and-sync.md).
- **A sealed app's memory is not capped.** A runaway allocation is stopped by the browser, not by
  Potyro.
- **Code trust and people trust are separate.** Being in someone's space says nothing about their
  code. A friend's app runs sealed even when you share data with that friend every day.

## Next

- [Device capabilities](../guides/device-capabilities.md): declaring permissions and handling a
  refusal in your own app.
- [Data and sync](data-and-sync.md): what a space is and what the relay can see.
- [Sharing](sharing.md): demo links, Make it mine and links to a single record.
