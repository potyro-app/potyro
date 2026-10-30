// @vitest-environment happy-dom
//
// The privacy page and the terms, linked from the app (#117) — only by a build that has them, and at
// sections the page really has.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { DialogHost, Dialogs } from "../src/dialog.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGAL_DIR } from "../../legal/src/build.mjs";
import { renderMarkdown } from "../../legal/src/markdown.mjs";
import { LegalLink, LegalLinks, PRIVACY_SECTIONS, legalHref } from "../src/legal-links.js";
import type { Site } from "../src/site.js";

const site: Site = { origin: "https://potyro.app", host: "potyro.app", path: "/", secure: true, configured: false };

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("where the links go", () => {
  it("nowhere until the build has the pages", () => {
    expect(legalHref("privacy", undefined, { built: undefined, site })).toBeNull();
    expect(legalHref("privacy", undefined, { built: "", site })).toBeNull();
    // A native build that was not told its site has no page to point at either.
    expect(legalHref("privacy", undefined, { built: "1", site: null })).toBeNull();
  });

  it("to this site's pages, and to a section of the privacy page", () => {
    expect(legalHref("privacy", undefined, { built: "1", site })).toBe("https://potyro.app/privacy");
    expect(legalHref("terms", undefined, { built: "1", site })).toBe("https://potyro.app/terms");
    expect(legalHref("privacy", "voice", { built: "1", site })).toBe("https://potyro.app/privacy#voice");
    // A site served under a path keeps it; the terms have no sections.
    expect(legalHref("terms", "voice", { built: "1", site: { ...site, path: "/potyro/" } })).toBe("https://potyro.app/potyro/terms");
  });

  it("every section the app links is a heading of docs/legal/privacy.md", () => {
    const ids = renderMarkdown(readFileSync(join(LEGAL_DIR, "privacy.md"), "utf8")).headings.map((h) => h.id);
    for (const [section, id] of Object.entries(PRIVACY_SECTIONS)) expect(ids, `${section} → #${id}`).toContain(id);
  });
});

describe("the links", () => {
  it("render nothing in a build without the pages", () => {
    vi.stubEnv("VITE_POTYRO_LEGAL", "");
    const { container } = render(
      <>
        <LegalLinks />
        <LegalLink section="links" block>
          What a link makes public
        </LegalLink>
      </>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("open the page beside Potyro in a build with them", () => {
    vi.stubEnv("VITE_POTYRO_LEGAL", "1");
    const { container } = render(
      <>
        <LegalLinks />
        <LegalLink section="links" block>
          What a link makes public
        </LegalLink>
      </>,
    );
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => [a.textContent, new URL(a.href).pathname + new URL(a.href).hash, a.target, a.rel])).toEqual([
      ["Privacy", "/privacy", "_blank", "noopener"],
      ["Terms of use", "/terms", "_blank", "noopener"],
      ["What a link makes public", "/privacy#links-anyone-can-try", "_blank", "noopener"],
    ]);
    expect(container.querySelector("p.k-legal-note > a")).not.toBeNull();
  });
});

describe("the platform's questions", () => {
  it("link the section they are about, under their words, when the build has the page", async () => {
    vi.stubEnv("VITE_POTYRO_LEGAL", "1");
    const host = new DialogHost();
    const { container } = render(<Dialogs host={host} />);
    void act(() => void host.confirm("May it send a photo?", { detail: "Only this photo.", privacy: "ai" }));
    await vi.waitFor(() => expect(container.querySelector(".k-dialog")).not.toBeNull());
    const link = container.querySelector<HTMLAnchorElement>(".k-dialog .k-legal-link");
    expect(link?.textContent).toBe("Where AI requests go, and what is kept");
    expect(link?.getAttribute("href")).toMatch(/\/privacy#ai-inside-apps-and-the-free-allowance$/);
    // A question with no topic has no link.
    void act(() => void host.confirm("Delete it?"));
    await vi.waitFor(() => expect(container.querySelector(".k-dialog-message")?.textContent).toBe("Delete it?"));
    expect(container.querySelector(".k-dialog .k-legal-link")).toBeNull();
  });
});
