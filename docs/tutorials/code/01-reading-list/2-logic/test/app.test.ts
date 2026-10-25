import { describe, expect, it } from "vitest";
import app, { lineOf } from "../reading-list.app";

describe("Reading list", () => {
  it("is a valid app", () => {
    expect(app.id).toBe("reading-list");
    expect(Object.keys(app.entities)).toEqual(["book"]);
  });

  it("writes the author and the rating under a book", () => {
    expect(lineOf("Ursula K. Le Guin", 4)).toBe("Ursula K. Le Guin · ★★★★☆");
    expect(lineOf("Ursula K. Le Guin", undefined)).toBe("Ursula K. Le Guin");
    expect(lineOf("", 5)).toBe("★★★★★");
  });
});
