---
title: The Studio
description: How the Studio writes and changes an app from a description, what a change must pass before it is accepted, and how AI reaches inside an app.
section: concepts
order: 5
---

# The Studio

The Studio is where an app is written or changed by describing it. You say what you want in chat
and a model writes the TypeScript. The result is a version of your app that you can read, run and
restore.

## Describing an app

You open the Studio with a sentence: "a plant diary with watering reminders". Or you open it on an
app you have, with a change: "add a photo to each plant". The model is given the full `defineApp`
reference, generated from the same types your editor uses. It also sees the example apps, so it
writes against what Potyro really accepts. When the request is unclear, it asks a question before building
anything.

A change comes back as edits to the lines it concerns. Lines you did not mention stay exactly as
they were.

You can also edit the code yourself. The Studio shows the app as files, the entry and its own
modules, and a save is a version like any other. A save that imports a library the app does not
have yet says what it would fetch and asks first.

## Every candidate is checked before it counts

A model that compiles, validates and renders an app can still report success while the app is
broken. So a candidate becomes a version only when it passes every gate:

1. **It compiles and validates.** The shape is checked as on any load. Errors go back to the model
   in words.
2. **It loses nothing.** A change that drops an entity or a page is sent back with the loss named:
   "your change removes the `place` entity".
3. **It runs.** On a throwaway store seeded with sample records, every computed value, filter,
   action and reminder runs. Every page is mounted, in the sandbox. What threw is an error. A page
   that shows nothing is a warning. The candidate is judged against the app as it was. A fault the
   app already had is context, not a reason to refuse your change.

A candidate that fails goes back with the failure described, and the model tries again. Every exit
that is not a pass says what it is. It may be a question for you, or a diagnosis that the fault is
not the app's. It may be that Potyro lacks something, and then the Studio offers to send your
request on, in your words.

## Fixing what does not work

For "this does not work" you record a **case**: what you did, as the app's own steps, and what you
expected. The case is replayed against the app first. If it already passes, the Studio says so and
does not start. Otherwise the model investigates and proposes. A candidate counts as a fix only
once your case passes against it, replayed on your real records, read-only.

## Your data is kept

Changing an app never deletes its records. A field the new version does not know is left as it is.
A rename or a removal is written as a migration step, so the records move with the app. See
[Changing an app that has data](../guides/changing-an-app-with-data.md).

## Pointing, editing in place, voice

In the Studio's preview, point mode lays a layer over the app that takes every tap. What a tap
would point at is outlined and named, and a tray offers the part, its view and its page. The model
is then told in words, "the Nights list on the Patterns page", and shown the lines that declare it.

Edit mode works the other way. Any text on screen that is a literal in the source can be changed in
place, with no model. The change is saved as a version.

The Studio has a microphone where the device has one.

## Versions and the conversation

Every source your app has ever had is a version. The History panel compares versions and restores
one. The conversation is kept too: what you asked, the questions the model asked back, what was
declined. A conversation that starts before there is an app is adopted by the first version.

Which model answers is your choice in Model settings. A key you enter stays in the tab unless you
choose to remember it on this device.

## Ask inside an app

**Ask** lets the person bring a model to an app's data: "find dog-friendly places near here". The
model sees the app's structure and never its records. It proposes records in the app's own shape,
each checked against the entity's fields as a save would check it. Each fact carries its evidence.
Nothing is written until the person accepts.

An app can name outside data Ask may read:

```ts
sources: {
  places: {
    label: "Places",
    description: "Places by name or category, with opening hours.",
    endpoint: "https://api.example.com/v1",
    docs: "https://api.example.com/docs",
    auth: { header: "Authorization", prefix: "Bearer " },
  },
},
```

A source never holds a key. Each person brings their own, kept in the device's vault and sent only
to that endpoint.

**`ctx.caps.ai`** is the other direction: the app's builder puts a model behind a button.

```ts
const receipt = await ctx.caps.ai!.extract({
  image: photo,
  instructions: "A shop receipt. One entry per line bought; skip totals.",
  schema: { shop: "text?", items: [{ name: "text", price: "number" }] },
});
```

The answer is checked against `schema` before the app sees it, and typed from it. It needs
`permissions: { ai: true }`. An app from someone else asks the person once, naming the service and
what goes. The call sends what it names and nothing else. The key is Potyro's free allowance or
the person's own, and never visible to app code. See [`ctx.caps.ai`](../reference/ctx-caps-ai.md).

## Next

- [Changing an app that has data](../guides/changing-an-app-with-data.md): migrations and what
  survives a change.
- [`ctx.caps.ai`](../reference/ctx-caps-ai.md): the shape language and every option.
- [Developing](../start/developing.md): the same loop from your own editor.
