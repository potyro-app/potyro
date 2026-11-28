import { describe, expect, it } from "vitest";
import { createFediverse } from "../src/fediverse.ts";
import { remoteOf } from "../src/inbox.ts";
import { parseSignature, verifyRequest } from "../src/signature.ts";
import { memoryStore } from "../src/store.ts";
import { ACTOR, KEYS, PROFILE, T0, account, followOf, signedPost, world, type Account } from "./helpers.ts";

const ana = account("social.example", "ana");
const bia = account("social.example", "bia");

async function start(accounts: Account[] = [ana, bia], limits = {}) {
  const w = world(accounts);
  const store = memoryStore(KEYS.ours.privateKey);
  const fedi = await createFediverse({ profile: PROFILE, store, outbound: w.outbound, now: () => T0, limits });
  return { fedi, w, store };
}

describe("following", () => {
  it("a signed Follow makes a follower, and is answered with a signed Accept at their own inbox", async () => {
    const { fedi, w, store } = await start();
    const res = await fedi.handle(signedPost(ana, followOf(ana)));
    expect(res.status).toBe(202);
    expect(fedi.followers()).toBe(1);
    expect((await store.read("followers"))![ana.id]).toMatchObject({ id: ana.id, inbox: ana.inbox, sharedInbox: ana.sharedInbox, keyId: ana.keyId, since: "2026-11-28T12:00:00.000Z" });

    await fedi.deliver();
    const [accept] = w.posts();
    expect(accept!.url).toBe(ana.inbox);
    expect(accept!.activity).toMatchObject({ type: "Accept", actor: ACTOR, object: { id: `${ana.id}#follows/1`, type: "Follow", actor: ana.id, object: ACTOR } });
    // The Accept is signed with the account's key: their server checks it against the actor's.
    const { headers, body } = accept!.request;
    const verdict = verifyRequest({ method: "POST", target: "/users/ana/inbox", headers, body: body!, signature: parseSignature(headers.signature)!, publicKeyPem: KEYS.ours.publicKey, host: "social.example", now: T0 });
    expect(verdict).toEqual({ ok: true });
    expect(fedi.waiting()).toBe(0);
  });

  it("the lookup of the follower's key is itself signed, and is made once", async () => {
    const { fedi, w } = await start();
    await fedi.handle(signedPost(ana, followOf(ana)));
    await fedi.handle(signedPost(ana, followOf(ana, `${ana.id}#follows/2`)));
    const lookups = w.asked.filter((r) => r.method === "GET");
    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.url).toBe(ana.id);
    expect(lookups[0]!.headers.signature).toContain(`keyId="${ACTOR}#main-key"`);
    expect(fedi.followers()).toBe(1);
  });

  it("refuses a Follow that is not signed, or signed by someone else's key", async () => {
    const { fedi } = await start();
    const unsigned = signedPost(ana, followOf(ana));
    expect((await fedi.handle({ ...unsigned, headers: { ...unsigned.headers, signature: undefined } })).status).toBe(401);
    // Bia's server sends a Follow that says it is from Ana, signed with a key that is not Ana's.
    const forged = signedPost({ keyId: ana.keyId, privateKey: KEYS.other.privateKey }, followOf(ana));
    expect((await fedi.handle(forged)).status).toBe(401);
    expect(fedi.followers()).toBe(0);
  });

  it("refuses a Follow whose key lives on another server than its account", async () => {
    const mallory = account("evil.example", "mallory", KEYS.other);
    const { fedi, w } = await start([ana, mallory]);
    // Signed with Mallory's real key, but saying the follower is Ana.
    const res = await fedi.handle(signedPost(mallory, followOf(ana)));
    expect(res.status).toBe(401);
    expect(fedi.followers()).toBe(0);
    expect(w.asked.every((r) => r.url === ana.id)).toBe(true);
  });

  it("refuses a body changed after it was signed, and a signature that is too old", async () => {
    const { fedi } = await start();
    const good = signedPost(ana, followOf(ana));
    const changed = new Uint8Array(Buffer.from(JSON.stringify(followOf(ana, "https://social.example/other"))));
    expect((await fedi.handle({ ...good, body: changed })).status).toBe(401);
    expect((await fedi.handle(signedPost(ana, followOf(ana), T0 - 3 * 60 * 60 * 1000))).status).toBe(401);
    expect(fedi.followers()).toBe(0);
  });

  it("never looks up an account whose address it would not ask", async () => {
    const { fedi, w } = await start();
    for (const actor of ["http://social.example/users/ana", "https://127.0.0.1/users/ana", "https://localhost/users/ana", "https://social.example:8443/users/ana"]) {
      const res = await fedi.handle(signedPost(ana, { ...followOf(ana), actor }));
      expect(res.status, actor).toBe(202);
    }
    expect(w.asked).toHaveLength(0);
    expect(fedi.followers()).toBe(0);
  });

  it("looks up only so many accounts a minute, and says to come back", async () => {
    const { fedi, w } = await start([ana, bia], { lookupsPerMinute: 1 });
    expect((await fedi.handle(signedPost(ana, followOf(ana)))).status).toBe(202);
    expect((await fedi.handle(signedPost(bia, followOf(bia)))).status).toBe(503);
    expect(w.asked.filter((r) => r.method === "GET")).toHaveLength(1);
  });

  it("keeps only so many followers", async () => {
    const { fedi } = await start([ana, bia], { maxFollowers: 1 });
    expect((await fedi.handle(signedPost(ana, followOf(ana)))).status).toBe(202);
    expect((await fedi.handle(signedPost(bia, followOf(bia)))).status).toBe(503);
    expect(fedi.followers()).toBe(1);
  });
});

describe("leaving", () => {
  const undoOf = (a: Account) => ({ id: `${a.id}#undo/1`, type: "Undo", actor: a.id, object: followOf(a) });

  it("a signed Undo of the Follow forgets the follower, with no new lookup", async () => {
    const { fedi, w, store } = await start();
    await fedi.handle(signedPost(ana, followOf(ana)));
    const res = await fedi.handle(signedPost(ana, undoOf(ana)));
    expect(res.status).toBe(202);
    expect(fedi.followers()).toBe(0);
    expect(await store.read("followers")).toEqual({});
    expect(w.asked.filter((r) => r.method === "GET")).toHaveLength(1);
  });

  it("nobody can unfollow for someone else", async () => {
    const { fedi } = await start();
    await fedi.handle(signedPost(ana, followOf(ana)));
    await fedi.handle(signedPost(bia, followOf(bia)));
    // Signed by Bia (a real follower), about Ana.
    const forged = signedPost({ keyId: ana.keyId, privateKey: KEYS.other.privateKey }, undoOf(ana));
    expect((await fedi.handle(forged)).status).toBe(401);
    expect(fedi.followers()).toBe(2);
  });

  it("an account deleted on its server is forgotten, checked against the key kept when it followed", async () => {
    const { fedi, w } = await start();
    await fedi.handle(signedPost(ana, followOf(ana)));
    const asked = w.asked.length;
    const gone = { id: `${ana.id}#delete`, type: "Delete", actor: ana.id, object: ana.id };
    expect((await fedi.handle(signedPost({ keyId: ana.keyId, privateKey: KEYS.other.privateKey }, gone))).status).toBe(401);
    expect(fedi.followers()).toBe(1);
    expect((await fedi.handle(signedPost(ana, gone))).status).toBe(202);
    expect(fedi.followers()).toBe(0);
    expect(w.asked).toHaveLength(asked);
  });
});

describe("everything else", () => {
  it("answers 202 and does nothing for replies, likes, boosts and strangers' deletes: no lookup, nothing kept", async () => {
    const { fedi, w, store } = await start();
    const note = { type: "Note", content: "nice app!", inReplyTo: "https://potyro.example/fedi/notes/pantry" };
    const others = [
      { type: "Create", actor: ana.id, object: note },
      { type: "Like", actor: ana.id, object: "https://potyro.example/fedi/notes/pantry" },
      { type: "Announce", actor: ana.id, object: "https://potyro.example/fedi/notes/pantry" },
      { type: "Delete", actor: "https://far.example/users/x", object: "https://far.example/users/x" },
      { type: "Undo", actor: ana.id, object: followOf(ana) },
      { type: "Follow", actor: ana.id, object: "https://potyro.example/fedi/someone-else" },
    ];
    for (const activity of others) {
      const res = await fedi.handle(signedPost(ana, activity));
      expect(res.status, activity.type).toBe(202);
    }
    expect(w.asked).toHaveLength(0);
    expect(store.writes()).toBe(0);
  });

  it("refuses what is not an activity, and what is too big to be one", async () => {
    const { fedi } = await start([ana], { inboxBytes: 500 });
    const post = (text: string) => fedi.handle({ ...signedPost(ana, {}), body: new Uint8Array(Buffer.from(text)) });
    expect((await post("{not json")).status).toBe(400);
    expect((await post("[1,2]")).status).toBe(400);
    expect((await post(JSON.stringify({ type: "Follow", pad: "x".repeat(600) }))).status).toBe(413);
  });
});

describe("what is kept of an account", () => {
  it("its inbox, its server's shared inbox and its key, all on its own server", () => {
    expect(remoteOf(ana.doc, ana.id)).toEqual({ id: ana.id, inbox: ana.inbox, sharedInbox: ana.sharedInbox, keyId: ana.keyId, publicKeyPem: KEYS.theirs.publicKey });
  });

  it("nothing from a document that is another account's, has no key, or points elsewhere", () => {
    expect(remoteOf(ana.doc, bia.id)).toBeNull();
    expect(remoteOf({ ...ana.doc, publicKey: undefined }, ana.id)).toBeNull();
    expect(remoteOf({ ...ana.doc, publicKey: { ...(ana.doc.publicKey as object), owner: bia.id } }, ana.id)).toBeNull();
    expect(remoteOf({ ...ana.doc, inbox: "https://victim.example/inbox" }, ana.id)).toBeNull();
    expect(remoteOf({ ...ana.doc, inbox: "https://10.0.0.1/inbox" }, ana.id)).toBeNull();
    // A shared inbox on another server is left out; the account's own inbox is used.
    expect(remoteOf({ ...ana.doc, endpoints: { sharedInbox: "https://victim.example/inbox" } }, ana.id)).toMatchObject({ inbox: ana.inbox });
    expect(remoteOf({ ...ana.doc, endpoints: { sharedInbox: "https://victim.example/inbox" } }, ana.id)).not.toHaveProperty("sharedInbox");
    expect(remoteOf("<html>", ana.id)).toBeNull();
  });
});

describe("what one sender can cost everyone", () => {
  it("following again and again queues one answer, not one each time", async () => {
    const { fedi, w, store } = await start();
    w.answers[ana.inbox] = 500;
    for (let n = 0; n < 20; n++) expect((await fedi.handle(signedPost(ana, followOf(ana, `${ana.id}#follows/${n}`)))).status).toBe(202);
    expect(fedi.waiting()).toBe(1);
    expect(fedi.followers()).toBe(1);
    // The follower did not change, so the followers were written once.
    expect(store.writes()).toBe(2);
  });

  it("a Follow must have an id, a short string: it is what the answer names", async () => {
    const { fedi, w } = await start();
    for (const id of [undefined, { nested: "x".repeat(1000) }, "x".repeat(3000)]) {
      expect((await fedi.handle(signedPost(ana, { ...followOf(ana), id }))).status).toBe(400);
    }
    expect(w.asked).toHaveLength(0);
    expect(fedi.waiting()).toBe(0);
  });

  it("stops queueing answers when too much is already waiting", async () => {
    const { fedi } = await start([ana, bia], { maxWaiting: 1 });
    expect((await fedi.handle(signedPost(ana, followOf(ana)))).status).toBe(202);
    expect((await fedi.handle(signedPost(bia, followOf(bia)))).status).toBe(503);
    expect(fedi.waiting()).toBe(1);
  });

  it("one address spends its own lookups, not everyone's", async () => {
    const strangers = ["a", "b", "c"].map((n) => account(`${n}.example`, "x", KEYS.other));
    const { fedi, w } = await start([ana, ...strangers], { lookupsPerAddressMinute: 2, lookupsPerMinute: 10 });
    // Signed with a key that is not the account's: each costs a lookup and is refused.
    const bogus = (a: Account) => fedi.handle(signedPost({ keyId: a.keyId, privateKey: KEYS.theirs.privateKey }, followOf(a), T0, { ip: "6.6.6.6" }));
    expect((await bogus(strangers[0]!)).status).toBe(401);
    expect((await bogus(strangers[1]!)).status).toBe(401);
    expect((await bogus(strangers[2]!)).status).toBe(503);
    expect(w.asked.filter((r) => r.method === "GET")).toHaveLength(2);
    // Someone else still follows.
    expect((await fedi.handle(signedPost(ana, followOf(ana), T0, { ip: "9.9.9.9" }))).status).toBe(202);
  });

  it("spends no lookup on a key that is on another server than its account, or on an account that says it is here", async () => {
    const mallory = account("evil.example", "mallory", KEYS.other);
    const { fedi, w } = await start([ana, mallory]);
    expect((await fedi.handle(signedPost(mallory, followOf(ana)))).status).toBe(401);
    const here = { ...followOf(ana), actor: "https://potyro.example/fedi/actor" };
    expect((await fedi.handle(signedPost({ keyId: "https://potyro.example/fedi/actor#main-key", privateKey: KEYS.other.privateKey }, here))).status).toBe(401);
    expect(w.asked).toHaveLength(0);
  });

  it("keeps only so many followers from one server", async () => {
    const { fedi } = await start([ana, bia], { maxFollowersPerHost: 1 });
    expect((await fedi.handle(signedPost(ana, followOf(ana)))).status).toBe(202);
    expect((await fedi.handle(signedPost(bia, followOf(bia)))).status).toBe(503);
  });

  it("an unfollow that arrives while the Follow is still being checked is told to come back, not lost", async () => {
    const w = world([ana]);
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    const fedi = await createFediverse({ profile: PROFILE, store: memoryStore(KEYS.ours.privateKey), now: () => T0, outbound: async (r) => (r.method === "GET" && (await held), w.outbound(r)) });
    const following = fedi.handle(signedPost(ana, followOf(ana)));
    await new Promise((r) => setTimeout(r, 5));
    const undo = { id: `${ana.id}#undo/1`, type: "Undo", actor: ana.id, object: followOf(ana) };
    expect((await fedi.handle(signedPost(ana, undo))).status).toBe(503);
    release();
    expect((await following).status).toBe(202);
    expect((await fedi.handle(signedPost(ana, undo))).status).toBe(202);
    expect(fedi.followers()).toBe(0);
  });

  it("a key document padded with something before the key is not kept", () => {
    const key = ana.doc.publicKey as { publicKeyPem: string };
    expect(remoteOf({ ...ana.doc, publicKey: { ...key, publicKeyPem: `${"junk ".repeat(100)}\n${key.publicKeyPem}` } }, ana.id)).toBeNull();
  });
});
