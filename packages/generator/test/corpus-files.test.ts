import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectCatalogWords, stripFrontmatter } from "../src/corpus-files.js";

describe("stripFrontmatter", () => {
  it("removes a leading frontmatter block and the blank line after it", () => {
    const text = "---\ntitle: X\nstatus: current\n---\n\n# X\n\nBody.\n";
    expect(stripFrontmatter(text)).toBe("# X\n\nBody.\n");
  });

  it("leaves a text with no frontmatter alone", () => {
    expect(stripFrontmatter("# X\n\n---\n\nA rule, not frontmatter.\n")).toBe(
      "# X\n\n---\n\nA rule, not frontmatter.\n",
    );
  });

  it("leaves an unterminated block alone rather than eating the file", () => {
    expect(stripFrontmatter("---\ntitle: X\n# never closed\n")).toBe("---\ntitle: X\n# never closed\n");
  });

  it("accepts CRLF line endings", () => {
    expect(stripFrontmatter("---\r\ntitle: X\r\n---\r\n\r\n# X\r\n")).toBe("# X\r\n");
  });
});

describe("collectCatalogWords", () => {
  const po = (pairs: Array<[string, string]>): string => ['msgid ""', 'msgstr ""', '"Language: pl\\n"', "", ...pairs.flatMap(([id, str]) => [`msgid "${id}"`, `msgstr "${str}"`, ""])].join("\n");
  const repo = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), "catalogs-"));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  };

  it("reads Potyro's catalogs and every example's and app's beside it (docs/30)", () => {
    const root = repo({
      "packages/i18n/locales/pl/messages.po": po([["Map", "Mapa"]]),
      "packages/i18n/locales/en/messages.po": po([["Map", "Map"]]),
      "examples/files/recipes/locales/pl.po": po([["Recipe", "Przepis"], ["Add a recipe from a photo of a page", "Dodaj przepis ze zdjęcia strony"]]),
      "apps/piano/locales/pt-BR.po": po([["Lesson", "Lição"], ["{n} notes", "{n} notas"], ["Untranslated", ""]]),
      "apps/piano/node_modules/x/locales/pl.po": po([["Never", "Nigdy"]]),
    });
    expect(collectCatalogWords(root)).toEqual([
      ["pl", "Mapa", "Map"],
      ["pl", "Przepis", "Recipe"],
      ["pt-BR", "Lição", "Lesson"],
    ]);
  });
});
