---
title: Describe it, or code it.
lead: Say what you need and the Studio writes the app with a model, checking every step. If you code, an app is one TypeScript file.
description: How the Studio makes an app from a sentence and checks it before you see it, which models it can use, and how to write an app yourself.
---

## Describe it

In the Studio you write a sentence. A model writes the app. Before you see it, Potyro compiles the
code, checks that nothing you had was lost, and runs it on sample records; a candidate that fails is
sent back to the model with the error, in words, and only one that passes is shown. Then you change
the app by asking: "add a photo to each plant". A fix counts only when the case you showed it
passes. Every version is kept, and you can go back to any of them.

## Which model

Free first: Potyro pays for a monthly allowance of app making, through a relay of its own that
holds Potyro's key and caps the spending. After that, or instead of it, your own key: OpenRouter,
Anthropic, or any server that speaks the OpenAI chat API, including one running on your own
computer. Two models run on the device itself, with nothing sent anywhere: a small coder model in
the browser, and Chrome's built-in model where it exists. Keys stay on your device and never reach
an app.

## Code it

An app is one TypeScript module that exports `defineApp({...})`: what it keeps and shows written as
plain data, what it does written as ordinary functions. Every function receives `ctx`, the one door
to the phone's abilities: data, time, files, the camera, the person, the screen. There is no visual
builder and no mini-language to learn.

```sh
npm create potyro@latest my-app     # a project with an app in it
npm run build                       # → dist/my-app.potyro-app.zip, for Add an app → From this device
```

## Go deeper

- [Your first Potyro app](docs/tutorials/01-your-first-app.md): a reading list, in fifteen minutes
- [The Studio and the generator](docs/00-how-potyro-works.md#the-studio-and-the-generator): the gates, the engines, the loops
- [App module API](docs/04-app-module-api.md): `defineApp` and `ctx`, member by member
