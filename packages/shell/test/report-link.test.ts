// Reporting a demo link, and a link the Potyro team took down (#11, docs/16 "Taking a link down").
import { afterEach, describe, expect, it, vi } from "vitest";
import contacts from "../src/contacts.json";
import { ABUSE_CONTACT, GENERAL_CONTACT, isPlaceholder, reportAddress, reportMailto } from "../src/contact.js";

const page = (href: string) => {
  const u = new URL(href);
  return { protocol: u.protocol, host: u.host, origin: u.origin, pathname: u.pathname };
};

describe("where a report goes", () => {
  it("reads the addresses from one file", () => {
    expect(ABUSE_CONTACT).toBe(contacts.abuse);
    expect(GENERAL_CONTACT).toBe(contacts.general);
  });

  it("goes to the general address while the abuse address is still a placeholder, and to it once filled in", () => {
    expect(isPlaceholder("<ABUSE EMAIL>")).toBe(true);
    expect(isPlaceholder(" <ABUSE EMAIL> ")).toBe(true);
    expect(isPlaceholder("abuse@potyro.app")).toBe(false);
    expect(reportAddress()).toBe(isPlaceholder(contacts.abuse) ? contacts.general : contacts.abuse);
    // Never a mailto nobody can send to.
    expect(reportAddress()).toMatch(/^[^<>\s]+@[^<>\s]+$/);
  });

  it("writes the subject and the start of the text into the mailto", () => {
    const link = reportMailto("A Potyro link", "The link: https://potyro.app/s/AbCdEfGhIjKlMnOpQrStUv\n\nWhy");
    expect(link.startsWith(`mailto:${reportAddress()}?subject=A%20Potyro%20link&body=`)).toBe(true);
    expect(decodeURIComponent(link.split("&body=")[1]!)).toBe("The link: https://potyro.app/s/AbCdEfGhIjKlMnOpQrStUv\n\nWhy");
  });
});

describe("a hosted link the team took down", () => {
  afterEach(() => vi.unstubAllGlobals());

  const answering = (status: number) => {
    vi.stubGlobal("location", page("https://potyro.app/s/AbCdEfGhIjKlMnOpQrStUv"));
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: false, code: "taken-down" }), { status }));
  };

  it("is told apart from one its sharer removed: 410 is taken down, 404 is gone", async () => {
    const { fetchHostedPackage, GoneError, TakenDownError } = await import("../src/share-service.js");
    answering(410);
    await expect(fetchHostedPackage("AbCdEfGhIjKlMnOpQrStUv", "k")).rejects.toBeInstanceOf(TakenDownError);
    answering(404);
    const gone = await fetchHostedPackage("AbCdEfGhIjKlMnOpQrStUv", "k").catch((e: unknown) => e);
    expect(gone).toBeInstanceOf(GoneError);
    expect(gone).not.toBeInstanceOf(TakenDownError);
  });
});
