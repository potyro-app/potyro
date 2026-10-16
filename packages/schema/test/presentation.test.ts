import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, PAGE_FIELDS, VIEW_FIELDS, type AppInput } from "../src/index.js";

// How an app LOOKS, declared as data (the built-in views' design pass): a page's description, ground
// and one primary action; a record page's cover, facts and primary action; a list row's lead; a
// gallery's shape; an action's glyph. Every one is optional, and an app that sets none looks designed
// anyway — these are for the app that wants its own.

const base = (over: Partial<AppInput> = {}): AppInput => ({
  id: "gym",
  name: "Gym",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    exercise: {
      fields: { name: { type: "text" }, level: { type: "enum", options: ["easy", "hard"] }, photo: { type: "media" } },
      actions: { start: { label: "Start", icon: "▶", run: () => {} } },
    },
  },
  quickActions: [{ id: "begin", label: "Start workout", entity: "exercise" }],
  pages: [
    { id: "list", title: "Exercises", view: { type: "list", entity: "exercise" } },
    { id: "ex", title: "Exercise", hidden: true, view: { type: "detail", entity: "exercise", param: "id" } },
  ],
  ...over,
});

describe("presentation options", () => {
  it("accepts every option, and keeps them as declared", () => {
    const app = defineApp(
      base({
        theme: { accent: "#3a7", background: "dots" },
        pages: [
          {
            id: "list",
            title: "Exercises",
            description: "Everything in your program",
            primaryAction: "begin",
            background: { image: "art/gym.jpg" },
            view: { type: "list", entity: "exercise", display: { primary: "name", lead: "icon" } },
          },
          { id: "photos", title: "Photos", primaryAction: 0, actions: [{ label: "Shuffle", run: () => {} }], view: { type: "gallery", entity: "exercise", aspect: "portrait" } },
          {
            id: "ex",
            title: "Exercise",
            hidden: true,
            view: { type: "detail", entity: "exercise", param: "id", cover: "full", media: "photo", facts: ["level"], primaryAction: "start" },
          },
        ],
      }),
    );
    const [list, photos, ex] = app.pages;
    expect(list!.description).toBe("Everything in your program");
    expect(list!.primaryAction).toBe("begin");
    expect(list!.background).toEqual({ image: "art/gym.jpg" });
    expect((list!.view as { display?: { lead?: string } }).display?.lead).toBe("icon");
    expect(photos!.primaryAction).toBe(0);
    expect((photos!.view as { aspect?: string }).aspect).toBe("portrait");
    expect(ex!.view).toMatchObject({ cover: "full", media: "photo", facts: ["level"], primaryAction: "start" });
    expect(app.theme?.background).toBe("dots");
    expect((app.entities.exercise!.actions!.start as { icon?: string }).icon).toBe("▶");
  });

  it("rejects a value that is not one of the choices, instead of quietly ignoring it", () => {
    expect(() => defineApp(base({ theme: { background: "stripes" as never } }))).toThrow(ValidationError);
    expect(() => defineApp(base({ theme: { background: { image: "" } } }))).toThrow(ValidationError);
    expect(() =>
      defineApp(base({ pages: [{ id: "list", title: "L", view: { type: "list", entity: "exercise", display: { lead: "photo" as never } } }] })),
    ).toThrow(ValidationError);
    expect(() => defineApp(base({ pages: [{ id: "g", title: "G", view: { type: "gallery", entity: "exercise", aspect: "wide" as never } }] }))).toThrow(ValidationError);
    expect(() => defineApp(base({ pages: [{ id: "d", title: "D", view: { type: "detail", entity: "exercise", cover: "hero" as never } }] }))).toThrow(ValidationError);
    expect(() => defineApp(base({ pages: [{ id: "l", title: "L", primaryAction: -1, view: { type: "list", entity: "exercise" } }] }))).toThrow(ValidationError);
  });

  it("is told to the model that edits apps", () => {
    for (const f of ["description?", "primaryAction?", "background?"]) expect(PAGE_FIELDS).toContain(f);
    expect(VIEW_FIELDS.detail).toEqual(expect.arrayContaining(["cover?", "media?", "facts?", "primaryAction?"]));
    expect(VIEW_FIELDS.gallery).toContain("aspect?");
  });
});
