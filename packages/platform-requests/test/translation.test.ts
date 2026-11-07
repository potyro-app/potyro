// A better wording for Potyro's own words (#300), through the same relay as platform requests: a
// request of kind "translation", filed under its own label and grouped only with its own kind.

import { describe, expect, it } from "vitest";
import { createRelay, type Issue, type IssueTracker } from "../src/relay.ts";
import { REQUEST_FORMAT, issueBody, readPayload, type PlatformRequestPayload } from "../src/request.ts";

const wording = (over: Partial<PlatformRequestPayload> = {}): PlatformRequestPayload => ({
  format: REQUEST_FORMAT,
  kind: "translation",
  id: `req-${Math.random()}`,
  device: "dev-1",
  title: "Wording (pl): “Nic tu jeszcze nie ma.”",
  body: "Suggested: Jeszcze nic tu nie ma.\nNow: Nic tu jeszcze nie ma.\nEnglish: Nothing here yet.\nMessage: abc123",
  structure: "",
  language: "pl",
  ...over,
});

/** A tracker that keeps each issue's labels, so what is open under one label is not under another. */
function tracker(open: Array<Issue & { labels: string[] }> = []) {
  const issues = [...open];
  const created: Array<{ title: string; body: string; labels: string[] }> = [];
  const comments: Array<{ number: number; body: string }> = [];
  const t: IssueTracker = {
    listOpen: async (label) => issues.filter((i) => i.labels.includes(label)).map(({ labels: _l, ...i }) => i),
    create: async (issue) => {
      created.push(issue);
      const number = 200 + created.length;
      const made = { number, title: issue.title, url: `https://github.com/potyro-app/potyro/issues/${number}` };
      issues.push({ ...made, labels: issue.labels });
      return made;
    },
    comment: async (number, body) => void comments.push({ number, body }),
  };
  return { t, created, comments };
}

const post = (body: unknown) => ({ method: "POST", path: "/platform-requests", body: JSON.stringify(body), ip: "1.2.3.4" });

describe("a wording suggestion (#300)", () => {
  it("is read with its kind; a platform request has none", () => {
    const read = readPayload(wording());
    expect(read.ok && read.payload.kind).toBe("translation");
    const plain = readPayload({ ...wording(), kind: undefined });
    expect(plain.ok && "kind" in plain.payload).toBe(false);
  });

  it("refuses a kind it does not know", () => {
    expect(readPayload({ ...wording(), kind: "bug" })).toEqual({ ok: false, error: "kind must be translation" });
  });

  it("is filed under the translation label, and says what it is", async () => {
    const { t, created } = tracker();
    const res = await createRelay({ issues: t, now: () => 0 }).handle(post(wording()));
    expect(res.status).toBe(201);
    expect(created[0]!.labels).toEqual(["translation"]);
    expect(created[0]!.body).toContain("better wording for Potyro's own words");
    expect(created[0]!.body).toContain("> Suggested: Jeszcze nic tu nie ma.");
    expect(created[0]!.body).not.toContain("dev-1");
  });

  it("groups with the same suggestion, never with a platform request of the same title", async () => {
    const title = "Wording (pl): “Nic tu jeszcze nie ma.”";
    const { t, created, comments } = tracker([
      { number: 7, title, url: "u7", labels: ["platform-request"] },
      { number: 9, title, url: "u9", labels: ["translation"] },
    ]);
    const relay = createRelay({ issues: t, now: () => 0 });
    expect((await relay.handle(post(wording()))).body).toMatchObject({ grouped: true, issue: 9 });
    expect(comments[0]!.number).toBe(9);
    // A platform request with that title groups with the platform one.
    const platform = { ...wording(), kind: undefined, id: "req-p" };
    expect((await relay.handle(post(platform))).body).toMatchObject({ grouped: true, issue: 7 });
    expect(created).toHaveLength(0);
  });

  it("writes a comment that says someone else suggested it too", () => {
    expect(issueBody(wording(), { again: true })).toContain("Someone else suggested this too");
  });
});
