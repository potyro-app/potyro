// The header's relay probe is let go without a console error (Firefox): a probe still opening is
// never `close()`d — Firefox logs "can't establish a connection" and "interrupted while the page was
// loading" for that — it is closed the moment it opens instead.

import { describe, expect, it } from "vitest";
import { dropProbe } from "../src/sync-status.js";

const probe = (readyState: number) => {
  const closes: number[] = [];
  const ws = { readyState, onopen: (() => {}) as null | (() => void), onerror: (() => {}) as null | (() => void), close: () => void closes.push(1) };
  return { ws, closes };
};

describe("dropProbe", () => {
  it("does not close a probe still opening; it closes it once it opens", () => {
    const { ws, closes } = probe(0);
    dropProbe(ws as unknown as WebSocket);
    expect(closes).toHaveLength(0);
    expect(ws.onerror).toBeNull();
    ws.onopen?.();
    expect(closes).toHaveLength(1);
  });

  it("closes an open probe at once", () => {
    const { ws, closes } = probe(1);
    dropProbe(ws as unknown as WebSocket);
    expect(closes).toHaveLength(1);
    expect(ws.onopen).toBeNull();
  });
});
