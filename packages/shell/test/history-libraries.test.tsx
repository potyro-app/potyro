// @vitest-environment happy-dom
//
// A library upgrade in History (#266): the source can be the same line for line while the code that
// runs is not — `chart.js@4.4.0` became `chart.js@4.4.1`, or the bytes behind a URL changed. The
// version shows what changed as a diff of lock.json, and restoring it puts that lock back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryStore } from "@potyro/store";

vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string) => {
    const store = new MemoryStore();
    await store.open(namespace);
    return store;
  },
}));
// Highlighting loads a grammar; the diff falls back to plain text without it, which is all this needs.
vi.mock("../src/highlight.js", () => ({ highlightLines: async () => [] }));

const { resetHistoryStore } = await import("../src/app-history.js");
const { saveUserApp, getUserApp } = await import("../src/user-apps.js");
const { History } = await import("../src/history.js");

const entry = (hex: string, size: number) => ({ file: `.modules/${hex.repeat(64)}.js`, integrity: `sha256-${hex}=`, size });
const OLD = { "https://esm.sh/chart.js@4.4.0?bundle": entry("a", 100) };
const NEW = { "https://esm.sh/chart.js@4.4.1?bundle": entry("b", 120) };

beforeEach(() => {
  localStorage.clear();
  resetHistoryStore();
});
afterEach(cleanup);

describe("History of an app with libraries", () => {
  it("shows a library upgrade as a version with a diff of lock.json", async () => {
    const app = await saveUserApp({ name: "Chart", source: "same source", lock: OLD }, "2026-10-01T00:00:00Z");
    await saveUserApp({ id: app.id, name: "Chart", source: "same source", lock: NEW, origin: "imported", note: "Updated from a file · chart.js 4.4.1 (was 4.4.0)" }, "2026-10-02T00:00:00Z");

    render(<History appId={app.id} appName="Chart" onClose={() => {}} embedded />);
    fireEvent.click(await screen.findByText("Updated from a file · chart.js 4.4.1 (was 4.4.0)"));

    const detail = screen.getByRole("region", { name: "Changes in version 2" });
    expect(detail.textContent).toContain("lock.json");
    const removed = [...detail.querySelectorAll(".k-diff-del")].map((l) => l.textContent);
    const added = [...detail.querySelectorAll(".k-diff-add")].map((l) => l.textContent);
    expect(removed.join("\n")).toContain("chart.js@4.4.0");
    expect(added.join("\n")).toContain("chart.js@4.4.1");
    expect(detail.textContent).not.toContain("No changes between these two versions");
  });

  it("restoring the older version puts its libraries back", async () => {
    const app = await saveUserApp({ name: "Chart", source: "same source", lock: OLD }, "2026-10-01T00:00:00Z");
    await saveUserApp({ id: app.id, name: "Chart", source: "same source", lock: NEW, note: "upgrade" }, "2026-10-02T00:00:00Z");
    const restored = vi.fn();

    render(<History appId={app.id} appName="Chart" onClose={() => {}} onRestored={restored} embedded />);
    const rows = await screen.findAllByRole("button", { expanded: false });
    fireEvent.click(rows[rows.length - 1]!); // the oldest
    fireEvent.click(screen.getByRole("button", { name: "Restore v1" }));

    await waitFor(() => expect(restored).toHaveBeenCalled());
    // The older library is the one the restored source runs; the newer stays beside it (`lockToRestore`).
    expect(getUserApp(app.id)!.lock).toEqual({ ...NEW, ...OLD });
  });
});
