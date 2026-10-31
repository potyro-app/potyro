// @vitest-environment happy-dom
//
// The share sheet says whether a link anyone can try opens on sample records (#486): at first from the
// seed kept beside the app, then from what of it fits the app as it is now — a version none of whose
// rows fit opens on an empty copy, and the sheet says so before the link is made.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ShareSheet } from "../src/share-sheet.js";
import type { UserApp } from "../src/user-apps.js";

vi.mock("../src/demo-share.js", () => ({ makeDemoLink: async () => ({ link: "https://potyro.app/#try=abc", hosted: false, samples: true }) }));
const fit = vi.hoisted(() => ({ value: true }));
vi.mock("../src/demo-package.js", () => ({ linkHasSamples: async () => fit.value }));

const studioApp = (seed?: UserApp["seed"]): UserApp => ({ id: "watering", name: "Watering", source: "export default {}", updatedAt: "2026-10-31T00:00:00.000Z", trusted: true, ...(seed ? { seed } : {}) });
const opensOn = (root: ParentNode) => root.querySelector("[data-share-opens]")?.getAttribute("data-share-opens");
const SEED = { plant: [{ id: "plant-1", name: "Monstera by the window" }, { id: "plant-2", name: "Lemon tree" }] };

afterEach(cleanup);

describe("the share sheet, for an app made in the Studio", () => {
  it("says sample records when its kept ones fit the app", async () => {
    fit.value = true;
    const { container } = render(<ShareSheet app={studioApp(SEED)} onClose={() => {}} />);
    expect(opensOn(container)).toBe("samples");
    await new Promise((r) => setTimeout(r, 20));
    expect(opensOn(container)).toBe("samples");
    expect(container.textContent).toContain("with sample records");
  });

  it("says an empty copy once it knows none of them fits the app as it is now", async () => {
    fit.value = false;
    const { container } = render(<ShareSheet app={studioApp(SEED)} onClose={() => {}} />);
    await waitFor(() => expect(opensOn(container)).toBe("empty"));
    expect(container.textContent).toContain("an empty copy of the app");
  });

  it("says an empty copy when it has none", () => {
    const { container } = render(<ShareSheet app={studioApp()} onClose={() => {}} />);
    expect(opensOn(container)).toBe("empty");
  });
});
