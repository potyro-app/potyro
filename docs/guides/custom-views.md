---
title: Custom views
description: Draw a screen yourself when no built-in view fits, in React or any framework, and know how it behaves in a sealed app.
section: guides
order: 4
---

# Custom views

This guide writes a view you draw yourself: a practice screen, a game, a cook mode. A custom view is
a component that receives the runtime and reaches everything through `ctx`.

```tsx
import { defineApp } from "potyro";
import type { ViewProps } from "potyro";
import { useState } from "react";

function Practice(props: ViewProps) {
  const { runtime, navigate } = props;
  const ctx = runtime.ctx;
  const { rows, loading } = runtime.useQuery("card", { filter: (c) => !c.known });
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (loading) return <p>{ctx.t("Loading…")}</p>;
  const card = rows[i % Math.max(rows.length, 1)];
  if (!card) return <p>{ctx.t("Every card is known. Well done.")}</p>;

  const next = () => {
    setFlipped(false);
    setI(i + 1);
  };
  const known = async () => {
    await ctx.patch("card", card.id, { known: true });
    next();
  };

  return (
    <div className="pr">
      <style>{CSS}</style>
      <button className="pr-card" onClick={() => setFlipped(!flipped)}>
        {flipped ? card.back : card.front}
      </button>
      <div className="pr-row">
        <button onClick={next}>{ctx.t("Again")}</button>
        <button className="primary" onClick={known}>{ctx.t("Known")}</button>
      </div>
      <button className="pr-link" onClick={() => navigate("cards")}>{ctx.t("All cards")}</button>
    </div>
  );
}

const CSS = `
.pr { display: grid; gap: var(--space-4, 1rem); padding-bottom: var(--k-chrome-bottom, 0px); }
.pr-card { min-height: 40vh; font: inherit; font-family: var(--font-display); font-size: 2rem;
  color: var(--ink); background: var(--surface-raised); border: 1px solid var(--line);
  border-radius: var(--radius-lg, 18px); box-shadow: var(--shadow); }
.pr-row { display: flex; gap: var(--space-2, .5rem); }
.pr-row button { flex: 1; font: inherit; padding: .9rem 1rem; border-radius: var(--radius, 14px);
  border: 1px solid var(--line); background: var(--surface); color: var(--ink); }
.pr-row .primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.pr-link { font: inherit; background: none; border: 0; color: var(--ink-soft); }
`;

export default defineApp({
  id: "flashcards",
  name: "Flashcards",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    card: {
      label: "Card",
      displayField: "front",
      fields: {
        front: { type: "text", required: true, label: "Front" },
        back: { type: "text", required: true, label: "Back" },
        known: { type: "boolean", default: false, label: "Known" },
      },
    },
  },
  pages: [
    { id: "practice", title: "Practice", icon: "layers", view: { type: "custom", entity: "card", render: (props) => <Practice {...props} /> } },
    { id: "cards", title: "Cards", icon: "list", view: { type: "list", entity: "card", display: { primary: "front", secondary: "back" } } },
  ],
});
```

## 1. Declare the page

The view is `{ type: "custom", entity, render }`. `param` names a route param, as on a detail page,
when the view is about one record. `onFinish` names an action to run when the view says it is done.

A file with JSX must end in `.tsx`. Import `React` hooks from `react` as usual.

## 2. Read what the view receives

`ViewProps` has:

- `runtime`: the app as the view sees it. `runtime.ctx` is the full `ctx`.
- `runtime.useQuery(entity, { filter, sort })` and `runtime.useRecord(entity, id)` are hooks that
  re-render when records change. `runtime.watchQuery` and `runtime.watchRecord` are the same as
  subscriptions, for code without React.
- `runtime.runAction(entity, key, id, input?)` runs one of the entity's actions.
- `runtime.definition` is the app definition with every word already in the person's language.
- `param`: the route params, such as `{ recipeId }`.
- `navigate(pageId, param?)` opens another page.

Write through `ctx`: `ctx.patch`, `ctx.create`, `ctx.increment`. Keep the screen on with
`ctx.ui.keepAwake()` and count down with `ctx.ui.timer`. See
[Asking the person](asking-the-person.md).

## 3. Match the app's look

The shell exposes its theme as CSS custom properties. Read them instead of choosing colours.

| Property | What it is |
|---|---|
| `--ink`, `--ink-soft`, `--ink-faint` | text, quieter text, quietest |
| `--surface`, `--surface-raised`, `--surface-sunken` | backgrounds at three depths |
| `--line` | borders |
| `--accent`, `--on-accent` | the app's colour and text on it |
| `--radius`, `--radius-lg`, `--shadow` | corners and elevation |
| `--font-ui`, `--font-display` | the two typefaces |
| `--space-1` … `--space-9` | the spacing scale |
| `--k-chrome-bottom` | the room the shell's bars take at the bottom |
| `--k-chrome-top` | the room a sign takes at the top, otherwise `0px` |

Put your own bottom bar above `var(--k-chrome-bottom, 0px)`, so a running timer's chip never covers
it. The values change with light and dark mode and with the app's accent, while the view is open.

## 4. Use another framework with mount

Declare `mount` instead of `render`. It receives a container and returns a teardown.

```ts
view: {
  type: "custom",
  entity: "card",
  mount: (el, props) => {
    const ctx = props.runtime.ctx;
    const p = document.createElement("p");
    el.append(p);
    const stop = props.runtime.watchQuery("card", { filter: (c) => !c.known }, ({ rows }) => {
      p.textContent = ctx.t("{n} cards left", { n: rows.length });
    });
    return () => stop();
  },
},
```

A library that touches `document` when it loads belongs inside `mount`, with `await import(...)`,
not at the top of the file.

## 5. Know how it behaves sealed

An app someone else wrote runs sealed, and so do its custom views.

- Each view on screen runs in its own sandboxed frame, with no network and no access to the
  shell's page. Everything goes through `props.runtime.ctx`, mediated as the app's logic is.
- The theme properties above reach the frame. `ctx.media.url`, `ctx.files.url`, `ctx.ui.keepAwake`
  and `ctx.ui.timer` work.
- `ctx.caps.camera.live` is not available in a sealed view.
- A view that stops responding is removed. The page shows a plain version of the app with a button to
  try the screen again. A view that froze once stays off on that device until the person asks for it.

Keep every loop bounded and every effect cleaned up, and a sealed view behaves like a trusted one.
See [Your apps and other people's apps](../concepts/trusted-and-sealed.md).

## Next

- [Asking the person](asking-the-person.md): timers, keeping the screen on and dialogs from a view.
- [Pages and view options](../reference/pages-and-views.md): check `aggregate`, `stats` and `chart`
  before drawing a derived table yourself.
- [Device capabilities](device-capabilities.md): the live camera and other `ctx.caps` a view may use.
