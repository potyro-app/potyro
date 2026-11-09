---
title: Device capabilities
description: Declare what the app needs, then reach the camera, position, notifications, files, network, AI and voice through ctx.caps, with one example each.
section: guides
order: 9
---

# Device capabilities

The device's powers reach an app through `ctx.caps`. This guide declares them, uses each one
once, and says what the person is asked and whether a sealed app gets it. The full APIs are on
the reference pages linked from each section.

## 1. Declare what the app needs

```ts
permissions: {
  camera: true,
  geo: true,
  notifications: true,
  haptics: true,
  filesystem: true,
  network: { hosts: ["api.open-meteo.com"], rooms: true },
  ai: true,
  speech: true,
}
```

Your own app ignores the manifest: `ctx.caps` is everything the device has, and only the browser
or the phone asks. A sealed app gets a member only when the manifest declares it, and is asked the
first time it uses one. For AI, live connections and speech, **Allow** is remembered per app on
the device and **Not now** is asked again next time. For the camera, position, notifications and
files the answer holds while the app is open.

A member that is absent is `undefined`, so test before calling:

```ts
if (!ctx.caps.geo) return ctx.ui.toast("This device has no location");
```

## 2. Take a photo

```ts
const photo = await ctx.caps.camera!.capture({ source: "camera" });   // or "library"
const ref = await ctx.media.put(photo);
await ctx.patch("plant", plant.id, { picture: ref });
```

`capture` returns a Blob. Sealed: yes, with `camera: true`, asked at first use.

## 3. Watch the camera live

```ts
const cam = await ctx.caps.camera!.live!({ facing: "environment" });
const off = cam.onFrame((video, info) => canvas.getContext("2d")!.drawImage(video, 0, 0));
cam.onStop((why) => { off(); /* offer to resume */ });
```

The session stops when the page is hidden or the app is left, and never restarts on its own.
Failures reject with a `code`: `"denied"`, `"missing"`, `"busy"`, `"hidden"`, `"failed"`.
Sealed: no. `live` is `undefined` there; `capture` still works. See
[`ctx.caps.camera`](../reference/ctx-caps-camera.md).

## 4. Read the position

```ts
const here = await ctx.caps.geo!.current();          // { lat, lng }
await ctx.create("place", { name: "Here", where: here });
```

Sealed: yes, with `geo: true`, asked at first use. A `geo` filter chip does the same from a view.

## 5. Schedule a notification

```ts
await ctx.caps.notifications!.schedule({ id: plant.id, at: due, title: `Water ${plant.name}` });
await ctx.caps.notifications!.cancel(plant.id);
```

In a browser `notifications` is absent and a due reminder shows inside the app. The Android app
schedules it exactly and fires it with the app closed; `supportsExactScheduling` says which. For
most apps declare `reminders` instead and let Potyro schedule them. Sealed: yes, with
`notifications: true`.

## 6. Vibrate

```ts
await ctx.caps.haptics?.vibrate(30);
```

Sealed: yes, with `haptics: true`, and no question.

## 7. Work with files

The app's own folder is `ctx.files`, not a capability, and needs no permission:

```ts
await ctx.files.write("notes/today.md", "# Today\n");
const text = await ctx.files.text("notes/today.md");
const picked = await ctx.files.import({ accept: ".md", multiple: true });   // the person picks
await ctx.files.export("notes/today.md");                                  // save a copy outside
```

`ctx.caps.filesystem` reaches outside the app: `pick()` opens a file, `save(name, data)` saves
one. Sealed: yes, with `filesystem: true`; a saved file goes under a folder named after the app.

## 8. Fetch from the network

```ts
const res = await ctx.caps.network!.fetch("https://api.open-meteo.com/v1/forecast?latitude=52&longitude=13&current=temperature_2m");
const data = await res.json();
```

Sealed: only the hosts in `permissions.network.hosts`, asked once per host. A host not listed is
refused at once, with no question.

## 9. Open a socket or join a room

```ts
const s = await ctx.caps.network!.socket("wss://example.org/feed");
s.onMessage((d) => void ctx.create("tick", { raw: String(d) }));

const room = await ctx.caps.network!.room();        // a new room; share room.id
room.onMessage((d) => draw(JSON.parse(String(d))));
await room.send(JSON.stringify({ stroke }));
```

A socket resolves once open and rejects with a `code` such as `"denied"`, `"refused"` or
`"not-allowed-host"`. Potyro closes every connection when the person leaves the app and never
reconnects by itself. Keep the handle in a module-level variable. Sealed: hosts from
`permissions.network.hosts`; rooms with `rooms: true`. See
[`ctx.caps.network`](../reference/ctx-caps-network.md).

## 10. Ask an AI

```ts
const receipt = await ctx.caps.ai!.extract({
  image: photo,
  instructions: "A shop receipt. One entry per line bought.",
  schema: { shop: "text?", items: [{ name: "text", price: "number" }] },
});
const advice = await ctx.caps.ai!.ask("What is wrong with this plant?", { image: photo });
```

Only what the call names is sent. The answer of `extract` is checked against `schema` before the
app sees it. Sealed: yes, with `ai: true`; the question names the service and what goes, once per
app. The person can turn AI off per app. See [`ctx.caps.ai`](../reference/ctx-caps-ai.md).

## 11. Listen to the person

```ts
const session = await ctx.caps.speech!.listen();
session.onText((text, final) => show(text));
const words = await session.result;
```

`text` is everything heard so far. The engine is the device's own recogniser where it has one,
else a browser or cloud service; the question says where the recording goes. Your own app is
asked only when the recording leaves the device. Sealed: yes, with `speech: true`, always asked
once. See [`ctx.caps.speech`](../reference/ctx-caps-speech.md).

## Next

- [The `ctx` reference](../reference/ctx.md): every `Caps` member with its signature.
- [Your apps and other people's apps](../concepts/trusted-and-sealed.md): why a sealed app is asked.
- [Build for Android](build-for-android.md): the target where notifications fire exactly.
