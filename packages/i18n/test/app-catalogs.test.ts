// An app's own catalogs (docs/30): read, compiled for the runtime, written back.

import { describe, expect, test } from "vitest";
import { catalogLanguage, compileCatalog, readPo, writePo } from "../src/app-catalogs.js";

const PL = `msgid ""
msgstr ""
"Language: pl\\n"
"Content-Type: text/plain; charset=UTF-8\\n"

#. pages.today.title
msgid "Today"
msgstr "Dziś"

msgid "{n, plural, one {# plant} other {# plants}}"
msgstr "{n, plural, one {# roślina} few {# rośliny} many {# roślin} other {# rośliny}}"

#, fuzzy
msgid "Water now!"
msgstr "Podlej teraz"

msgid "Coming up"
msgstr ""

msgctxt "verb"
msgid "Water"
msgstr "Podlej"

#~ msgid "Schedule"
#~ msgstr "Harmonogram"
`;

describe("app catalogs", () => {
  test("compiles what is translated; fuzzy, empty and obsolete messages stay in the source language", () => {
    expect(compileCatalog(PL)).toEqual({
      Today: "Dziś",
      "{n, plural, one {# plant} other {# plants}}": "{n, plural, one {# roślina} few {# rośliny} many {# roślin} other {# rośliny}}",
      "verb\u0004Water": "Podlej",
    });
  });

  test("reads every message with what a translator needs, and the file's language", () => {
    const { language, entries } = readPo(PL);
    expect(language).toBe("pl");
    expect(entries.map((e) => [e.id, e.fuzzy, e.obsolete])).toEqual([
      ["Today", false, false],
      ["{n, plural, one {# plant} other {# plants}}", false, false],
      ["Water now!", true, false],
      ["Coming up", false, false],
      ["Water", false, false],
      ["Schedule", false, true],
    ]);
    expect(entries[0]!.notes).toEqual(["pages.today.title"]);
    expect(entries[4]!.context).toBe("verb");
  });

  test("what it writes reads back the same", () => {
    const { entries } = readPo(PL);
    const again = readPo(writePo("pl", entries));
    expect(again.language).toBe("pl");
    expect(again.entries).toEqual(entries);
    expect(compileCatalog(writePo("pl", entries))).toEqual(compileCatalog(PL));
  });

  test("a catalog's language comes from its path", () => {
    expect(catalogLanguage("locales/pl.po")).toBe("pl");
    expect(catalogLanguage("locales/pt-BR.po")).toBe("pt-BR");
    expect(catalogLanguage("locales/messages.pot")).toBeNull();
    expect(catalogLanguage("photos/pl.po")).toBeNull();
  });
});

describe("poLineProblem", () => {
  test("passes every catalog the tools write, and names the first line that breaks one", async () => {
    const { poLineProblem } = await import("../src/app-catalogs.js");
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../../../examples/files/groceries/locales/", import.meta.url);
    for (const f of readdirSync(dir)) expect(poLineProblem(readFileSync(new URL(f, dir), "utf8")), f).toBeNull();
    expect(poLineProblem('msgid "Today"\nmsgstr "Dzi')).toBe('line 2: msgstr "Dzi');
    expect(poLineProblem('msgid "Today"\nmsgstr "Dziś" extra')).toBe('line 2: msgstr "Dziś" extra');
    expect(poLineProblem('msgid "Say \\"hi\\""\nmsgstr ""\n"continued"\n#, fuzzy\n#~ msgid "old"\n')).toBeNull();
  });
});
