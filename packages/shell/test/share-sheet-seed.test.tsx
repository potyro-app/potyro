// @vitest-environment happy-dom
//
// An app made in the Studio keeps the records its run passed on (#486), so the share sheet says its
// link opens on sample records; one with none (made before, or whose rows no longer fit) says empty.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ShareSheet } from "../src/share-sheet.js";
import type { UserApp } from "../src/user-apps.js";

vi.mock("../src/demo-share.js", () => ({ makeDemoLink: async () => ({ link: "https://potyro.app/#try=abc", hosted: false, samples: true }) }));

const studioApp = (seed?: UserApp["seed"]): UserApp => ({ id: "watering", name: "Watering", source: "export default {}", updatedAt: "2026-10-31T00:00:00.000Z", trusted: true, ...(seed ? { seed } : {}) });
const opensOn = (root: ParentNode) => root.querySelector("[data-share-opens]")?.getAttribute("data-share-opens");

afterEach(cleanup);

describe("the share sheet, for an app made in the Studio", () => {
  it("says sample records when it kept the ones its run passed on", () => {
    const { container } = render(<ShareSheet app={studioApp({ plant: [{ id: "p1", name: "name 1" }] })} onClose={() => {}} />);
    expect(opensOn(container)).toBe("samples");
    expect(container.textContent).toContain("with sample records");
  });

  it("says an empty copy when it has none", () => {
    const { container } = render(<ShareSheet app={studioApp()} onClose={() => {}} />);
    expect(opensOn(container)).toBe("empty");
  });
});
