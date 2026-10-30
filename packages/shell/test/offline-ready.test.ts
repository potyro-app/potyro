// When the page asks the worker for the rest of Potyro (#123, offline-ready.ts): automatically only
// on a connection known not to be metered, and what it tells the worker about itself.

import { beforeEach, describe, expect, it } from "vitest";
import { connectOffline, resetOfflineForTests, shouldWarmAutomatically, type ConnectionInfo } from "../src/offline-ready.js";

function fakeWorker() {
  const posted: unknown[] = [];
  let listener: ((event: MessageEvent) => void) | null = null;
  const container = { addEventListener: (_type: "message", l: (event: MessageEvent) => void) => void (listener = l), startMessages: () => {} };
  const reg = { active: { postMessage: (m: unknown) => void posted.push(m) } };
  return { container, reg, posted, say: (data: unknown, source: unknown = null) => listener!({ data, source } as unknown as MessageEvent) };
}

beforeEach(() => resetOfflineForTests());

describe("fetching 40 MB without asking", () => {
  it("only on Wi-Fi or a cable, with data saver off", () => {
    expect(shouldWarmAutomatically({ type: "wifi" })).toBe(true);
    expect(shouldWarmAutomatically({ type: "ethernet", saveData: false })).toBe(true);
    expect(shouldWarmAutomatically({ type: "wifi", saveData: true })).toBe(false);
    expect(shouldWarmAutomatically({ type: "cellular" })).toBe(false);
    // Chrome on a desktop, Safari and Firefox: nothing said about the connection type, so no.
    expect(shouldWarmAutomatically({ saveData: false })).toBe(false);
    expect(shouldWarmAutomatically(undefined)).toBe(false);
    expect(shouldWarmAutomatically(null)).toBe(false);
  });

  for (const [connection, warms] of [
    [{ type: "wifi" }, true],
    [{ type: "cellular" }, false],
    [undefined, false],
  ] as [ConnectionInfo | undefined, boolean][]) {
    it(`connecting on ${JSON.stringify(connection) ?? "an unknown connection"} ${warms ? "fetches" : "does not fetch"} the rest`, () => {
      const worker = fakeWorker();
      connectOffline(worker.container, worker.reg, "/assets/index-abc.js", connection);
      expect(worker.posted).toEqual([
        { type: "hello", entry: "/assets/index-abc.js" },
        { type: "status" },
        ...(warms ? [{ type: "warm" }] : []),
      ]);
    });
  }
});

describe("telling the worker which build this page runs", () => {
  it("answers a new worker's question to that worker", () => {
    const worker = fakeWorker();
    connectOffline(worker.container, worker.reg, "/assets/index-abc.js");
    const asker: unknown[] = [];
    worker.say({ type: "potyro-build?" }, { postMessage: (m: unknown) => void asker.push(m) });
    expect(asker).toEqual([{ type: "hello", entry: "/assets/index-abc.js" }]);
  });

  it("connects once per page load", () => {
    const worker = fakeWorker();
    connectOffline(worker.container, worker.reg, "/assets/index-abc.js", { type: "wifi" });
    connectOffline(worker.container, worker.reg, "/assets/index-abc.js", { type: "wifi" });
    expect(worker.posted.filter((m) => (m as { type: string }).type === "warm")).toHaveLength(1);
  });
});
