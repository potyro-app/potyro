// What an app someone else wrote can actually reach (KA-02, #2).
//
// The safety story is: untrusted code runs in the isolate AND its `ctx.caps` carries only what its
// manifest asked for, each behind a consent prompt, some of it scoped. Until now the only mediated
// capability with tests was haptics — the one that cannot leak anything. These cover the ones that
// can: the network allow-list, the filesystem, the camera, your location, and what happens to a
// refusal.

import { describe, expect, it, vi } from "vitest";
import { FakeCapabilities } from "@karta/capabilities";
import type { PermissionManifest } from "karta";
import type { UiBridge } from "../src/index.js";
import { mediateCaps } from "../src/index.js";

function setup(permissions: PermissionManifest, answer: boolean | (() => boolean) = true) {
  const asked: string[] = [];
  const ui: UiBridge = {
    toast: () => {},
    confirm: async (message) => {
      asked.push(message);
      return typeof answer === "function" ? answer() : answer;
    },
    prompt: async () => null,
    pick: async () => null,
  };
  // A fetch that answers, so a refusal is the permission's doing and not the fake being offline.
  const reached: string[] = [];
  const caps = new FakeCapabilities({ fetch: async (input) => (reached.push(String(input)), new Response("ok")) });
  return { asked, caps, ui, reached, mediated: mediateCaps({ caps, provenance: "untrusted", permissions, ui, appName: "Someone's App" }) };
}

describe("the network allow-list", () => {
  it("refuses every host when the manifest does not ask for the network", async () => {
    const { mediated, asked } = setup({});
    await expect(mediated.network!.fetch("https://example.test/x")).rejects.toThrow(/Permission denied/);
    expect(asked).toEqual([]); // refused outright: nobody is asked to allow what was never declared
  });

  it("allows only the declared hosts", async () => {
    const { mediated, reached } = setup({ network: { hosts: ["api.example.test"] } });
    await expect(mediated.network!.fetch("https://api.example.test/v1/rates")).resolves.toBeDefined();
    expect(reached).toEqual(["https://api.example.test/v1/rates"]); // and only that one reached the platform
    await expect(mediated.network!.fetch("https://evil.test/collect")).rejects.toThrow(/network/);
    // A host that merely CONTAINS the allowed one is a different host.
    await expect(mediated.network!.fetch("https://api.example.test.evil.test/x")).rejects.toThrow(/network/);
  });

  it("treats `true` (and an empty host list) as any host", async () => {
    const open = setup({ network: true });
    await expect(open.mediated.network!.fetch("https://anywhere.test/x")).resolves.toBeDefined();
    const empty = setup({ network: { hosts: [] } });
    await expect(empty.mediated.network!.fetch("https://anywhere.test/x")).resolves.toBeDefined();
  });

  it("asks before the first request and not again after a yes", async () => {
    const { mediated, asked } = setup({ network: true });
    await mediated.network!.fetch("https://a.test/1");
    await mediated.network!.fetch("https://a.test/2");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Someone's App");
    expect(asked[0]).toContain("network");
  });
});

describe("the filesystem", () => {
  it("is denied without the manifest, and asked for with it", async () => {
    const denied = setup({});
    await expect(denied.mediated.filesystem!.pick()).rejects.toThrow(/Permission denied/);
    await expect(denied.mediated.filesystem!.save("x.txt", new Blob(["x"]))).rejects.toThrow(/Permission denied/);

    const granted = setup({ filesystem: true });
    await expect(granted.mediated.filesystem!.pick()).resolves.toBeDefined();
    expect(granted.asked[0]).toContain("files");
  });

  it("scopes what an untrusted app writes to its own name", async () => {
    // Otherwise a shared app could overwrite a file belonging to another app — or to the person.
    const { mediated, caps } = setup({ filesystem: true });
    await mediated.filesystem!.save("notes.txt", new Blob(["x"]));
    expect([...caps.savedFiles().keys()]).toEqual(["Someone's App/notes.txt"]);
  });
});

describe("the camera and your location", () => {
  it("are absent unless the manifest asks", () => {
    const { mediated } = setup({});
    expect(mediated.camera).toBeUndefined();
    expect(mediated.geo).toBeUndefined();
  });

  it("ask the first time they are used", async () => {
    const { mediated, asked } = setup({ camera: true, geo: true });
    await mediated.camera!.capture();
    await mediated.geo!.current();
    expect(asked).toHaveLength(2);
    expect(asked.some((m) => m.includes("the camera"))).toBe(true);
    expect(asked.some((m) => m.includes("your location"))).toBe(true);
  });
});

describe("a refusal", () => {
  it("fails the call, and is remembered rather than asked again", async () => {
    // Being asked over and over is how people click yes to make a prompt go away.
    const ask = vi.fn(async () => false);
    const caps = new FakeCapabilities();
    const ui: UiBridge = { toast: () => {}, confirm: ask, prompt: async () => null, pick: async () => null };
    const mediated = mediateCaps({ caps, provenance: "untrusted", permissions: { camera: true }, ui, appName: "X" });

    await expect(mediated.camera!.capture()).rejects.toThrow(/Permission denied/);
    await expect(mediated.camera!.capture()).rejects.toThrow(/Permission denied/);
    expect(ask).toHaveBeenCalledOnce();
    expect(caps.savedFiles().size).toBe(0);
  });

  it("does not leak into another capability's decision", async () => {
    let allow = false;
    const { mediated } = setup({ camera: true, geo: true }, () => allow);
    await expect(mediated.camera!.capture()).rejects.toThrow(/Permission denied/);
    allow = true;
    await expect(mediated.geo!.current()).resolves.toBeDefined();
  });
});

describe("a trusted app", () => {
  it("gets everything the platform has, with nothing to answer", async () => {
    const caps = new FakeCapabilities({ fetch: async () => new Response("ok") });
    const asked: string[] = [];
    const ui: UiBridge = { toast: () => {}, confirm: async (m) => (asked.push(m), true), prompt: async () => null, pick: async () => null };
    const full = mediateCaps({ caps, provenance: "trusted", permissions: {}, ui, appName: "Mine" });

    await full.camera!.capture();
    await full.geo!.current();
    await full.network!.fetch("https://anywhere.test/x");
    await full.filesystem!.save("notes.txt", new Blob(["x"]));

    expect(asked).toEqual([]);
    expect([...caps.savedFiles().keys()]).toEqual(["notes.txt"]); // unscoped: it is your own app
  });
});
