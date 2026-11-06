---
title: Concurrency hazards
description: What breaks when an app is shared: the two bugs found in the first public test and the classes behind them.
status: historical
---

# What breaks when an app is shared, and what to do about it

> **Written 2026-08-10, kept as a record.** The hazards are still real; the current description of
> how sync merges and what the Studio checks for is docs/00 "Sync, CRDT and identity".

Written 2026-08-10, after the **first** app shared in a public test turned out to have **two**
independent instances of this problem — neither of which produced an error, a warning, or any visible
sign at all.

This is not a list of bugs in the store. Per-field last-write-wins is exactly what a CoMap promises,
and it is the right merge for two people editing different things. The problem is that app code —
written by a model, or by anyone not thinking about two devices at once — routinely assumes semantics
the store never offered. The failures are **silent**, which is what makes them serious.

## The two found in `shared-todo`

**1. Reordering fused two rows.** The app stored a numeric `order` and moved a row by *swapping* the
`order` values of two neighbours. A swap is a read-modify-write across **two records**, and nothing
makes that atomic. Two people reordering at once left `Kartofeln` and `Eichhörnchen` holding the
same `order`. Two rows with the same sort key can never be swapped apart again — exchanging equal
values is a no-op — so "move up" did nothing, permanently, with no error.

**2. The +1 / −1 buttons lose presses.** Same app, still live. Read the count that is on screen, add
one, write it back. Two people pressing at the same moment both read 0, both write 1, and one press
is gone. Both devices agree on the wrong number, which is precisely why nothing looks broken.
Demonstrated in `packages/store/test/concurrency-hazards.test.ts`.

Neither is exotic. They are the two most ordinary things a list app does.

## The classes

Everything below is invisible at runtime unless something is built to see it.

| Class | What an app writes | What happens with two people |
|---|---|---|
| **Read-modify-write** | `patch({ n: row.n + 1 })` | Increments are lost. Counters, tallies, "N of M". |
| **Multi-record invariant** | swap, move, transfer, "settle up" | The pair can fuse or split. No cross-record atomicity exists. |
| **Whole-array fields** | `patch({ tags: [...tags, t] })` | The array is one field: one person's whole edit is dropped. **Closed for DECLARED set fields** (`tags`, `relation`/`member` `many`): the store diffs the array and writes one key per element. Still open for an array held as anything else. |
| **Whole-text fields** | `patch({ body: textarea.value })` | The text is one field: two people typing at once keep the newer save. **Closed for a `text` field declared `collaborative: true`** edited through `ctx.text(…).edit` (docs/04 "Writing together"): the words are a text CRDT of their own, merged character by character. Still open for a plain text field, and for a collaborative one written whole with `patch`. |
| **Allocation / uniqueness** | "next free number", a code, a slug | Two peers allocate the same one. |
| **Derived values stored** | `total` written alongside the parts | Diverges from the parts, permanently. |
| **Delete vs edit** | one deletes while another edits | The edit lands on a record nothing lists. |
| **Wall-clock ordering** | `Date.now()` as a sort key | A skewed clock reorders other people's work (fixed for chat in `hlc.ts`; app code can still do it). |

`Store.transaction` does **not** help. It is documented as a compensating write — correct locally,
not atomic across peers.

## What can and cannot be closed

**Primitives shrink the space.** A counter that merges by summing deltas, a fractional order key
where a move writes one record, a list type with element-wise merge. These make the common cases
correct *by construction*, and they are worth building.

**They do not close it.** Every new feature someone asks an app for is a new opportunity to invent an
unsafe pattern, and the generator has no way to know it did. Anyone who claims a fixed set of
primitives makes arbitrary generated apps concurrency-safe is wrong.

So the honest position has three parts, and the third is the one that matters:

1. **Give app code safe primitives**, so the ordinary cases stop being landmines.
2. **Teach the generator** to use them, and to avoid read-modify-write. Helps; cannot be relied on.
3. **Find the unknown ones mechanically, before users do.** This is the only part that scales,
   because it does not require anyone to have thought of the failure in advance.

## Finding the unknown ones: adversarial two-peer smoke

`packages/generator/src/smoke.ts` already seeds records and runs every computed, binding, action,
reminder and custom view. It runs **single-user**, so it cannot see any of this.

The extension is mechanical and does not need to understand what an app *means*:

- Stand up **two** stores over connected peers, as the tests here do.
- For every action, run it **concurrently from both sides** against the same record, let it settle,
  and then check properties that are true of any sane app:
  - **Convergence** — both peers agree. (They will; this catches nothing on its own, but a
    disagreement would be a store bug worth knowing about.)
  - **Lost update** — run an action that changes a number twice concurrently; if the result equals
    one application rather than two, the action is a read-modify-write. Report it.
  - **Fused keys** — after concurrent runs, is any field that was unique across records now
    duplicated? That is the ordering bug, caught generically.
  - **Orphans** — records reachable by edit but not by any list.
  - **NaN / null** written over a number that had a value.

None of that requires knowing the app is a shopping list. It requires running it twice at once and
looking at the wreckage — which is exactly what nobody does by hand, and what users are currently
doing on our behalf.

## Until then, be straight about it

Sharing is safe for **low-contention personal data** — a shopping list two people add to, a trip, a
split. It is not safe for anything where two people act on the same row at the same second, and
today nothing warns you. Say so, rather than discovering it per app.
