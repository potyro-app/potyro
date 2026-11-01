// @vitest-environment happy-dom
//
// The share sheet's "A link anyone can try" says what the link opens on (docs/24 §3): sample records
// when the app has some — its own seeder, or the seed its package came with — and an empty copy of it
// when it has none, as an app made in the Studio does. Never "with sample records" for an app that has
// none.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ShareSheet, hasSampleRecords } from "../src/share-sheet.js";
import type { UserApp } from "../src/user-apps.js";

const made = vi.hoisted(() => ({ samples: true }));
vi.mock("../src/demo-share.js", () => ({
  makeDemoLink: async () => ({ link: "https://potyro.app/#demo=abc", hosted: false, samples: made.samples }),
}));

const WITH = "It opens the app right away in any browser, with sample records. No account, nothing to install. None of your records go with it.";
const EMPTY = "It opens an empty copy of the app right away in any browser. No account, nothing to install. Your records stay with you.";

const app = (over: Partial<UserApp>): UserApp => ({ id: "watering", name: "Watering", source: "export default {}", updatedAt: "2026-10-31T00:00:00.000Z", trusted: true, ...over });
const sentence = (root: ParentNode) => root.querySelector(".k-share-way-try > p.k-muted")?.textContent;

afterEach(() => {
  cleanup();
  localStorage.clear();
  made.samples = true;
});

describe("whether a demo link opens on sample records", () => {
  it("an example with a seeder of its own does", () => {
    expect(hasSampleRecords(app({ id: "groceries" }))).toBe(true);
  });

  it("an app from a package does, on the seed it came with, when the seed has rows", () => {
    expect(hasSampleRecords(app({ seed: { plant: [{ name: "Monstera" }] } }))).toBe(true);
    expect(hasSampleRecords(app({ seed: { plant: [] } }))).toBe(false);
  });

  it("an app made in the Studio does not", () => {
    expect(hasSampleRecords(app({}))).toBe(false);
  });
});

describe("the sheet's sentence", () => {
  it("says sample records for an app that has them", () => {
    const { container } = render(<ShareSheet app={app({ id: "groceries", name: "Groceries" })} onClose={() => {}} />);
    expect(sentence(container)).toBe(WITH);
  });

  it("says an empty copy for an app made in the Studio, never sample records", () => {
    const { container } = render(<ShareSheet app={app({})} onClose={() => {}} />);
    expect(sentence(container)).toBe(EMPTY);
    expect(container.textContent).not.toMatch(/sample records/);
  });

  it("follows the link once it is made: one that had to leave its records out opens empty", async () => {
    made.samples = false;
    const view = render(<ShareSheet app={app({ id: "groceries", name: "Groceries" })} onClose={() => {}} />);
    expect(sentence(view.container)).toBe(WITH);
    fireEvent.click(view.getByRole("button", { name: "Make the link" }));
    await vi.waitFor(() => expect(view.container.querySelector(".k-share-way-try input")).not.toBeNull());
    expect(sentence(view.container)).toBe(EMPTY);
  });
});
