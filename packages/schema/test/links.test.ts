import { describe, expect, it } from "vitest";
import { acceptLinkParams, checkLinkRequest, defineApp, LINK_LIMITS, PAGE_FIELDS, ValidationError, type AppInput } from "../src/index.js";

// What a link may hand a page (docs/24 §11): the page declares the names (`link.params`); an arriving
// link is cut to them silently, and an app asking for a link it did not declare is told.

const base = (pages: AppInput["pages"]): AppInput => ({
  id: "draw-guess",
  name: "Draw",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { game: { fields: { title: { type: "text" } } } },
  pages,
});
const list = { type: "list", entity: "game" } as const;

describe("a page's link params", () => {
  it("are declared on the page, and kept by defineApp", () => {
    const app = defineApp(base([{ id: "play", title: "Play", link: { params: ["code"] }, view: list }]));
    expect(app.pages[0]!.link).toEqual({ params: ["code"] });
    // Handed to the model that edits apps: a field missing from it is one it will not use.
    expect(PAGE_FIELDS).toContain("link?");
  });

  it("are plain names, and only a few", () => {
    expect(() => defineApp(base([{ id: "play", title: "Play", link: { params: ["a-b"] }, view: list }]))).toThrow(ValidationError);
    expect(() => defineApp(base([{ id: "play", title: "Play", link: { params: ["1st"] }, view: list }]))).toThrow(ValidationError);
    const many = Array.from({ length: LINK_LIMITS.params + 1 }, (_, i) => `p${i}`);
    expect(() => defineApp(base([{ id: "play", title: "Play", link: { params: many }, view: list }]))).toThrow(ValidationError);
    expect(() => defineApp(base([{ id: "play", title: "Play", link: { params: ["code"], go: true } as never, view: list }]))).toThrow(ValidationError);
  });
});

describe("acceptLinkParams (a link arriving)", () => {
  const page = { link: { params: ["code", "name"] } };

  it("keeps the declared names with short text", () => {
    expect(acceptLinkParams(page, { code: "KQ7M", name: "Ana" })).toEqual({ code: "KQ7M", name: "Ana" });
  });

  it("drops, silently, what is not declared, too long or not text", () => {
    const got = acceptLinkParams(page, { code: "x".repeat(LINK_LIMITS.chars + 1), name: 7 as unknown as string, admin: "1", run: "delete" });
    expect(got).toEqual({});
    expect(acceptLinkParams(page, { code: "x".repeat(LINK_LIMITS.chars) })).toEqual({ code: "x".repeat(LINK_LIMITS.chars) });
  });

  it("gives a page that declares nothing nothing", () => {
    expect(acceptLinkParams({}, { code: "KQ7M" })).toEqual({});
    expect(acceptLinkParams(undefined, { code: "KQ7M" })).toEqual({});
  });

  it("never sets a prototype, whatever a name is", () => {
    const got = acceptLinkParams({ link: { params: ["__proto__"] } }, JSON.parse('{"__proto__":"x"}') as Record<string, unknown>);
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(got, "__proto__")).toBe(true);
  });
});

describe("checkLinkRequest (an app making a link)", () => {
  const pages = [
    { id: "play", link: { params: ["code"] } },
    { id: "games" },
  ];

  it("names one of the app's pages, with params it declares", () => {
    expect(checkLinkRequest({ page: "play", params: { code: "KQ7M" } }, pages)).toEqual({ page: "play", params: { code: "KQ7M" } });
    expect(checkLinkRequest({ page: "games" }, pages)).toEqual({ page: "games", params: {} });
  });

  it("says what is wrong, for the app's author to fix", () => {
    expect(() => checkLinkRequest({ page: "nope" }, pages)).toThrow(/one of this app's pages \(play, games\)/);
    expect(() => checkLinkRequest({ page: "games", params: { code: "K" } }, pages)).toThrow(/does not take `code` from a link — declare it/);
    expect(() => checkLinkRequest({ page: "play", params: { code: 12 } }, pages)).toThrow(/must be text/);
    expect(() => checkLinkRequest({ page: "play", params: { code: "x".repeat(LINK_LIMITS.chars + 1) } }, pages)).toThrow(/longer than/);
    expect(() => checkLinkRequest("play", pages)).toThrow(/must be \{ page, params\? \}/);
  });
});
