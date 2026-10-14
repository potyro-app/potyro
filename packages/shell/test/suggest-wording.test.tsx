// @vitest-environment happy-dom
//
// You → Language → "Something reads wrong? Suggest a better wording" (#300): the person picks words
// from the screen (or finds them), writes theirs, and only Send sends — saved on this device while
// the team cannot be reached.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { resetI18nForTests, setLocale } from "@potyro/i18n";
import { SuggestWording } from "../src/suggest-wording.js";
import { savedRequests } from "../src/platform-requests.js";

const calls: Array<{ url: string; body: string }> = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      throw new TypeError("Failed to fetch"); // the relay is not deployed
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  resetI18nForTests();
});

/** A screen behind the panel, with one of Potyro's own messages and one of an app's words. */
function withScreen(): void {
  render(
    <>
      <main>
        <p className="k-empty">Jeszcze nic tu nie ma.</p>
        <h1>Moje rośliny</h1>
      </main>
      <SuggestWording />
    </>,
  );
}

describe("suggest a better wording", () => {
  it("offers Potyro's words on the screen, and sends nothing before Send", async () => {
    await setLocale("pl");
    withScreen();
    fireEvent.click(screen.getByRole("button", { name: /Suggest a better wording|lepsze sformułowanie/ }));
    const pick = await screen.findByRole("button", { name: "Jeszcze nic tu nie ma." });
    expect(screen.queryByRole("button", { name: "Moje rośliny" })).toBeNull(); // an app's words are not Potyro's
    fireEvent.click(pick);
    const box = screen.getByRole("textbox");
    expect((box as HTMLTextAreaElement).value).toBe("Jeszcze nic tu nie ma.");
    expect(screen.getByText(/Nothing here yet\./)).toBeTruthy(); // its English, for comparison
    expect(calls).toEqual([]);

    fireEvent.change(box, { target: { value: "Na razie nic tu nie ma." } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(sent).toMatchObject({ kind: "translation", language: "pl", structure: "" });
    expect(String(sent.body)).toContain("Suggested: Na razie nic tu nie ma.");
    // The relay is away: kept on this device, to send later.
    expect(savedRequests().map((s) => s.payload.kind)).toEqual(["translation"]);
  });

  it("finds any of Potyro's words by what they say now, or in English", async () => {
    withScreen();
    fireEvent.click(screen.getByRole("button", { name: /Suggest a better wording/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "this can't be undone" } });
    expect(await screen.findByRole("button", { name: "This can't be undone." })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz-nothing" } });
    expect(await screen.findByText("None of Potyro's words match that.")).toBeTruthy();
  });

  it("will not send the words unchanged", async () => {
    withScreen();
    fireEvent.click(screen.getByRole("button", { name: /Suggest a better wording/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "this can't be undone" } });
    fireEvent.click(await screen.findByRole("button", { name: "This can't be undone." }));
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
