---
title: Working together
description: Turn on sync for an app, invite people, name people before they join, and write logic that survives two people editing at once.
section: guides
order: 6
---

# Working together

This guide takes an app from one device to a group: sync, invites, roles, guests, and the
three pieces of `ctx` that make shared logic safe. How sync merges edits is explained in
[Data and sync](../concepts/data-and-sync.md); this page is what to do.

## The example

A chores app for a flat. Each chore names who does it, counts how often it was done, and has a
note everyone can type in.

```ts
import { defineApp } from "potyro";

export default defineApp({
  id: "chores",
  name: "Chores",
  version: "1.0.0",
  schemaVersion: 1,
  permissions: { sync: true },
  entities: {
    chore: {
      label: "Chore",
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: "Chore" },
        assignee: { type: "member", label: "Who" },
        timesDone: { type: "number", label: "Times done", default: 0 },
        notes: { type: "text", multiline: true, collaborative: true, label: "Notes" },
      },
      actions: {
        done: {
          label: "Done",
          run: async (chore, ctx) => {
            await ctx.increment("chore", chore.id, "timesDone", 1);
            ctx.ui.toast(`${chore.title}: done by ${ctx.me.name}`);
          },
        },
      },
    },
  },
  pages: [
    {
      id: "all",
      title: "Chores",
      actions: [
        {
          label: "Add a flatmate",
          run: async (ctx) => {
            const name = await ctx.ui.prompt("Their name");
            if (name) await ctx.guests.add(name);
          },
        },
      ],
      view: {
        type: "list",
        entity: "chore",
        display: { primary: "title", secondary: (c) => c.assignee?.name ?? "Nobody yet" },
        rowActions: ["done"],
      },
    },
  ],
});
```

## 1. Turn on sync and invite people

1. Open the app's tile menu, choose **Share**, then **Use it together**. Potyro asks once, copies
   the app's records into a synced space and keeps the old copy.
2. Send the link it makes. Whoever opens it joins the space with the app and its records.
3. For more people, open **People** from the app's menu and choose **Invite someone**. An invite
   is either **Can edit** (`writer`) or **Can view** (`reader`). The person who turned sync on is
   the `admin` and can remove people.

Declare `permissions: { sync: true }` in an app meant to be shared. A sealed app is asked
before it syncs either way; the declaration makes the question say what the app does.

## 2. Read who is here

```ts
ctx.me                 // { id, name }: always present, even in a solo app
ctx.space?.role        // "admin" | "writer" | "reader"; undefined when the app is solo
ctx.people             // everyone a member field can name: members, and guests nobody has claimed
```

Use `ctx.people` for "everyone in the group". `ctx.space?.members ?? [ctx.me]` also works but
leaves the guests out. In a solo app `ctx.people` is just you. A `reader` cannot write, so check
`ctx.space?.role` before offering a button that writes.

## 3. Point at a person with a `member` field

A `member` field stores a person's id and resolves to the person, so `chore.assignee.name` works.
Add `many: true` for several people. In a shared app the value must name someone in the app.
Who *entered* a record is `createdBy`, stamped by Potyro; who it is *about* is your `member`
field.

## 4. Name people before they join

A **guest** is a name that a `member` field can hold until that person arrives:

```ts
const tom = await ctx.guests.add("Tom");          // { id, name: "Tom", guest: true }
await ctx.patch("chore", chore.id, { assignee: tom.id });
```

When someone joins, Potyro asks whether they are one of the guests. From then on every record
naming that guest names them. Nothing is rewritten. Anyone who can change the app may add a
guest; renaming and removing are for whoever added it, or the admin. `ctx.guests.rename` and
`ctx.guests.remove` throw words for the person otherwise.

## 5. Count with `ctx.increment`

Never read a number, add one and write it back. Two people tapping together both read the same
value and one tap is lost. `ctx.increment(entity, id, field, delta)` sends the change, and the
deltas from everyone are summed.

## 6. Type together with `ctx.text`

A `text` field with `collaborative: true` is merged character by character. Edit it as changes,
not as a whole:

```ts
const notes = ctx.text("chore", chore.id, "notes");
await notes.edit([{ at: 0, insert: "Buy bin bags\n" }]);   // insert at a position
await notes.edit([{ from: 0, to: 4 }]);                    // or remove a range
const runs = await notes.runs();                           // [{ text, by }]: who typed what
```

Positions count as `String.slice` does. An editor that worked positions out against the text it
shows passes that text: `notes.edit(edits, { base: shown })`. Potyro moves the positions onto the
text as it is now. `ctx.patch` still works on the field and replaces the whole text, so a plain
form overwrites other people's words. `notes.anchor(at)` returns a marker that follows a
character through later edits; keep it in a text field of another record for a comment.

## 7. Read the pre-share report

Before an app is shared for the first time, Potyro runs it as two devices acting at once and
lists what would not survive. Each line names the entity, action and field, and one of:

- **one of two simultaneous changes is silently discarded**: a read-modify-write. Use
  `ctx.increment`, or write only the field you changed.
- **two rows can end up sharing a sort key**: a swap across records. Give each row its own
  position and move a row by setting only its own.
- **a number can be overwritten with nothing**: a write that lands `NaN` or `null` on a number.
- **the two devices stop agreeing**: the stores diverged.

The report never blocks sharing. When it could not run, Potyro says so.

## Next

- [Data and sync](../concepts/data-and-sync.md): what a space is and how edits merge.
- [Sharing an app](../concepts/sharing.md): demo links and links into a page or a record.
- [The `ctx` reference](../reference/ctx.md): `Person`, `Space`, `CtxGuests` and `CtxText` in full.
