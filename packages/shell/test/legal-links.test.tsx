// @vitest-environment happy-dom
//
// The privacy page and the terms, linked from the app (#117) — only by a build that has them, and at
// sections the page really has.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { DialogHost, Dialogs, shellDialogs } from "../src/dialog.js";
import { BackupSwitch } from "../src/backup-switch.js";
import { ShareSheet } from "../src/share-sheet.js";
import { RELAY_KEY } from "../src/open-store.js";
import type { UserApp } from "../src/user-apps.js";
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
  localStorage.clear();
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

describe("on a relay of the person's own", () => {
  const app: UserApp = { id: "groceries", name: "Groceries", source: "export default {}", updatedAt: "2026-10-30T00:00:00.000Z", trusted: true };
  const serverLinks = (root: ParentNode) => [...root.querySelectorAll<HTMLAnchorElement>(".k-legal-link")].map((a) => a.textContent).filter((t) => /Potyro’s server/.test(t ?? ""));

  async function backupQuestion() {
    const view = render(
      <>
        <BackupSwitch />
        <Dialogs host={shellDialogs} />
      </>,
    );
    fireEvent.click(view.getByRole("button", { name: "Back up my apps" }));
    await vi.waitFor(() => expect(view.container.querySelector(".k-dialog")).not.toBeNull());
    const question = view.container.querySelector(".k-dialog")!;
    const shown = { detail: question.querySelector(".k-dialog-detail")?.textContent, links: serverLinks(view.container) };
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    return shown;
  }

  it("the backup switch and its question say Potyro's server only when it is Potyro's", async () => {
    vi.stubEnv("VITE_POTYRO_LEGAL", "1");
    expect(await backupQuestion()).toEqual({
      detail: "What is in your apps is encrypted on this device, so Potyro’s server cannot read it. Your name and who you share with can be seen there.",
      links: ["What backup keeps on Potyro’s server", "What Potyro’s server keeps"],
    });
    cleanup();
    localStorage.setItem(RELAY_KEY, "wss://relay.example.org/sync");
    expect(await backupQuestion()).toEqual({
      detail: "What is in your apps is encrypted on this device, so the server you chose cannot read it. Your name and who you share with can be seen there.",
      links: [],
    });
  });

  it("the share sheet links what sharing keeps on Potyro's server only when sharing goes there", () => {
    vi.stubEnv("VITE_POTYRO_LEGAL", "1");
    const sheet = () => render(<ShareSheet app={app} onClose={() => {}} />).container;
    expect(serverLinks(sheet())).toEqual(["What sharing keeps on Potyro’s server"]);
    cleanup();
    localStorage.setItem(RELAY_KEY, "wss://relay.example.org/sync");
    const own = sheet();
    expect(serverLinks(own)).toEqual([]);
    // The link about what a demo link makes public stays: that is Potyro's either way.
    expect(own.querySelector('.k-legal-link[data-section="links"]')).not.toBeNull();
  });
});
