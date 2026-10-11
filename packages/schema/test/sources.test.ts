import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, type AppDefinition } from "../src/index.js";

// `sources` (#213): outside data an app's Ask may read — a places API, a search engine. Declared by
// the app's builder, validated like the rest of the structure, and NEVER carrying a key: a shared app
// hands every person the declaration, and each of them brings their own key.

const places = (extra: Partial<AppDefinition> = {}): AppDefinition => ({
  id: "places",
  name: "Places",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { place: { displayField: "name", fields: { name: { type: "text" } } } },
  pages: [{ id: "all", title: "Places", view: { type: "list", entity: "place" } }],
  ...extra,
});

describe("sources", () => {
  it("accepts a source with an endpoint, docs and a way to send a key", () => {
    const src = {
      label: "Places search",
      description: "Finds places near a point",
      endpoint: "https://api.example.com/v1/",
      docs: "https://docs.example.com/places",
      auth: { header: "Authorization", prefix: "Bearer " },
    };
    expect(defineApp(places({ sources: { places: src } })).sources).toEqual({ places: src });
    expect(() => defineApp(places({ sources: { osm: { endpoint: "https://overpass-api.de/api/" } } }))).not.toThrow();
    expect(() => defineApp(places({ sources: { s: { endpoint: "https://x.example/", auth: { query: "key" } } } }))).not.toThrow();
  });

  it("refuses a key, or anything else it does not know, in a source", () => {
    const withKey = { endpoint: "https://api.example.com/", apiKey: "sk-123" } as never;
    expect(() => defineApp(places({ sources: { s: withKey } }))).toThrow(ValidationError);
    expect(() => defineApp(places({ sources: { s: withKey } }))).toThrow(/apiKey/);
  });

  it("refuses an endpoint that is not https", () => {
    expect(() => defineApp(places({ sources: { s: { endpoint: "http://api.example.com/" } } }))).toThrow(/https/);
    expect(() => defineApp(places({ sources: { s: { endpoint: "not a url" } } }))).toThrow(ValidationError);
  });
});
