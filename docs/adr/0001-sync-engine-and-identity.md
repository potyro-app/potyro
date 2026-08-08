# ADR 0001 · Sync engine and identity model

- **Status:** Proposed
- **Date:** 2026-08-07
- **Deciders:** core
- **Satisfies:** `docs/10-backlog.md#ka-08` ("Evaluate + choose … Decision recorded (ADR)")
- **Supersedes:** nothing
- **Related:** KA-09 (presence), KA-10/11 (community), KA-04 (export `mode: "mergeable"`)

## Context

Karta has no sync. `Store` has three implementations (`MemoryStore`, `LocalStore`,
`SqliteStore`) and all three are single-device. The business plan (§8.4 Step B) makes an
E2E-encrypted sync subscription the primary recurring-revenue lever, and `docs/01` promises the
`Store` seam keeps that door open.

The trigger for writing this now is a concrete target app: **a Splitwise-style shared expense
tracker**. Working through it surfaced that the CRDT engine is *not* the hard part.

### The thing the backlog missed

KA-08/09/10/11 cover the CRDT store, presence, and the community/registry layer. None of them
cover **identity**. Karta today has no concept of a person:

- `Ctx` (`docs/04`) has data, time, params, storage, caps, media, ui, navigate, log. No `me`.
- `KartaRecord` is `{ id, createdAt, updatedAt, ... }`. No author.
- The 13 field types (`packages/schema/src/validate.ts`) include no `member`/`user`.
- `PermissionManifest` has camera/filesystem/notifications/geo/haptics/network. No sync.

A Splitwise clone is ~90% *"who paid, who owes"* and ~10% arithmetic. Without an identity
primitive, `paidBy` degrades to free text and the app is a shared notepad. **Identity is a
harder blocker than the CRDT engine, and it is a prerequisite for the CRDT work being useful
rather than merely working.**

### Two meanings of "trusted" that must not merge

Karta already uses "trusted" for provenance-decides-execution (hard rule 3). Sharing an app
with a friend introduces a second, orthogonal axis:

- **Code trust** (existing) — direct execution vs. QuickJS isolate. Binary, per-app.
- **Peer trust** (new) — who may read/write a shared dataset.

A fully trusted *person* can send you code that stays untrusted and runs in the isolate. In
fact it should: receiving an app from a friend is exactly the untrusted path, and the isolate
is what makes accepting it safe. These stay two axes. Collapsing them would quietly grant
ambient authority to any app that arrives from someone in your contacts — the precise failure
mode hard rule 3 exists to prevent.

## Decision

### D1 — Adopt **Jazz (cojson)** as the CRDT + identity engine, behind the existing `Store` interface

**Decided 2026-08-07 by the project owner, after all three candidates were measured to the same
standard.** Final standing: **Jazz > Yjs > Evolu**. The evidence is in
`docs/spikes/jazz-merge-granularity.mjs`, `docs/spikes/jazz-selfhost-e2e.mjs`, and
`docs/spikes/evolu-merge-granularity.mjs`; the reasoning is in the Jazz section under Alternatives.

Summary of what decided it:

- **Per-key merge on a document model** — two peers editing different fields of one record both
  survive, with no storage restructuring (Evolu needed a `SqliteStore` rewrite for this).
- **`CoList` is a real list CRDT** — concurrent appends to a nested `list` field both survive,
  which matters because 3 of the 4 example apps use nested lists.
- **Permissions fail closed in the crypto layer** — a non-member has no read key secret, so no
  valid transaction exists. Not a policy check that can be bypassed.
- **Self-hostable (MIT) with app data as ciphertext only** — verified end to end against a real
  `jazz-run sync` server. Caveat recorded: group/account *metadata* is `trusting` (visible), app
  writes are `private` (opaque).
- It supplies most of D2 and D3, which were the largest pieces of net-new security-sensitive code.

**Yjs remains the documented fallback** if cojson's pre-1.0 status becomes a problem; its merge
semantics are equivalent and the `Store` shape below barely changes.

#### Superseded — the original D1 (Yjs) reasoning

Retained because it is the fallback position and because D5–D8 were written against it.

One `Y.Doc` per *space*; `Y.Map` per entity; each record its own `Y.Map` so merges are
**field-level**, not whole-record last-write-wins.

```
Y.Doc (space)
 └─ Y.Map "expense"        ← entity
     └─ Y.Map <recordId>   ← record; fields merge independently
```

Interface mapping:

| `Store` member | Yjs |
|---|---|
| `all` / `get` | read the `Y.Map` |
| `insert` / `update` | `Y.Doc.transact`; `update`'s patch shape is already the right granularity |
| `delete` | tombstone |
| `subscribe(entity, cb)` | `observeDeep` — the "live feed" `docs/05` anticipated |
| `putBlob` / `getBlob` | **not in the doc** — `MediaRef` only; see D5 |
| `transaction` | ⚠️ local atomicity only; see Consequences |

### D2 — Identity is a **cojson account**, held behind our own seam

**Amended 2026-08-08. The original D2 is superseded — see below.** A person is a display name
plus a **cojson account**, created silently on first run. No signup, no email, no server-side
identity, works offline. `packages/identity` still exists, but it *owns and wraps* the account
rather than implementing crypto: creation, the cached `{ id, name }`, renaming, passphrase
export, and sign-in on a second device.

**Why the change.** The original D2 specified an Ed25519 keypair of our own, written while D1
was still Yjs — which has no identity layer, so we would have had to build one. D1 now adopts
Jazz, and cojson brings accounts, signed transactions, groups and roles with it. Keeping our own
keypair alongside it would mean **two identities per person** that must be kept in agreement,
with the app-visible one unable to prove anything: cojson signs every transaction with the
account that made it, so an account id is verifiable, while an id carried as a field value is
just data any writer can forge. `createdBy` has to be the verifiable one (see the spike's F5).

**Consequences that follow, and they are the reason this is worth writing down:**

- **One id for life.** `ctx.me.id` is the account id from first run, unchanged by turning sync
  on. An id that changed on toggle would orphan every `createdBy` already stamped — the same
  class of failure `toggleAppSync` exists to prevent, and the trap this amendment avoids.
- **Solo still pays almost nothing.** The account is created on first app open and its
  `{ id, name }` is cached, so every later boot answers `ctx.me` from the key store with no
  cojson load at all. Only the very first run pays for the wasm crypto.
- **`packages/store` stops minting accounts.** `jazz-backend.ts` currently owns
  `karta:jazz:accountID` / `:accountSecret`. Ownership of the secret moves to
  `packages/identity`, and the store consumes it — one place responsible for the most
  security-sensitive value we hold.

### D2a — Multi-device is a **passphrase**, never a server

A second device is linked by transferring a **32-byte secret seed** as BIP39 words:
`getCurrentAccountPassphrase()` on the old device, `logIn(passphrase)` on the new one — both
already in `jazz-tools`. Spaces reappear on their own, because membership is keyed on the account.

Two things were checked against the implementation rather than assumed, and both changed the
design:

1. **The account must be created FROM a seed, or it can never produce a passphrase.**
   cojson defaults `initialAgentSecret` to `newRandomAgentSecret()`, which has no seed behind it,
   and `getCurrentAccountPassphrase` recovers the words from a stored seed. An account created the
   default way is therefore unlinkable **forever** — you cannot invent the seed of an existing key,
   so no migration can rescue it. `createJazzStore` now derives from an explicit
   `newRandomSecretSeed()` and keeps it (`karta:jazz:accountSeed`), pinned by
   `jazz-account-seed.test.ts`. Accounts created before this change cannot be linked; sync is
   unreleased, so the blast radius is development data only.

2. **Linking is not server-free, and the earlier draft of this section was wrong to say so.**
   The account *id* is derived locally — `idforHeader(accountHeaderForInitialAgentSecret(...))` —
   so the words alone identify you with no lookup. But the new device still has to *load the
   account CoValue*, and against empty storage with no peer that is the same
   `Account unavailable from all peers` failure that forced the device-global database. So linking
   needs the account to arrive from somewhere: the relay today, a direct LAN/QR transport later.

   This is a weaker claim but still the right one: there is no **identity** server and no signup.
   Linking rides the same relay the user is already syncing through, which only ever sees
   ciphertext. It is honest to say linking requires a transport, and dishonest to imply the words
   are sufficient on a device that has never talked to anything.

Because the passphrase is derived from a seed held since creation, there is **no signup ceremony
and no migration** for accounts created under (1): one made silently months ago exports as words
the first time anyone asks.

**When the words are surfaced** is a product decision with a correctness argument behind it:
permanently available in Settings, and prompted **the first time sync is turned on for any
app** — share, join, or the plain toggle. Never for a solo user, because for a never-synced app
**the words restore nothing**: the data is in local storage on that one device, and the relay
has never held a byte of it. Prompting there would promise a backup that does not exist.

**Recovery is the sellable service, and identity is not.** If someone loses the words *and*
every device, the ciphertext on the relay is undecryptable and the data is gone — local-first
cannot fix that by construction. Optional hosted key escrow is an honest paid service on top
(alongside the hosted relay, business plan §8.4); charging for *identity itself* would reinstate
the signup wall `docs/01` is positioned against. Recovery must never become mandatory, or it is
a central user server wearing a different hat.

#### Superseded — the original D2 (our own Ed25519 keypair)

> New `packages/identity`. An Ed25519 keypair generated on first run. A person is a display name
> plus a public key. No signup, no email, no server-side identity, works offline.

Kept for the record: it remains the right design **if D1 is ever reverted to Yjs**, which has no
identity of its own.

### D3 — A **space** is the unit of sync; solo is a local-only space

```ts
interface Space {
  id: string;               // ULID
  appId: string;
  appVersion: string;       // pinned across peers — see D7
  members: Member[];
  key: CryptoKey;           // symmetric doc key; never leaves member devices
}
interface Member { id: string; name: string; pubKey: string; role: "admin" | "writer" | "reader"; }
```

**Solo = a local-only space with one member and no transport.** No server, no keys, no
behavioral change from today. This is what keeps `docs/01`'s "no server requirement" true and
makes sync opt-in per app rather than a property of the product.

Invites are `https://karta.app/join/<spaceId>#<inviteSecret>` — the secret lives in the URL
**fragment**, which is never transmitted to the relay. Sent over any existing channel.

### D4 — A dumb encrypted store-and-forward **relay** is the primary transport; P2P is an optimization

The relay holds an append-only log of opaque encrypted update blobs per space, authenticated by
a signed member token, and can never decrypt. Self-hostable; a few hundred lines over Node +
SQLite or a Durable Object.

**P2P with a signaling server was explicitly considered and rejected as the primary transport:**

1. **The use cases are asynchronous.** You add an expense at dinner; your flatmate reconciles
   on Sunday. Pure P2P requires both peers online simultaneously — exactly when sync is least
   needed.
2. **Mobile kills peers.** A backgrounded PWA or a closed Capacitor app is not a peer. Being a
   real phone app (KA-03, `docs/13`) is a headline differentiator.
3. **NAT traversal fails a meaningful fraction of the time** → needs TURN → TURN *is* a hosted
   relay. Having paid for it, a store-and-forward relay costs the same and does strictly more.
4. **Signaling-only has nothing to sell** and no credible self-host story, defeating §8.4 Step B.

Later transports, in priority order, all behind one transport seam: **WebRTC** for live sessions
(presence/cursors — this is KA-09's real home), **local-network discovery** (same-Wi-Fi direct
sync), and **sneakernet** via the KA-04 `mergeable` bundle (zero infrastructure, on-ethos).

### D5 — Blobs sync out-of-band

The CRDT doc carries `MediaRef` only. Bytes move through a separate encrypted,
content-addressed blob transport. Putting photos in the doc would balloon every peer's update
log with data most peers never open.

### D6 — Ledger-shaped modelling is the documented pattern for shared apps

Model shared data as **append-only ledgers plus computed derivations**. `docs/06` already
guarantees computed values are *never stored* — they are resolved on read. So concurrent edits
touch only immutable ledger rows, and every derived number is recomputed locally from the
merged set. Conflicts on derived values become structurally impossible rather than
merge-resolved.

This is a documentation and example-fixture obligation, not code.

### D7 — Peers pin `appVersion` per space

The first peer to upgrade runs `docs/06` migrations and writes the new shape into the shared
doc; peers behind it would then read data their app cannot parse. A space pins `appVersion`;
behind-version peers go **read-only** with an upgrade prompt.

### D8 — `sync` becomes a declared capability

`permissions: { sync?: boolean }`, consent-prompted like `network`. Untrusted code that can
write to a document which *leaves the device* is a new exfiltration path and must be governed
at the same seam as every other host power (hard rule 2).

## Alternatives considered

### Jazz (jazz.tools / cojson) — **measured 2026-08-07; now the recommended engine**

> **Correction.** This section originally rejected Jazz on reasoning that was never tested,
> while Evolu was later upgraded on the strength of a real experiment. That asymmetry — assertion
> for one candidate, evidence for the other — is how Evolu came to be recommended. The spike below
> applies the same standard to Jazz and reverses the conclusion. The original objection was that
> "adopting CoValues means Karta's data model becomes Jazz's… a translation layer, not a swap."
> That objection applies *far harder to Evolu*, which requires rewriting `SqliteStore` into
> per-field columns and redoing `migrate.ts` as DDL. Jazz was held to a stricter standard than the
> option that was recommended.

**Measured — `docs/spikes/jazz-merge-granularity.mjs`.** Unlike the Evolu spike (which replays
that engine's merge SQL), this drives **real cojson@0.20.19**: two separate accounts, a shared
`Group`, genuine offline divergence, and a real sync reconnect.

Source first — `dist/coValues/coMap.js` indexes operations per key (`this.ops[key]`), sorts each
key's entries independently, and resolves a winner **per key**
(`this.latest[key] = entries[entries.length - 1]`). Then measured end to end:

| Question | Result |
|---|---|
| Two peers concurrently edit **different fields** of one record | ✅ both survive; `paidBy` untouched; both peers converge |
| Concurrent **appends to a nested list** (workout session → sets) | ✅ both survive, order-independently — `CoList` is a real list CRDT |
| Non-member attempts a write | ✅ denied — and it **fails closed in the crypto layer**, not at a policy check: a non-member has no read key secret, so no valid transaction can be produced at all. The non-member's view of the record is `{}` |

**Why this settles it.** Jazz gives per-field merge **on a document model**, so — unlike Evolu —
it needs no storage restructuring, and it handles the nested-`list` case Evolu handles worst
(3 of the 4 example apps use nested lists). It is, in effect, *Yjs's merge semantics plus Evolu's
identity/permission story*, which is the combination D1 assumed did not exist.

**Costs that remain real:**

- A CoValue-backed `Store` is still an adapter: `transaction`, `subscribe`, blobs and kv all need
  mapping. That is true of every candidate, and it is much smaller than Evolu's storage rewrite.
- `ctx` would surface a Jazz-shaped identity (hard rule 2 tension) — but this is true of any
  adopted identity model, and D2/D3 were going to invent an equivalent one anyway.
- cojson is **0.20.x — pre-1.0**. The original ADR applied this maturity caveat to Evolu's relay
  but not to Jazz; it applies to both.

**Self-hosting + zero-knowledge — measured 2026-08-07, `docs/spikes/jazz-selfhost-e2e.mjs`.**
This was the last load-bearing unknown, and it came from `competitive-analysis.md` §2A rather than
from measurement. Now measured: `jazz-run sync --port … --db …` (MIT) was run locally, and two
accounts were connected **only to it, never to each other**, so every byte between them crossed
the server. Sync worked in both directions. Then the server's own SQLite was searched:

| Probe | Result |
|---|---|
| App value `"SUPERSECRET-DESCRIPTION-MARKER-…"` | **0 hits** |
| App value `987654321` | **0 hits** |
| App *field name* `amountCents` | **0 hits** — key names are encrypted too, not just values |
| Did the server store anything at all? | Yes — 8 coValues, 9 sessions, 30 transactions (so the zeroes mean encryption, not an empty DB) |
| Shape of a stored app write | `{"encryptedChanges":"encrypted_Udx-1UxLbJ3z…","keyUsed":"key_z2bUTps…","privacy":"private"}` |

**Verdict: satisfies "no plaintext on server" for app data — with one honest caveat.** Stored
transactions split **4 `private` / 26 `trusting`**. The `private` ones are the app writes and are
opaque ciphertext under a key the server never holds. The `trusting` ones are account and group
metadata — public keys, role assignments, membership. So a self-hosted (or hostile) server learns
**who is in which group and when they wrote**, but not *what any of it says*. That is the standard
local-first tradeoff — the permission graph must be legible for the sync protocol to route and
authorise — and it is strictly better than the plaintext-Postgres platforms §2A rejects. It should
be stated plainly in any privacy claim rather than marketed as unqualified "zero knowledge".

### Loro / Automerge

Excellent engines. Both are Rust→WASM. Karta already ships a WASM blob (QuickJS) and lazily
loads a second (SQLite); a third is real bundle and complexity cost for no capability Yjs lacks
at personal scale. Yjs is pure JS, ~30 kB, and the most production-hardened of the set.

### Evolu — **timebox run 2026-08-07; stronger than this ADR first credited**

SQLite + E2E + zero-knowledge relay maps suspiciously well onto `SqliteStore`. The timebox was
run before locking D1, and it moved the needle.

**What it already has that D2/D3/D4 propose to build.** Evolu's *Owner* model is close to the
Space/Member design in D3, not merely adjacent to it:

| Evolu | ADR equivalent |
|---|---|
| `AppOwner` — sync coordination + persistence | the local-only solo space (D3) |
| `SharedOwner` — **collaborative write access** | space + `writer` role (D3) |
| `SharedReadonlyOwner` | `reader` role (D3) |
| `ShardOwner` — partition data across owners | per-app space scoping (D3) |
| Per-owner encryption key; an owner can be **deleted outright** from relays and devices | D3's key rotation (KA-17) — and a *better* answer than rotation, since real deletion beats re-keying |

Plus: MIT, self-hostable relay, SQLite-shaped so it lands on `SqliteStore`'s existing ground,
and browser + Electron + React Native support. Its sync protocol is a compact binary format
designed for SQLite. That is most of D2, D3, and D4 — including **key management, the single
largest piece of net-new security-sensitive code this ADR commits to writing**.

**The one blocking unknown: merge granularity.** Karta stores a record as one JSON `data`
column in a generic `records(entity, id, data)` table (`docs/06`). If Evolu's CRDT resolves
per *column*, then two peers editing different fields of the same record collide at
whole-document last-write-wins — losing exactly the field-level merge that D1's
`Y.Map`-per-record gets for free, and losing it silently. Recovering it would mean a column per
field, i.e. tables generated per app entity at runtime, which fights both Evolu's typed static
schema (Kysely) and Karta's runtime-defined entities + `docs/06` migrations.

**Two real but lesser frictions.** Evolu's headline ergonomic win is typed SQL through Kysely —
a win Karta *explicitly declined* (`docs/05`: "no `QuerySpec` with a `where` string, no
SQL-pushdown/residual planner"; filtering is JS predicates in the runtime). And the relay is the
piece the business plan most wants to own, though Evolu's is MIT and self-hostable, which
largely defuses that.

#### Measured 2026-08-07 — `docs/spikes/evolu-merge-granularity.mjs`

Answered from Evolu's own source and then demonstrated. `@evolu/common@7.4.1`
`dist/src/local-first/Sync.js`:

- `applyMessages` (:396) loops **per column**: `for (const [column, value] of columns)`.
- `applyColumnChange` (:448) resolves last-write-wins against a subquery scoped to
  `("ownerId","table","id","column")`, with each column's timestamp kept in `evolu_history`.

**Granularity is per column — confirmed.** The spike drives that exact SQL against real SQLite
(no deps beyond `node:sqlite`; `node docs/spikes/evolu-merge-granularity.mjs`, Node 22+):

| Storage shape | Two peers concurrently edit different fields of one record |
|---|---|
| **A — Karta today**: generic `records(entity, id, data JSON)` | ❌ `description` edit **silently lost**; whole-document LWW |
| **B — one column per field**: `expense(id, description, amountCents, …)` | ✅ both survive, and identically under reversed delivery order |

So the answer is not "Evolu loses" — it is **"Evolu is excellent, but only on storage shape B"**.

#### Two further findings that cut in Evolu's favour

1. **Runtime schema generation works.** `EvoluSchema` is
   `ReadonlyRecord<string, ReadonlyRecord<string, Type<…>>>` — a plain runtime record;
   `ValidateSchema` is a compile-time-only type check. So Karta can build the schema from
   `definition.entities` at load time, which it is unusually well placed to do: the declarative
   half already names every field and its type. Evolu also adds `createdAt`/`updatedAt`/
   `isDeleted`/`ownerId` as system columns, matching `KartaRecord` and giving soft-delete free.
2. **Version skew is already solved.** `evolu_message_quarantine` +
   `tryApplyQuarantinedMessages` hold messages referencing tables/columns the local schema does
   not yet know, and replay them after a schema update. That is **KA-22's hazard**, handled.

#### Superseded — Evolu now ranks third, behind Jazz and Yjs

The analysis below stands on its own evidence, but its *conclusion* was overturned once Jazz was
measured to the same standard (see the Jazz section above). Evolu's per-column granularity taxes
exactly the data model Karta has: it buys identity and roles at the price of a storage rewrite,
whereas Jazz supplies both without one. Retained in full because the measurement is sound and the
`docs/06` consequences it maps out would apply to any per-column engine.

#### Original (now superseded) recommendation — switch D1 to Evolu, conditional on storage shape B

The trade has inverted since this ADR was first drafted:

| | Yjs (D1 as written) | Evolu |
|---|---|---|
| Storage model | keeps `docs/06`'s document table | **requires per-field columns — a real `docs/06` change** |
| Field-level merge | free (`Y.Map` per record) | only on shape B |
| Identity, keys, roles, invites | **we build it** (KA-16, KA-17) | Owners / `SharedOwner` / `SharedReadonlyOwner` |
| Member removal | key rotation (we build) | delete the owner outright — strictly better |
| Version skew (KA-22) | we build | quarantine + replay, built in |
| Relay | we build | MIT, self-hostable |
| Presence (KA-09) | free (awareness) | **not offered — would still need Yjs or similar** |

Evolu removes the expensive, security-critical, easy-to-get-wrong work (key management, roles,
invites, relay, skew) and adds mechanical work (generate tables from field definitions) that
Karta's declarative schema makes cheap. That is a good trade.

**Residual risks, both real:**

- **Nested `list` fields** (workout: session → entries → sets, `docs/08` WP9) do not decompose
  into columns. They would live in a JSON column and therefore keep **whole-value LWW**. Probably
  acceptable — a list edit is usually a whole-list edit — but it must be a decision, not a
  discovery.
- **Presence is not in the box.** KA-09 would need Yjs awareness or equivalent alongside.
- Coupling storage to Evolu's model weakens "swap at composition root only" (`docs/02`), though
  `docs/06` already sanctions alternative impls behind `Store`.

**Status: this ADR remains `Proposed`.** D1 as written (Yjs) is no longer the recommendation, but
switching it is a call for the project owner, because it changes `docs/06`'s storage model and
`docs/06` is load-bearing for migrations. The decision needed is: *is per-field-column storage
acceptable?* If yes, adopt Evolu and D2/D3 shrink dramatically. If no, Yjs stands exactly as
originally decided.

### cr-sqlite, Replicache, PowerSync / Zero / ElectricSQL / InstantDB

Per §2A: cr-sqlite dormant since Oct 2024; Replicache archived Jun 2026; the rest are
server-authoritative over plaintext Postgres, violating no-plaintext-on-server. Acceptable
later only as optional "sync to my own DB" adapters.

### Solid (solidproject.org) — **rejected as foundation; keep as a future optional adapter**

Evaluated at the request of the project owner. Solid solves *hosting, identity, and access
control*; Karta's blocker is *merge*. The overlap is thin:

- **No merge semantics.** Solid is LDP over HTTP with ETag/`If-Match` optimistic concurrency —
  a `412 Conflict`, not a merge. A CRDT would still be required on top.
- **Server-first, not local-first.** A Pod is an HTTP endpoint; `Store` must work offline
  (hard rule 6).
- **No E2E in the model.** Pod providers read your data unless self-hosted, and encrypting
  inside a Pod destroys the interop that is Solid's entire justification.
- **RDF impedance.** Karta records are Zod-validated JSON documents. Solid is RDF triples with
  shared vocabularies. Storing opaque JSON blobs in a Pod is possible but forfeits the interop,
  at which point WebDAV or S3 is simpler.
- **Onboarding tax.** Both parties need a Pod and a WebID; WebID resolution requires an HTTP
  fetch, so it cannot be the offline identity primitive. An invite link with the key in the
  fragment needs no accounts at all.
- **Adoption shape.** 2026 momentum is EU government/enterprise data spaces (ODI roadmap,
  Solid CG), not consumer personal apps.

What Solid genuinely has that Karta lacks is **WebID + ACP as a mature per-resource permission
model**, which is worth studying for D3's roles. And like every data-plane technology surveyed,
it does nothing about running someone else's *logic* safely — Karta's actual moat.

**Revisit as** one optional transport adapter among several ("sync via my own Pod"), the same
treatment §2A prescribes for PowerSync/Electric. Costs nothing today provided D4's transport
seam stays clean.

## Consequences

### Positive

- `Store` survives intact; the CRDT arrives as a fourth implementation.
- Presence (KA-09) becomes near-free via Yjs awareness.
- The relay is ours to sell, ours to self-host, and holds only ciphertext — liability-light,
  marginal cost is blob storage and bandwidth.
- `ctx.me` + a `member` field type make shared apps expressible as *declarative data* (hard
  rule 4) rather than pushing identity into app-level convention.
- Ledger-shaped modelling (D6) plays to an existing strength: never-stored computed values.

### Negative / accepted risks

- **We own key management and rotation.** Removing a member must rotate the space key or they
  decrypt forever. This is the single largest piece of net-new security-sensitive code, and it
  is exactly what adopting Jazz would have avoided.
- **`Store.transaction` cannot mean distributed atomicity.** CRDTs give atomic *local*
  application. Multi-record invariants across peers are not achievable and must be documented
  as such; ledger shape (D6) is the mitigation.
- **A malicious member can write arbitrary values into a shared doc.** The relay is
  zero-knowledge and therefore *cannot* validate. Mitigated by validating inbound updates
  client-side against the declarative schema — Karta already has those Zod validators, which
  makes this unusually cheap and is a differentiated safety property.
- **`ctx` grows**, which is a trust-sensitive seam. Per `docs/08`, no new `ctx` member or field
  type ships without types + impl + tests + fixtures + reconciled docs in the same PR, and
  `schemaVersion` bumps.
- **Scope tension with `docs/01`**, which lists multi-user as an explicit non-goal ("do not let
  them shape the core"). D3 is designed to respect it — solo stays local-only with no server
  and no behavioral change — but `docs/01` must be updated to record the decision deliberately
  rather than letting it drift.

## Implementation sequence

Multi-*device* is deliberately split from multi-*user*: they share most machinery, and the
former has no adversarial peer and no key rotation, so it is far easier to get right.

| # | Step | Issues |
|---|---|---|
| 0 | **Shared apps must be able to render their primary screen untrusted.** Discovered by the spike; upstream of everything here. | KA-24 |
| 1 | Identity + spaces, **local only** — `ctx.me`, `member` field type, `createdBy`, `ctx`-aware defaults, **device linking by passphrase** (D2a). No network. | KA-16, KA-18, KA-19, KA-25, KA-26 |
| 2 | ~~`YjsStore`~~ **`JazzStore`** behind `Store`; two peers converge in-process, no server | KA-08 ✅ |
| 3 | Relay + E2E + **multi-device, single user**. Sellable alone (§8.4 Step B). | KA-08 ✅, KA-20 |
| 4 | **Multi-user** spaces: invites, roles, key rotation, inbound validation, version gating | KA-17, KA-21, KA-22, KA-23 |
| 5 | Presence / awareness | KA-09 |
| 6 | Share / fork distribution channel | KA-10, KA-11 |

**Steps 2 and 3 landed before step 1** — the engine question was the risky one, so it was
answered first. Two peers converge through a real relay in a real browser
(`e2e/sync-two-peers-trusted.spec.ts`). Step 1 is what is being built now, and D2a folds the
device-linking half of step 3 into it, since both rest on the same account.

Step 1 is fully testable against `MemoryStore` with zero network, and it is what unblocks
*writing* the Splitwise fixture before any sync exists. A shared shopping list is usable at
step 3 (two devices) or step 4 (two people); Splitwise needs step 4.

**Step 0 is not optional and was not in the backlog before this ADR.** The spike showed that a
shared app's main screen is typically an aggregate ("who owes whom", "what's left to buy"),
aggregates have no declarative home, so they become custom views — and `docs/05` policy makes
custom views trusted-only. The sharing feature therefore delivers a blank screen to precisely
the recipients it exists for. Building steps 1–6 on top of that would produce a sync stack
nobody can use without first promoting a stranger's code to ambient authority.

## Validation

The spike at `docs/spikes/split.app.ts` expresses a Splitwise-style app against the proposed
`ctx.me` + `member` surface, to pressure-test whether these primitives carry their weight
before any of it is built. It intentionally does not compile — see its header.
