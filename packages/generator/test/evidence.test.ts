import { describe, expect, it } from "vitest";
import type { AppDefinition } from "karta";
import { Retrieved, verifyRow } from "../src/agent/evidence.js";

// Every proposed record is checked against the text that was actually retrieved (#213). The device
// finds the evidence ITSELF: the pages whose text names the record, counted by site. Models do not
// reliably quote their sources (DeepSeek V4 Flash sent none, even when asked twice), and one that
// invents facts is exactly the one that would invent a quote too. Nothing here knows what the app is
// about — books, bars or concerts.

const DEF = {
  id: "b",
  name: "Books",
  entities: { book: { displayField: "title", fields: { title: { type: "text" }, author: { type: "text" } } } },
  pages: [],
} as unknown as AppDefinition;

function corpus(): Retrieved {
  const r = new Retrieved();
  r.add("https://www.goodreads.com/book/show/1", "Il nome della rosa is a 1980 novel by Umberto Eco, set in a monastery in 1327.");
  r.add("https://en.wikipedia.org/wiki/The_Name_of_the_Rose", "The Name of the Rose (Italian: Il nome della rosa) is the 1980 debut novel by Italian author Umberto Eco.");
  r.add("http://cambiamenu.it/ristoranti/cuneo/cuneo/alter-ego", "### Alter ego ... Il locale propone un menù vegano ... Via Santa Croce 20 Cuneo");
  r.add("https://en.wikipedia.org/wiki/If_on_a_winter%27s_night_a_traveler", "If on a Winter’s Night a Traveler, avant-garde novel by Italo Calvino, published in 1979.");
  return r;
}

const row = (values: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ entity: "book", ref: "r", values, ...extra });

describe("verifyRow", () => {
  it("corroborated: two different sites name it — found by the device, no quote needed", () => {
    const t = verifyRow(DEF, row({ title: "Il nome della rosa", author: "Umberto Eco" }), corpus());
    expect(t.status).toBe("corroborated");
    expect(t.sources.map((s) => s.host).sort()).toEqual(["en.wikipedia.org", "goodreads.com"]);
    expect(t.sources[0]!.quote).toMatch(/nome della rosa/i);
  });

  it("single source: one site only, and says which", () => {
    const t = verifyRow(DEF, row({ title: "Alter ego" }), corpus());
    expect(t.status).toBe("single");
    expect(t.sources[0]!.host).toBe("cambiamenu.it");
  });

  it("matches across case, accents and punctuation (Winter’s / winter's)", () => {
    expect(verifyRow(DEF, row({ title: "If on a winter's night a traveler" }), corpus()).status).toBe("single");
  });

  it("unsupported: no retrieved page names it — whatever quote the model offers", () => {
    const t = verifyRow(DEF, row({ title: "Baudolino" }, { evidence: [{ url: "https://www.goodreads.com/book/show/1", quote: "Baudolino, a 2000 novel by Umberto Eco" }] }), corpus());
    expect(t.status).toBe("unsupported");
    expect(t.issues.join()).toMatch(/Baudolino/);
  });

  it("general knowledge is labelled only when no page names it: the label cannot dodge the check", () => {
    expect(verifyRow(DEF, row({ title: "Carbonara" }, { general: true }), corpus()).status).toBe("general");
    expect(verifyRow(DEF, row({ title: "Alter ego" }, { general: true }), corpus()).status).toBe("single");
    expect(verifyRow(DEF, row({ title: "Carbonara" }), corpus()).status).toBe("unsupported");
  });

  it("a verified quote from the model counts too, for a record whose name is too short to search for", () => {
    const t = verifyRow(DEF, row({ title: "It" }, { evidence: [{ url: "https://www.goodreads.com/book/show/1", quote: "set in a monastery in 1327" }] }), corpus());
    expect(t.status).toBe("single");
  });
});
