---
title: Computed, actions and reminders
description: Add logic to an entity with plain functions: values worked out from a record, buttons that change it, and notifications when a date comes.
section: guides
order: 3
---

# Computed, actions and reminders

This guide adds logic to an entity. Each piece is an ordinary function that receives the record and
`ctx`. Nothing here is a formula language.

```ts
entities: {
  loan: {
    label: "Loan",
    icon: "hand-helping",
    displayField: "item",
    fields: {
      item: { type: "text", required: true, label: "Item" },
      to: { type: "member", required: true, label: "Lent to" },
      lentOn: { type: "datetime", required: true, label: "Lent on", default: (ctx) => ctx.today() },
      days: { type: "number", integer: true, min: 1, default: 14, label: "For (days)" },
      returnedOn: { type: "datetime", label: "Returned on" },
    },
    computed: {
      dueOn: (loan) => addDays(new Date(loan.lentOn), Number(loan.days)),
      overdue: (loan, ctx) => !loan.returnedOn && loan.dueOn < ctx.today(),
      status: {
        label: "Status",
        value: (loan) => (loan.returnedOn ? "back" : loan.overdue ? "late" : "out"),
        labels: { back: "Returned", late: "Overdue", out: "Out" },
      },
    },
    actions: {
      returned: {
        label: "Got it back",
        icon: "check",
        run: async (loan, ctx) => {
          await ctx.patch("loan", loan.id, { returnedOn: ctx.today() });
          ctx.ui.toast(`${loan.item} is back`);
        },
      },
      extend: {
        label: "Extend",
        icon: "calendar-plus",
        description: "Give the borrower more days.",
        input: { by: { type: "number", integer: true, min: 1, default: 7, label: "Days" } },
        run: async (loan, ctx, input) => {
          const { by } = input as { by: number };
          await ctx.patch("loan", loan.id, { days: Number(loan.days) + by });
        },
      },
    },
  },
},
reminders: [
  {
    id: "due-back",
    entity: "loan",
    when: (loan) => (loan.returnedOn ? null : loan.dueOn),
    title: (loan) => `${loan.item} is due back`,
    body: (loan) => `Lent to ${loan.to?.name ?? "someone"}`,
  },
],
```

## 1. Work values out with computed

A computed is `(record, ctx) => value`. Views use it like a field: in `display`, in `sections`, in
a `filter`. Other computed values and actions read it as a property, `loan.dueOn`.

- Relations are resolved one level deep. `loan.to.name` works. For more, call `ctx.query`.
- Read the clock through `ctx.now()` and `ctx.today()`. They are fixed for one pass, so a page
  never shows two different "now"s.
- Return a `Date`, a number or a string. Let the view format it.

When a page shows the value under a heading, use the object form `{ label, value }`. `labels` maps
a returned key to words, like an enum. Functions still see the key. `format` turns a returned
object into a sentence with an ICU message.

## 2. Change records with actions

An action is `(record, ctx, input?) => void | Promise<void>`. It does its work through `ctx`:
`ctx.patch`, `ctx.create`, `ctx.delete`, a dialog from `ctx.ui`, a capability from `ctx.caps`.

Pages name actions by key:

- `rowActions: ["returned"]` on a list puts a button on each row.
- `actions` and `primaryAction` on a detail page.
- `onFinish` on a `steps` or `custom` view runs one when the walk-through ends.

Add `label`, `icon` and `description` with the object form. `description` is what the app's Ask
reads to know when to run it.

For a counter two people may press at once, use `ctx.increment(entity, id, field, delta)` instead of
reading and writing back. See [Data and sync](../concepts/data-and-sync.md).

## 3. Ask for values with input

`input` declares what an action takes, with ordinary field definitions. A button opens a form of
those fields. The values arrive as the third argument, already checked against the types. Ask can
fill them from what the person says.

Prefer `input` over a `ctx.ui.form` inside `run`. Both work from a button, but only `input` is
something Ask can do.

## 4. Add a button to a page

A page action has no record. It is a button beside the page's filter chips.

```ts
{
  id: "out",
  title: "Out",
  actions: [
    {
      label: "Lend something",
      icon: "plus",
      run: async (ctx) => {
        const loan = await ctx.create("loan", { item: "", days: 14, lentOn: ctx.today() });
        ctx.navigate("loan", { loanId: loan.id });
      },
    },
  ],
  add: 0,
  view: { type: "list", entity: "loan", filter: (l) => !l.returnedOn, rowActions: ["returned"] },
}
```

`add: 0` makes the page's "+" run that action instead of the default form. `when: (rows, ctx) =>
boolean` shows a page action only when it applies.

For a prominent "new record" flow, declare `quickActions` on the app instead:

```ts
quickActions: [{ id: "lend", label: "Lend something", icon: "hand-helping", entity: "loan", mode: "form" }],
```

`mode: "instant"` creates the record from defaults with no form. `openPage` says where to land.

## 5. Remind at a time the record decides

A reminder is `{ id, entity, when, title, body }`. `when` returns a `Date`, or `null` for no
reminder. Potyro runs it again whenever a record changes and schedules the notification on the
device.

Declare `permissions: { notifications: true }` on the app. Compute the time from the record, and
return `null` as soon as the reason is gone, such as `returnedOn` being set.

`title` and `body` are field keys or functions. Build words with `ctx.t` so they translate. A
record's own text, such as `loan.item`, stays as the person wrote it.

## Next

- [Asking the person](asking-the-person.md) covers confirmations, choices and forms inside an
  action.
- [The `ctx` reference](../reference/ctx.md) lists everything a function can call.
- [Device capabilities](device-capabilities.md) covers the camera, location and other
  `ctx.caps`.
