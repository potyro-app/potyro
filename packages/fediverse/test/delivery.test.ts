import { describe, expect, it } from "vitest";
import { BACKOFF_MINUTES, GIVE_UP_MS } from "../src/delivery.ts";
import { createFediverse } from "../src/fediverse.ts";
import { parseSignature, verifyRequest } from "../src/signature.ts";
import { memoryStore } from "../src/store.ts";
import { ACTOR, KEYS, PROFILE, T0, account, app, feed, followOf, get, signedPost, world, type Account } from "./helpers.ts";

const ana = account("social.example", "ana");
const bia = account("social.example", "bia");
const caio = account("other.example", "caio");
const MINUTE = 60_000;

/** An account with these followers, the first feed already posted, and nothing waiting. */
async function start(followers: Account[], first = [app("pantry")]) {
  const w = world([ana, bia, caio]);
  const clock = { now: T0 };
  const store = memoryStore(KEYS.ours.privateKey);
  const fedi = await createFediverse({ profile: PROFILE, store, outbound: w.outbound, now: () => clock.now });
  await fedi.sync(feed(first));
  for (const f of followers) await fedi.handle(signedPost(f, followOf(f), clock.now));
  await fedi.deliver();
  w.asked.length = 0;
  return { fedi, w, clock, store };
}

describe("posting what the gallery publishes", () => {
  it("the first feed is posted with the gallery's own dates, to nobody: there is no one yet", async () => {
    const { fedi, w } = await start([]);
    expect(w.posts()).toHaveLength(0);
    expect(fedi.waiting()).toBe(0);
    const note = JSON.parse((await fedi.handle(get("/fedi/notes/pantry"))).body);
    expect(note.published).toBe("2026-11-06T21:21:06.442Z");
  });

  it("a new app goes out once per server, signed, as a Create dated now", async () => {
    const { fedi, w, clock } = await start([ana, bia, caio]);
    clock.now = T0 + 5 * MINUTE;
    const result = await fedi.sync(feed([app("pantry"), app("piano")]));
    expect(result).toEqual({ created: ["piano"], updated: [], deleted: [] });
    expect(await fedi.deliver()).toMatchObject({ sent: 2, failed: 0 });

    const posts = w.posts();
    // Ana and Bia are on one server: its shared inbox gets one copy.
    expect(posts.map((p) => p.url).sort()).toEqual([caio.sharedInbox, ana.sharedInbox].sort());
    for (const p of posts) {
      expect(p.activity).toMatchObject({ "@context": expect.any(Array), type: "Create", actor: ACTOR, to: ["https://www.w3.org/ns/activitystreams#Public"], object: { id: "https://potyro.example/fedi/notes/piano", type: "Note", published: "2026-11-28T12:05:00.000Z" } });
      const { headers, body } = p.request;
      const url = new URL(p.url);
      expect(headers["content-type"]).toBe("application/activity+json");
      expect(verifyRequest({ method: "POST", target: url.pathname, headers, body: body!, signature: parseSignature(headers.signature)!, publicKeyPem: KEYS.ours.publicKey, host: url.host, now: clock.now })).toEqual({ ok: true });
    }
    expect(fedi.waiting()).toBe(0);
  });

  it("a feed that says the same again posts nothing", async () => {
    const { fedi, w, store } = await start([ana]);
    const writes = store.writes();
    expect(await fedi.sync(feed([app("pantry")]))).toEqual({ created: [], updated: [], deleted: [] });
    await fedi.deliver();
    expect(w.posts()).toHaveLength(0);
    expect(store.writes()).toBe(writes);
  });

  it("an app whose words or link changed is sent again as an Update, keeping its first date", async () => {
    const { fedi, w, clock } = await start([ana]);
    clock.now = T0 + 10 * MINUTE;
    const result = await fedi.sync(feed([app("pantry", { link: "https://potyro.app/s/pantry2#k=new", publishedAt: "2026-11-28T12:09:00.000Z" })]));
    expect(result.updated).toEqual(["pantry"]);
    await fedi.deliver();
    const [update] = w.posts();
    expect(update!.activity).toMatchObject({ type: "Update", object: { id: "https://potyro.example/fedi/notes/pantry", published: "2026-11-06T21:21:06.442Z", updated: "2026-11-28T12:10:00.000Z" } });
    expect(String((update!.activity.object as { content: string }).content)).toContain("pantry2");
  });

  it("an app that leaves the gallery is taken down with a Delete", async () => {
    const { fedi, w } = await start([ana], [app("pantry"), app("piano")]);
    expect((await fedi.sync(feed([app("piano")]))).deleted).toEqual(["pantry"]);
    await fedi.deliver();
    expect(w.posts()[0]!.activity).toMatchObject({ type: "Delete", actor: ACTOR, object: { id: "https://potyro.example/fedi/notes/pantry", type: "Tombstone" } });
    expect((await fedi.handle(get("/fedi/notes/pantry"))).status).toBe(410);
  });

  it("what was posted and who follows is still there after a restart, and nothing is posted twice", async () => {
    const { fedi, w, store, clock } = await start([ana]);
    await fedi.sync(feed([app("pantry"), app("piano")]));
    const again = await createFediverse({ profile: PROFILE, store, outbound: w.outbound, now: () => clock.now });
    expect(again.followers()).toBe(1);
    expect(again.waiting()).toBe(1);
    expect(await again.sync(feed([app("pantry"), app("piano")]))).toEqual({ created: [], updated: [], deleted: [] });
    await again.deliver();
    expect(w.posts()).toHaveLength(1);
  });
});

describe("a delivery that does not arrive", () => {
  it("is tried again later, further apart each time, until it arrives", async () => {
    const { fedi, w, clock } = await start([ana]);
    w.answers[ana.sharedInbox] = 500;
    await fedi.sync(feed([app("pantry"), app("piano")]));
    expect(await fedi.deliver()).toMatchObject({ sent: 0, failed: 1 });
    expect(fedi.waiting()).toBe(1);
    // Not before its time.
    clock.now += BACKOFF_MINUTES[0] * MINUTE - 1000;
    await fedi.deliver();
    expect(w.posts()).toHaveLength(1);
    clock.now += 1000;
    w.answers[ana.sharedInbox] = "error";
    await fedi.deliver();
    expect(w.posts()).toHaveLength(2);
    clock.now += BACKOFF_MINUTES[1] * MINUTE;
    w.answers[ana.sharedInbox] = 202;
    expect(await fedi.deliver()).toMatchObject({ sent: 1 });
    expect(fedi.waiting()).toBe(0);
    expect(fedi.followers()).toBe(1);
  });

  it("is given up on after the last try, and the follower stays: one bad week is not the end", async () => {
    const { fedi, w, clock } = await start([ana]);
    w.answers[ana.sharedInbox] = 503;
    await fedi.sync(feed([app("pantry"), app("piano")]));
    for (const minutes of BACKOFF_MINUTES) {
      await fedi.deliver();
      expect(fedi.waiting()).toBe(1);
      clock.now += minutes * MINUTE;
    }
    // The first try and one more after each wait: about three days in all.
    await fedi.deliver();
    expect(w.posts()).toHaveLength(BACKOFF_MINUTES.length + 1);
    expect(BACKOFF_MINUTES.reduce((a, b) => a + b, 0) / 60 / 24).toBeCloseTo(2.86, 1);
    expect(fedi.waiting()).toBe(0);
    expect(fedi.followers()).toBe(1);
  });

  it("a server whose deliveries have failed for a week loses its followers here", async () => {
    const { fedi, w, clock } = await start([ana, bia, caio]);
    w.answers[ana.sharedInbox] = 503;
    const exhaust = async (apps: ReturnType<typeof app>[]) => {
      await fedi.sync(feed(apps));
      for (const minutes of BACKOFF_MINUTES) {
        await fedi.deliver();
        clock.now += minutes * MINUTE;
      }
      await fedi.deliver();
    };
    await exhaust([app("pantry"), app("piano")]);
    expect(fedi.followers()).toBe(3);
    clock.now += GIVE_UP_MS;
    await exhaust([app("pantry"), app("piano"), app("ticker")]);
    // Ana and Bia were on the unreachable server; Caio's got everything.
    expect(fedi.followers()).toBe(1);
    expect(fedi.waiting()).toBe(0);
  });

  it("a server that answers 410 Gone loses its followers at once", async () => {
    const { fedi, w } = await start([ana, bia, caio]);
    w.answers[ana.sharedInbox] = 410;
    await fedi.sync(feed([app("pantry"), app("piano")]));
    expect(await fedi.deliver()).toMatchObject({ sent: 1, failed: 1, unfollowed: 2 });
    expect(fedi.followers()).toBe(1);
    expect(fedi.waiting()).toBe(0);
  });

  it("a follow that comes in while a round is out is not lost when the round settles", async () => {
    const w = world([ana, caio]);
    const store = memoryStore(KEYS.ours.privateKey);
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    const slow: typeof w.outbound = async (request) => {
      if (request.method === "POST" && request.url === ana.inbox) await held;
      return w.outbound(request);
    };
    const fedi = await createFediverse({ profile: PROFILE, store, outbound: slow, now: () => T0 });
    await fedi.handle(signedPost(ana, followOf(ana)));
    const round = fedi.deliver();
    await fedi.handle(signedPost(caio, followOf(caio)));
    release();
    await round;
    expect(fedi.waiting()).toBe(1);
    await fedi.deliver();
    expect(w.posts().map((p) => p.url).sort()).toEqual([caio.inbox, ana.inbox].sort());
  });
});

describe("the order things are written and sent in", () => {
  it("a feed whose notes could not be written is posted in full the next time: nothing is marked posted and never sent", async () => {
    const w = world([ana]);
    const inner = memoryStore(KEYS.ours.privateKey);
    let full = false;
    const store = { ...inner, write: ((part, value) => (full && part === "notes" ? Promise.reject(new Error("disk full")) : inner.write(part, value))) as typeof inner.write };
    const fedi = await createFediverse({ profile: PROFILE, store, outbound: w.outbound, now: () => T0 });
    await fedi.sync(feed([app("pantry")]));
    await fedi.handle(signedPost(ana, followOf(ana)));
    await fedi.deliver();
    full = true;
    await expect(fedi.sync(feed([app("pantry"), app("piano")]))).rejects.toThrow(/disk full/);
    full = false;
    expect((await fedi.sync(feed([app("pantry"), app("piano")]))).created).toEqual(["piano"]);
    await fedi.deliver();
    // Queued once, though it was compared twice.
    expect(w.posts().filter((p) => p.activity.type === "Create")).toHaveLength(1);
    expect(fedi.waiting()).toBe(0);
  });

  it("what goes to one inbox goes in order: an Update waits for the Create before it", async () => {
    const { fedi, w, clock } = await start([ana]);
    w.answers[ana.sharedInbox] = 500;
    await fedi.sync(feed([app("pantry"), app("piano")]));
    await fedi.deliver();
    clock.now += 30 * 1000;
    await fedi.sync(feed([app("pantry"), app("piano", { link: "https://potyro.app/s/piano2#k=new" })]));
    w.answers[ana.sharedInbox] = 202;
    // The Update is due, the Create is not yet: neither is sent.
    await fedi.deliver();
    expect(w.posts()).toHaveLength(1);
    clock.now += BACKOFF_MINUTES[0] * MINUTE;
    await fedi.deliver();
    await fedi.deliver();
    expect(w.posts().map((p) => p.activity.type)).toEqual(["Create", "Create", "Update"]);
  });

  it("no more than two deliveries to one server in a round, so a slow one holds up nobody else", async () => {
    const many = ["a", "b", "c", "d"].map((n) => {
      const one = account("slow.example", n);
      return { ...one, doc: { ...one.doc, endpoints: undefined } };
    });
    const w = world([...many, caio]);
    const fedi = await createFediverse({ profile: PROFILE, store: memoryStore(KEYS.ours.privateKey), outbound: w.outbound, now: () => T0 });
    for (const f of [...many, caio]) await fedi.handle(signedPost(f, followOf(f)));
    await fedi.deliver();
    expect(w.posts().map((p) => new URL(p.url).host).sort()).toEqual(["other.example", "slow.example", "slow.example"]);
    await fedi.deliver();
    expect(fedi.waiting()).toBe(0);
  });

  it("whoever followed before there was anything to post is not sent the whole gallery at once", async () => {
    const w = world([ana]);
    const fedi = await createFediverse({ profile: PROFILE, store: memoryStore(KEYS.ours.privateKey), outbound: w.outbound, now: () => T0 });
    await fedi.handle(signedPost(ana, followOf(ana)));
    await fedi.deliver();
    await fedi.sync(feed([app("pantry"), app("piano")]));
    await fedi.deliver();
    expect(w.posts().map((p) => p.activity.type)).toEqual(["Accept"]);
    await fedi.sync(feed([app("pantry"), app("piano"), app("ticker")]));
    await fedi.deliver();
    expect(w.posts().map((p) => p.activity.type)).toEqual(["Accept", "Create"]);
  });

  it("refuses a feed that drops most of what is posted, and changes nothing", async () => {
    const { fedi, w } = await start([ana], [app("a"), app("b"), app("c"), app("d")]);
    await expect(fedi.sync(feed([app("a")]))).rejects.toThrow(/drops 3 of the 4/);
    await fedi.deliver();
    expect(w.posts()).toHaveLength(0);
    expect((await fedi.handle(get("/fedi/notes/b"))).status).toBe(200);
    // Two of four is allowed.
    expect((await fedi.sync(feed([app("a"), app("b")]))).deleted).toEqual(["c", "d"]);
  });

  it("after a restart the posts are still served, before any feed file is read", async () => {
    const { store, w } = await start([ana]);
    const again = await createFediverse({ profile: PROFILE, store, outbound: w.outbound, now: () => T0 });
    const res = await again.handle(get("/fedi/notes/pantry"));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).content).toContain("Name of pantry");
  });
});
