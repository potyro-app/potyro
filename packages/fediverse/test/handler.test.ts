import { describe, expect, it } from "vitest";
import { createFediverse, checkProfile } from "../src/fediverse.ts";
import { memoryStore } from "../src/store.ts";
import { ACTOR, KEYS, PROFILE, T0, app, feed, get, world } from "./helpers.ts";

async function start(limits = {}) {
  const fedi = await createFediverse({ profile: PROFILE, store: memoryStore(KEYS.ours.privateKey), outbound: world([]).outbound, now: () => T0, limits });
  await fedi.sync(feed([app("pantry"), app("piano", { publishedAt: "2026-11-20T10:00:00.000Z" })]));
  return fedi;
}

const body = (r: { body: string }) => JSON.parse(r.body) as Record<string, any>;

describe("who the account is", () => {
  it("webfinger answers for the handle, in any case, with where the account is", async () => {
    const fedi = await start();
    for (const resource of ["acct:apps@potyro.example", "acct:Apps@Potyro.Example", ACTOR]) {
      const res = await fedi.handle(get(`/.well-known/webfinger?resource=${encodeURIComponent(resource)}`));
      expect(res.status, resource).toBe(200);
      expect(res.headers["content-type"]).toBe("application/jrd+json");
      expect(body(res).subject).toBe("acct:apps@potyro.example");
      expect(body(res).links[0]).toEqual({ rel: "self", type: "application/activity+json", href: ACTOR });
    }
  });

  it("webfinger says 404 for anyone else, and 400 when nobody is asked for", async () => {
    const fedi = await start();
    expect((await fedi.handle(get("/.well-known/webfinger?resource=acct:someone@potyro.example"))).status).toBe(404);
    expect((await fedi.handle(get("/.well-known/webfinger"))).status).toBe(400);
  });

  it("the actor is an automated account with its inbox, its outbox and the public half of its key", async () => {
    const res = await (await start()).handle(get("/fedi/actor"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/activity+json");
    const actor = body(res);
    expect(actor).toMatchObject({
      id: ACTOR,
      type: "Service",
      preferredUsername: "apps",
      inbox: "https://potyro.example/fedi/inbox",
      outbox: "https://potyro.example/fedi/outbox",
      url: "https://potyro.example/apps/",
      summary: "<p>Apps &amp; more</p>",
      icon: { type: "Image", mediaType: "image/png" },
      publicKey: { id: `${ACTOR}#main-key`, owner: ACTOR },
    });
    expect(actor.publicKey.publicKeyPem.trim()).toBe(KEYS.ours.publicKey.trim());
    expect(res.body).not.toContain("PRIVATE");
  });

  it("a person's browser is sent to the gallery's page", async () => {
    const fedi = await start();
    for (const path of ["/fedi/actor", "/fedi/notes/pantry"]) {
      const res = await fedi.handle(get(path, { headers: { accept: "text/html,application/xhtml+xml" } }));
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("https://potyro.example/apps/");
    }
  });

  it("refuses a profile whose addresses could not be kept", () => {
    expect(() => checkProfile({ ...PROFILE, origin: "http://potyro.example" })).toThrow(/origin/);
    expect(() => checkProfile({ ...PROFILE, origin: "https://potyro.example/x" })).toThrow(/origin/);
    expect(() => checkProfile({ ...PROFILE, username: "Apps Team" })).toThrow(/name/);
    expect(() => checkProfile({ ...PROFILE, assets: "https://potyro.example" })).toThrow(/pictures/);
  });
});

describe("what the account has posted", () => {
  it("an app is a public note in every language, with its two links and its picture", async () => {
    const res = await (await start()).handle(get("/fedi/notes/pantry"));
    expect(res.status).toBe(200);
    const note = body(res);
    expect(note).toMatchObject({
      id: "https://potyro.example/fedi/notes/pantry",
      type: "Note",
      attributedTo: ACTOR,
      to: ["https://www.w3.org/ns/activitystreams#Public"],
      cc: ["https://potyro.example/fedi/followers"],
      published: "2026-11-06T21:21:06.442Z",
    });
    expect(note.content).toBe(
      '<p><strong>Name of pantry</strong><br>A list &lt;for&gt; the house</p><p><a href="https://potyro.app/s/pantry#k=abc">Try it</a> · <a href="https://potyro.app/s/pantry#k=abc&amp;remix=1">Make it mine</a></p>',
    );
    expect(Object.keys(note.contentMap)).toEqual(["en", "pt-BR"]);
    expect(note.contentMap["pt-BR"]).toContain("Experimentar");
    expect(note.attachment).toEqual([{ type: "Document", mediaType: "image/webp", url: "https://potyro.example/shots/en/pantry-light-824.webp", name: "Name of pantry, as it opens", width: 824, height: 1648 }]);
  });

  it("the outbox lists every post as the Create that carried it, newest first", async () => {
    const out = body(await (await start()).handle(get("/fedi/outbox")));
    expect(out).toMatchObject({ type: "OrderedCollection", totalItems: 2 });
    expect(out.orderedItems.map((a: any) => [a.type, a.object.id])).toEqual([
      ["Create", "https://potyro.example/fedi/notes/piano"],
      ["Create", "https://potyro.example/fedi/notes/pantry"],
    ]);
    const one = body(await (await start()).handle(get("/fedi/notes/piano/activity")));
    expect(one).toMatchObject({ id: "https://potyro.example/fedi/notes/piano/activity", type: "Create", actor: ACTOR });
  });

  it("an app that left the gallery answers 410 with a tombstone; one that never was, 404", async () => {
    const fedi = await start();
    await fedi.sync(feed([app("piano", { publishedAt: "2026-11-20T10:00:00.000Z" })]));
    const gone = await fedi.handle(get("/fedi/notes/pantry"));
    expect(gone.status).toBe(410);
    expect(body(gone).type).toBe("Tombstone");
    expect((await fedi.handle(get("/fedi/notes/nothing"))).status).toBe(404);
    expect((await fedi.handle(get("/fedi/notes/constructor"))).status).toBe(404);
    expect((await fedi.handle(get("/fedi/notes/..%2Fx"))).status).toBe(404);
  });

  it("says how many follow, never who", async () => {
    const res = await (await start()).handle(get("/fedi/followers"));
    expect(body(res)).toMatchObject({ type: "OrderedCollection", totalItems: 0 });
    expect(body(res).orderedItems).toBeUndefined();
  });
});

describe("the edges", () => {
  it("answers 404 to what it does not have, 405 to anything but a POST at the inbox", async () => {
    const fedi = await start();
    expect((await fedi.handle(get("/fedi/secret"))).status).toBe(404);
    expect((await fedi.handle(get("/fedi/inbox"))).status).toBe(404);
    expect((await fedi.handle(get("/fedi/inbox", { method: "PUT" }))).status).toBe(405);
    expect((await fedi.handle(get("/fedi/actor", { method: "DELETE" }))).status).toBe(404);
    expect((await fedi.handle(get("/fedi/health"))).status).toBe(200);
  });

  it("holds one address to its requests a minute, an IPv6 /64 together, and leaves others alone", async () => {
    const fedi = await start({ requestsPerMinute: 2 });
    const from = (ip: string) => fedi.handle(get("/fedi/actor", { ip }));
    expect((await from("2001:db8:1:2::1")).status).toBe(200);
    expect((await from("2001:db8:1:2::2")).status).toBe(200);
    const third = await from("2001:db8:1:2::3");
    expect(third.status).toBe(429);
    expect(third.headers["retry-after"]).toBe("60");
    expect((await from("9.9.9.9")).status).toBe(200);
  });
});
