// @vitest-environment happy-dom
//
// "Suggest a better wording" (#300), the shell's half: exactly what is sent for one message, the
// same outbox as platform requests until the relay is deployed, and the screen's text as the
// catalog matcher reads it.

import { beforeEach, describe, expect, it } from "vitest";
import { REQUEST_FORMAT } from "@potyro/platform-requests";
import type { CatalogMessage } from "@potyro/i18n";
import { deviceId, savedRequests, sendSaved } from "../src/platform-requests.js";
import { screenTexts, sendWording, wordingRequest } from "../src/wording-suggestions.js";

const message: CatalogMessage = { id: "x7Kq2a", text: "Nic tu jeszcze nie ma.", english: "Nothing here yet.", pattern: "Nic tu jeszcze nie ma." };
const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const away = (async () => {
  throw new TypeError("Failed to fetch");
}) as unknown as typeof fetch;

beforeEach(() => globalThis.localStorage.clear());

describe("what is sent", () => {
  it("the wording, the words it replaces, their English and the message's id — under the translation kind", () => {
    const p = wordingRequest(message, "  Jeszcze nic tu nie ma. ", "pl");
    expect(p).toEqual({
      format: REQUEST_FORMAT,
      kind: "translation",
      id: expect.stringMatching(/^req-/),
      device: deviceId(),
      title: "Wording (pl): “Nic tu jeszcze nie ma.”",
      body: "Suggested: Jeszcze nic tu nie ma.\nNow: Nic tu jeszcze nie ma.\nEnglish: Nothing here yet.\nMessage: x7Kq2a",
      structure: "",
      language: "pl",
    });
  });

  it("keeps a long message's title within what the relay takes", () => {
    const long = { ...message, text: "Słowo ".repeat(60) };
    expect(wordingRequest(long, "Krócej", "pl").title.length).toBeLessThanOrEqual(120);
  });
});

describe("sending", () => {
  it("saved on this device while the relay cannot be reached, and sent later", async () => {
    expect(await sendWording(wordingRequest(message, "Jeszcze nic tu nie ma.", "pl"), { fetch: away })).toEqual({ state: "saved" });
    expect(savedRequests()).toHaveLength(1);
    const sent: string[] = [];
    await sendSaved((_chat, p) => void sent.push(p.kind ?? "platform"), { fetch: answer(201, { ok: true, url: "u" }), only: (p) => p.kind === "translation" });
    expect(sent).toEqual(["translation"]);
    expect(savedRequests()).toEqual([]);
  });

  it("two retries at once send each kept one once", async () => {
    await sendWording(wordingRequest(message, "Na razie nic tu nie ma.", "pl"), { fetch: away });
    let posts = 0;
    const counting = (async () => {
      posts++;
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }) as unknown as typeof fetch;
    await Promise.all([sendSaved(() => {}, { fetch: counting }), sendSaved(() => {}, { fetch: counting })]);
    expect(posts).toBe(1);
    expect(savedRequests()).toEqual([]);
  });

  it("the Studio's retry leaves a suggestion alone, and a suggestion's leaves a platform request", async () => {
    await sendWording(wordingRequest(message, "Jeszcze nic tu nie ma.", "pl"), { fetch: away });
    await sendSaved(() => {}, { fetch: answer(201, { ok: true }), only: (p) => !p.kind });
    expect(savedRequests()).toHaveLength(1);
  });
});

describe("screenTexts", () => {
  it("reads each element's words, labels and placeholders, and nothing under the part it is told to skip", () => {
    document.body.innerHTML = `
      <main><p class="k-empty">Nic tu jeszcze <b>nie</b> ma.</p>
        <button aria-label="Zamknij">✕</button><input placeholder="Szukaj aplikacji" /></main>
      <section id="skip"><p>Twoje sformułowanie</p></section>`;
    const texts = screenTexts(document.body, document.getElementById("skip"));
    expect(texts).toContain("Nic tu jeszcze nie ma.");
    expect(texts).toContain("Zamknij");
    expect(texts).toContain("Szukaj aplikacji");
    expect(texts).not.toContain("Twoje sformułowanie");
    // What is seen comes before what is only heard.
    expect(texts.indexOf("Szukaj aplikacji")).toBeLessThan(texts.indexOf("Zamknij"));
  });

  it("puts the screen behind the panel before the panel's own words", () => {
    document.body.innerHTML = `<div role="dialog" id="you"><h2>Ty</h2></div><main><p>Znajdź aplikację</p></main>`;
    expect(screenTexts(document.body, null, document.getElementById("you"))).toEqual(["Znajdź aplikację", "Ty"]);
  });

  it("says the words as the screen showed them, placeholder filled in", () => {
    const seen = { ...message, text: "Usunąć …?", seen: "Usunąć Monstera?" };
    const p = wordingRequest(seen, "Czy usunąć Monstera?", "pl");
    expect(p.title).toBe("Wording (pl): “Usunąć Monstera?”");
    expect(p.body).toContain("Now: Usunąć Monstera?");
  });
});
