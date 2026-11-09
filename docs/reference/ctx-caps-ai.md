---
title: ctx.caps.ai
description: extract() and ask(): sending a picture or a text to an AI service and getting an answer in the app's own shape.
section: reference
order: 7
---

# ctx.caps.ai

`ctx.caps.ai` sends a picture or a text to an AI service and gives back an answer in the shape the
app asked for.

```ts
const receipt = await ctx.caps.ai!.extract({
  image: photo,
  instructions: "A shop receipt. One entry per line bought; skip totals, tax and payment lines.",
  schema: {
    shop: "text?",
    date: "date?",
    items: [{ name: "text", price: "number", kind: { oneOf: ["food", "drink", "other"] } }],
  },
});
// receipt: { shop: string | null; date: string | null;
//            items: { name: string; price: number; kind: "food" | "drink" | "other" }[] }

const advice = await ctx.caps.ai!.ask("What is wrong with this plant, and what should I do?", { image: photo });
```

## Permission

```ts
permissions: { ai: true }
```

| | Your own app | A shared (sealed) app |
|---|---|---|
| Has `ctx.caps.ai` | always, where Potyro offers AI | only with `permissions: { ai: true }`; `undefined` otherwise |
| Asked | no | once per app, on this device, at the first call |
| Turned off | Edit tile → **AI**: every call then throws | the same |

The question names the service and what goes: this photo or text and its question, nothing else in
the app. It says who pays as things stand. **Allow** is remembered for the app. **Not now** refuses
this call and asks again next time. Deleting the app forgets the answer.

Only what a call names is sent. There is no ambient context: records never leave the device unless
the app passes them. Keys never reach app code; Potyro holds the key and makes the call.

## `extract(req)`

```ts
extract<const S extends AiShape>(req: AiExtractRequest<S>): Promise<AiValue<S>>
```

| Field | Type | Notes |
|---|---|---|
| `schema` | `AiShape` | the shape of the answer; required |
| `instructions` | string | what this is and what to take from it |
| `image` | `AiImage \| AiImage[]` | one or more pictures |
| `text` | string | instead of or beside the image |

### The shape

| Shape | Answer type | Notes |
|---|---|---|
| `"text"`, `"number"`, `"boolean"`, `"date"` | `string`, `number`, `boolean`, `string` | a date is `"YYYY-MM-DD"` |
| `"text?"` and the other leaves with `?` | the type `\| null` | may be missing |
| `{ oneOf: ["a", "b"] }` | `"a" \| "b"` | one of a list |
| `{ oneOf: [...], optional: true }` | `"a" \| "b" \| null` | |
| `[shape]` | `Answer[]` | a list of them |
| `{ key: shape }` | `{ key: Answer }` | an object |

That is the whole language. The TypeScript type is inferred from the shape, so `receipt.items[0].price`
is a `number` in the editor.

### What comes back

The answer is checked against the shape before the app sees it:

- a number in a string, `"12,50"`, becomes `12.5`
- an option in another case becomes the declared one
- an empty optional becomes `null`
- a missing list becomes `[]`
- unknown keys are dropped

When something still does not fit, the model is asked once more with the problems listed. When the
second answer does not fit either, `extract` throws. The app never receives a value outside its
shape.

## `ask(prompt, opts?)`

```ts
ask(prompt: string, opts?: { image?: AiImage | AiImage[]; instructions?: string }): Promise<string>
```

Words back, with no shape. Words the model writes are in the person's language; names copied off a
picture stay as written.

## `AiImage`

| Form | Notes |
|---|---|
| `Blob` | from `ctx.caps.camera.capture()` or a canvas |
| `Uint8Array` | bytes |
| `FileRef` | a `file` field's value |
| `string` | a path in `ctx.files` |
| `MediaRef` | a `media` field's value |

Pictures are resized on the device, to at most 1600 px on the long side, before they are sent.

## Limits

| | |
|---|---|
| Pictures per call | 4 |
| Text per call | 20,000 characters |
| Instructions per call | 4,000 characters |
| Whole request | 60 s, then it throws |
| On the person's own key | 20 calls a minute per app, and $1 a month per app |

## Who pays

1. **Potyro's free allowance**, while it lasts for this device and this month.
2. **The person's own key**, from Model settings, when the allowance is used up or not reachable.
3. **Neither**: the call throws, in words Potyro shows as the action's failure, saying to add a key.

Each call's cost on the person's key is added to a per-app total shown in Edit tile. Free calls add
nothing.

## Offline and time

- **Offline**: the call throws at once. It is never queued.
- **Timeout**: 60 s for the whole request, then it throws.
- **In a sealed app**: the time a call waits does not count against the box's time budget.

Every failure is an `Error` with words for the person. Show `message`, or your own words.

## `sources` on `defineApp`

`sources` names outside data the app's Ask can read: a places API, a search engine. It is for Ask,
the person's assistant inside the app, not for `ctx.caps.ai`.

```ts
sources: {
  places: {
    label: "Places",
    description: "Addresses and opening hours of shops and restaurants.",
    endpoint: "https://api.example.com/places",
    docs: "https://example.com/docs/places",
    auth: { header: "Authorization", prefix: "Bearer " },
  },
}
```

| Field | Type | Notes |
|---|---|---|
| `endpoint` | string | the base URL, https; required |
| `label` | string | |
| `description` | string | what it answers, for Ask |
| `docs` | string | documentation Ask may read |
| `auth` | `{ header; prefix? } \| { query }` | how the key is sent; none means no key |

Never put a key in a source. Each person brings their own; it is kept in the device's vault and
sent only to `endpoint`.

## Not offered

Streaming, tools and image generation are not part of `ctx.caps.ai`.

## Next

- [Device capabilities](../guides/device-capabilities.md): declaring permissions and wording refusals.
- [The Studio](../concepts/the-studio.md): Ask, and what `sources` does there.
- [defineApp](define-app.md): every top-level field, `permissions` and `sources` among them.
