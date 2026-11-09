---
title: Asking the person
description: Confirm, offer choices, collect values and report back from app code with ctx.ui, plus timers and keeping the screen on.
section: guides
order: 5
---

# Asking the person

This guide asks the person something from an action and tells them what happened. Every call on
`ctx.ui` takes plain data and returns plain data, so it works the same in a sealed app and needs no
permission.

```ts
actions: {
  settle: {
    label: "Settle up",
    icon: "hand-coins",
    run: async (expense, ctx) => {
      const ok = await ctx.ui.confirm("Mark this expense as settled?", {
        detail: `${expense.what} · ${ctx.format.money(expense.amount, "EUR")}`,
        ok: "Settle",
      });
      if (!ok) return;
      await ctx.patch("expense", expense.id, { settled: true });
      ctx.ui.toast("Settled");
    },
  },
  move: {
    label: "Move to another trip",
    icon: "arrow-right-left",
    run: async (expense, ctx) => {
      const trips = await ctx.query("trip");
      const to = await ctx.ui.sheet({
        title: "Which trip?",
        items: trips.map((t) => ({ id: t.id, label: String(t.name) })),
      });
      if (!to) return;
      await ctx.patch("expense", expense.id, { trip: to });
      ctx.ui.toast("Moved");
    },
  },
  remove: {
    label: "Delete",
    icon: "trash-2",
    run: async (expense, ctx) => {
      const ok = await ctx.ui.confirm("Delete this expense?", { ok: "Delete", destructive: true });
      if (ok) await ctx.delete("expense", expense.id);
    },
  },
},
```

## 1. Report with a toast

`ctx.ui.toast(msg)` shows a short line and goes away. Use it after an action succeeds. Pass `Words`:
a plain string, or `ctx.t("…")` when the app has translations.

## 2. Confirm before something that cannot be undone

`ctx.ui.confirm(msg, opts)` resolves to `true` or `false`.

- `ok` names the button: "Delete", "Settle". `cancel` names the other one when both answers are
  real choices.
- `detail` is a quieter second line.
- `destructive: true` makes the button red.

## 3. Offer a short list of choices

`ctx.ui.sheet({ title, items })` shows the items as a bottom sheet on a phone and a small dialog on
a wide screen. Each item is `{ id, label, detail?, icon?, destructive? }`. It resolves to the
chosen `id`, or `null` when dismissed. A `destructive` item is shown last, in red.

`ctx.ui.menu` is the same, hanging under the button that ran the action. `ctx.ui.pick(items, {
label, multi })` chooses among your own values, one or several.

## 4. Collect values

Two ways, and the first is usually better.

**Declare `input` on the action.** The button opens a form of those fields, and the checked values
arrive as `run`'s third argument. Ask can fill them too. See
[Computed, actions and reminders](computed-actions-reminders.md).

**Open a form from code.** `ctx.ui.form({ title, fields, initial, submit })` uses the same field
definitions and the record form's controls. It resolves to the values, or `null` when cancelled.
Relations come back as ids.

```ts
const paid = await ctx.ui.form<{ amount: number; on: Date }>({
  title: "Log a payment",
  fields: {
    amount: { type: "money", currency: "EUR", required: true, label: "Amount" },
    on: { type: "datetime", label: "Day" },
  },
  initial: { on: ctx.today() },
  submit: "Log it",
});
if (!paid) return;
```

`ctx.ui.prompt(msg, { default })` asks for one line of text.

## 5. Show progress on long work

`ctx.ui.progress(label)` returns a bar. Call `update(fraction, detail?)` as you go and `done()` at
the end, in a `finally`.

```ts
const bar = ctx.ui.progress("Importing…");
try {
  for (const [i, row] of rows.entries()) {
    await ctx.create("expense", row);
    bar.update((i + 1) / rows.length, `${i + 1} of ${rows.length}`);
  }
} finally {
  bar.done();
}
```

## 6. Hand something on

`ctx.ui.share({ text, url, title, files })` opens a dialog that shows what will go, then offers the
system share sheet, Copy, or Save a copy. The person picks where it goes, so no permission is asked.
It resolves to `true` once something was shared, copied or saved.

- `files` takes pictures and files the app made or holds: a `Blob`, a `media` field's value, a
  `file` field's value.
- `app: { page, params }` instead of `url` makes a link into this app, opening that page on the
  other person's copy. The page must declare `link: { params: [...] }`.

## 7. Keep the screen on and count down

For a page someone follows without touching, call `ctx.ui.keepAwake()` and `release()` it when
the view goes. Leaving the app releases it too.

`ctx.ui.timer({ label, seconds, id })` starts a countdown the shell keeps. It survives a page
change, a locked screen and leaving the app. A chip shows it on every page, and a notification
rings at the end. Starting a timer with the `id` of a running one restarts it.

```ts
const rest = await ctx.ui.timer({ label: "Rest", seconds: 90, id: "rest" });
rest.secondsLeft();          // whole seconds left, as the chip counts them
await rest.pause();          // resume(), cancel()
const running = await ctx.ui.timers();
```

A custom view that draws the countdown itself calls `ctx.ui.drawsTimer(id)` while it is on screen.
The chip stays away on that page, and the view releases it in its cleanup. See
[Custom views](custom-views.md).

## Next

- [The `ctx` reference](../reference/ctx.md) lists every `ctx.ui` call with its options.
- [Translating your app](translating-your-app.md) makes the words these dialogs show translatable.
- [Sharing an app](../concepts/sharing.md) explains the links `ctx.ui.share` can make.
