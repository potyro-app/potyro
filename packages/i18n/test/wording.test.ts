// "Suggest a better wording" (#300): Potyro's own messages as a person reads them, which of them a
// screen shows, and finding one by what it says.

import { afterEach, describe, expect, it } from "vitest";
import { catalogMessages, findMessages, messageText, messagesShown, type CatalogMessage } from "../src/wording.js";
import { resetI18nForTests, setLocale } from "../src/i18n.js";

afterEach(() => resetI18nForTests());

describe("messageText", () => {
  it("reads a compiled message as text, a placeholder as …", () => {
    expect(messageText("Nothing here yet.")).toBe("Nothing here yet.");
    expect(messageText(["Delete ", ["label"], "?"])).toBe("Delete …?");
    expect(messageText(["<0>Edit</0> the app"])).toBe("Edit the app");
  });

  it("reads a plural as its other arm", () => {
    expect(messageText([["n", "plural", { one: ["#", " plant"], other: ["#", " plants"] }]])).toBe("… plants");
  });
});

const messages: CatalogMessage[] = [
  { id: "a", text: "Nic tu jeszcze nie ma.", english: "Nothing here yet.", pattern: "Nic tu jeszcze nie ma." },
  { id: "b", text: "Usunąć …?", english: "Delete …?", pattern: ["Usunąć ", ["label"], "?"] },
  { id: "c", text: "Język", english: "Language", pattern: "Język" },
];

describe("messagesShown", () => {
  it("finds the messages a screen shows, a placeholder matching whatever filled it, in screen order", () => {
    const shown = messagesShown(["Usunąć Monstera?", "Coś innego", "Nic tu jeszcze nie ma."], messages);
    expect(shown.map((m) => m.id)).toEqual(["b", "a"]);
    expect(shown[0]!.seen).toBe("Usunąć Monstera?"); // as it is on screen, placeholder filled in
  });

  it("matches a whole text, not part of one", () => {
    expect(messagesShown(["Język polski"], messages)).toEqual([]);
  });

  it("reads a text that is a message word for word as that one only, and each wording once", () => {
    const more: CatalogMessage[] = [
      ...messages,
      { id: "d", text: "Dodaj …", english: "Add …", pattern: ["Dodaj ", ["name"]] },
      { id: "e", text: "Dodaj aplikację", english: "Add app", pattern: "Dodaj aplikację" },
      { id: "f", text: "Dodaj aplikację", english: "Add an app", pattern: "Dodaj aplikację" },
    ];
    expect(messagesShown(["Dodaj aplikację", "Dodaj notatkę"], more).map((m) => m.id)).toEqual(["e", "d"]);
  });

  it("never offers a message with no words of its own off the screen: it would match anything", () => {
    const names: CatalogMessage = { id: "g", text: "… — …", english: "… — …", pattern: [["autonym"], " — ", ["language"]] };
    expect(messagesShown(["Deutsch — niemiecki"], [names])).toEqual([]);
  });
});

describe("findMessages", () => {
  it("finds by the words now or the English, blind to case and accents", () => {
    expect(findMessages("usunac", messages).map((m) => m.id)).toEqual(["b"]);
    expect(findMessages("nothing", messages).map((m) => m.id)).toEqual(["a"]);
    expect(findMessages("", messages)).toEqual([]);
  });
});

describe("catalogMessages", () => {
  it("lists the active language's messages beside their English", async () => {
    await setLocale("pl");
    const all = catalogMessages();
    const language = all.find((m) => m.english === "Language");
    expect(language?.text).toBe("Język");
    expect(all.every((m) => m.id && m.text && m.english)).toBe(true);
  });
});
