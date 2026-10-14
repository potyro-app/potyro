import { describe, expect, it } from "vitest";
import { createRelay, type IssueTracker } from "../src/relay.ts";
import { REQUEST_FORMAT, type PlatformRequestPayload } from "../src/request.ts";

const payload = (over: Partial<PlatformRequestPayload> = {}): PlatformRequestPayload => ({
  format: REQUEST_FORMAT,
  id: `req-${Math.random()}`,
  device: "dev-1",
  title: "Scan barcodes",
  body: "I wanted to scan the barcode on a pot.",
  structure: "{}",
  language: "en",
  ...over,
});

function tracker(open: Array<{ number: number; title: string }> = []) {
  const issues = open.map((i) => ({ ...i, url: `https://github.com/fuzue/potyro/issues/${i.number}` }));
  const created: Array<{ title: string; body: string; labels: string[] }> = [];
  const comments: Array<{ number: number; body: string }> = [];
  let lists = 0;
  const t: IssueTracker = {
    listOpen: async () => (lists++, issues.map((i) => ({ ...i }))),
    create: async (issue) => {
      created.push(issue);
      const number = 100 + created.length;
      const made = { number, title: issue.title, url: `https://github.com/fuzue/potyro/issues/${number}` };
      issues.push(made);
      return made;
    },
    comment: async (number, body) => void comments.push({ number, body }),
  };
  return { t, created, comments, lists: () => lists };
}

const post = (body: unknown, ip = "1.2.3.4") => ({ method: "POST", path: "/platform-requests", body: JSON.stringify(body), ip });

describe("the relay (#263)", () => {
  it("files a request as an issue labelled platform-request", async () => {
    const { t, created } = tracker();
    const relay = createRelay({ issues: t, now: () => 0 });
    const res = await relay.handle(post(payload()));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, grouped: false, issue: 101 });
    expect(created[0]!.labels).toEqual(["platform-request"]);
    expect(created[0]!.title).toBe("Scan barcodes");
  });

  it("groups a duplicate onto the open issue, as a comment", async () => {
    const { t, created, comments } = tracker([{ number: 7, title: "scan a barcode" }]);
    const relay = createRelay({ issues: t, now: () => 0 });
    const res = await relay.handle(post(payload({ title: "Scan barcodes!" })));
    expect(res.body).toMatchObject({ ok: true, grouped: true, issue: 7 });
    expect(created).toHaveLength(0);
    expect(comments[0]!.number).toBe(7);
    expect(comments[0]!.body).toContain("> I wanted to scan");
  });

  it("the same request sent twice (a retry) is filed once", async () => {
    const { t, created, comments } = tracker();
    const relay = createRelay({ issues: t, now: () => 0 });
    const p = payload();
    await relay.handle(post(p));
    const again = await relay.handle(post(p));
    expect(again.body).toMatchObject({ ok: true, issue: 101 });
    expect(created).toHaveLength(1);
    expect(comments).toHaveLength(0);
  });

  it("rate-limits per device, then lets it through again later", async () => {
    let now = 0;
    const { t } = tracker();
    const relay = createRelay({ issues: t, now: () => now, limits: { perDevice: 2, perAddress: 100, windowMs: 1000 } });
    expect((await relay.handle(post(payload({ title: "a one" })))).status).toBe(201);
    expect((await relay.handle(post(payload({ title: "b two" })))).status).toBe(201);
    const third = await relay.handle(post(payload({ title: "c three" })));
    expect(third.status).toBe(429);
    expect(third.body).toMatchObject({ ok: false });
    // Another device is not held back by this one.
    expect((await relay.handle(post(payload({ title: "d four", device: "dev-2" })))).status).toBe(201);
    now = 1001;
    expect((await relay.handle(post(payload({ title: "e five" })))).status).toBe(201);
  });

  it("rate-limits per address too: new device ids do not get around it", async () => {
    const { t } = tracker();
    const relay = createRelay({ issues: t, now: () => 0, limits: { perDevice: 100, perAddress: 2, windowMs: 1000 } });
    await relay.handle(post(payload({ device: "a", title: "x one" })));
    await relay.handle(post(payload({ device: "b", title: "x two" })));
    expect((await relay.handle(post(payload({ device: "c", title: "x three" })))).status).toBe(429);
  });

  it("refuses what is too big before reading it, and what is not a request", async () => {
    const { t, created } = tracker();
    const relay = createRelay({ issues: t, now: () => 0 });
    expect((await relay.handle({ method: "POST", path: "/platform-requests", body: "x".repeat(70_000), ip: "1" })).status).toBe(413);
    expect((await relay.handle({ method: "POST", path: "/platform-requests", body: "not json", ip: "1" })).status).toBe(400);
    expect((await relay.handle(post({ hello: 1 }))).status).toBe(400);
    expect(created).toHaveLength(0);
  });

  it("says when GitHub cannot be reached, so the client keeps it to send later", async () => {
    const { t } = tracker();
    const relay = createRelay({ issues: { ...t, create: async () => Promise.reject(new Error("502")) }, now: () => 0 });
    const res = await relay.handle(post(payload()));
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ ok: false });
  });

  it("answers health and nothing else", async () => {
    const relay = createRelay({ issues: tracker().t, now: () => 0 });
    expect((await relay.handle({ method: "GET", path: "/health", body: "", ip: "1" })).status).toBe(200);
    expect((await relay.handle({ method: "GET", path: "/platform-requests", body: "", ip: "1" })).status).toBe(405);
    expect((await relay.handle({ method: "POST", path: "/elsewhere", body: "{}", ip: "1" })).status).toBe(404);
  });

  it("reads the open issues once, then keeps its own index", async () => {
    const { t, lists } = tracker([{ number: 7, title: "scan a barcode" }]);
    const relay = createRelay({ issues: t, now: () => 0 });
    await relay.handle(post(payload({ title: "one thing" })));
    await relay.handle(post(payload({ title: "one thing again" })));
    await relay.handle(post(payload({ title: "another thing" })));
    expect(lists()).toBe(1);
  });
});
