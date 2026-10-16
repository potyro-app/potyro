// @vitest-environment happy-dom
//
// Make it mine (docs/24 §6): the link's remix intent, the hand-off to the Studio across a page load,
// and the changes the Studio suggests for a remix — drawn from the app, with no model.
import { beforeEach, describe, expect, it } from "vitest";
import { readDemoLink, remixLink } from "../src/demo-link.js";
import { handToStudio, takeStudioHandoff } from "../src/studio-handoff.js";
import { MAX_SUGGESTIONS, remixSuggestions } from "../src/remix-suggestions.js";

const ID = "AbCdEfGhIjKlMnOpQrStUv";

describe("the remix intent in a link", () => {
  it("is read from a hosted link's fragment, beside its key", () => {
    expect(readDemoLink(`/s/${ID}`, "#k=secret&remix=1")).toEqual({ kind: "hosted", id: ID, key: "secret", remix: true });
    expect(readDemoLink(`/s/${ID}`, "#k=secret")).toEqual({ kind: "hosted", id: ID, key: "secret" });
  });

  it("only `1` means it: anything else is a plain demo", () => {
    expect(readDemoLink(`/s/${ID}`, "#k=secret&remix=yes")).toEqual({ kind: "hosted", id: ID, key: "secret" });
    expect(readDemoLink(`/s/${ID}`, "#k=secret&remix=")).toEqual({ kind: "hosted", id: ID, key: "secret" });
    // and on its own it is no link at all
    expect(readDemoLink("/", "#remix=1")).toBeNull();
  });

  it("works on an inline link too", () => {
    const read = readDemoLink("/", "#try=UEsDBA&remix=1");
    expect(read).toMatchObject({ kind: "inline", remix: true });
  });

  it("is added to a demo link once, keeping the key where it was", () => {
    const link = `https://potyro.app/s/${ID}#k=secret`;
    expect(remixLink(link)).toBe(`https://potyro.app/s/${ID}#k=secret&remix=1`);
    expect(remixLink(remixLink(link))).toBe(remixLink(link));
    const url = new URL(remixLink(link));
    expect(readDemoLink(url.pathname, url.hash)).toEqual({ kind: "hosted", id: ID, key: "secret", remix: true });
    expect(() => remixLink("https://potyro.app/")).toThrow();
  });
});

describe("the hand-off to the Studio", () => {
  beforeEach(() => sessionStorage.clear());

  it("opens the Studio once, on the app it was left for", () => {
    handToStudio("groceries-remix");
    expect(takeStudioHandoff("plants")).toBeNull();
    expect(takeStudioHandoff("groceries-remix")).toEqual({});
    expect(takeStudioHandoff("groceries-remix")).toBeNull();
  });

  it("carries words for the box when a caller has them", () => {
    handToStudio("plants", { prompt: "Translate this app" });
    expect(takeStudioHandoff("plants")).toEqual({ prompt: "Translate this app" });
  });
});

describe("what the Studio suggests for a remix", () => {
  const groceries = {
    entities: {
      aisle: { label: "Aisle", fields: { name: { type: "text" } } },
      item: { label: "Item", fields: { name: { type: "text" }, done: { type: "boolean" } } },
    },
    pages: [
      { id: "item-detail", title: "Item", hidden: true, view: { type: "detail", entity: "item" } },
      { id: "list", title: "List", view: { type: "checklist", entity: "item" } },
      { id: "aisles", title: "Aisles", view: { type: "list", entity: "aisle" } },
    ],
  } as never;

  it("speaks of the record the app is about, by the app's own word for it", () => {
    const s = remixSuggestions(groceries, ["en"]);
    expect(s).toHaveLength(MAX_SUGGESTIONS);
    expect(s[0]).toBe("Add a photo to each “Item”");
    expect(s).toContain("Add a date to each “Item”");
    expect(s.join("\n")).not.toContain("Aisle");
    // always one about its look, last
    expect(s.at(-1)).toBe("Give it a different colour and icon");
  });

  it("does not suggest what the app already has", () => {
    const plants = {
      entities: { plant: { label: "Plant", fields: { photo: { type: "media" }, watered: { type: "datetime" }, notes: { type: "richtext" } } } },
      pages: [{ id: "all", title: "Plants", view: { type: "gallery", entity: "plant" } }],
    } as never;
    const s = remixSuggestions(plants, ["en"]);
    expect(s.some((x) => x.includes("photo"))).toBe(false);
    expect(s.some((x) => x.includes("note"))).toBe(false);
    expect(s).toContain("Show “Plant” on a calendar");
  });

  it("reads the app's word in the person's language when the app has one", () => {
    const def = {
      language: "en",
      languages: ["en", "pl"],
      entities: { item: { label: { en: "Item", pl: "Produkt" }, fields: {} } },
      pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item" } }],
    } as never;
    expect(remixSuggestions(def, ["pl"])[0]).toContain("Produkt");
  });

  it("an app with no records still gets the one about its look", () => {
    expect(remixSuggestions({ entities: {}, pages: [] } as never, ["en"])).toEqual(["Give it a different colour and icon"]);
  });
});
