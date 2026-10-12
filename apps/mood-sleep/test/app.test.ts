import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, fieldValueProblem, isPotyroApp, structureSchema } from "potyro";
import app from "../mood-sleep.app.js";

describe("Sleep & Mood", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("imports chart.js by an exact-version URL", () => {
    const source = readFileSync(new URL("../mood-sleep.app.ts", import.meta.url), "utf8");
    expect(source).toMatch(/from "https:\/\/esm\.sh\/chart\.js@\d+\.\d+\.\d+\?bundle"/);
  });

  it("ships a seed whose every value fits its field", () => {
    const seed = JSON.parse(readFileSync(new URL("../seed.json", import.meta.url), "utf8")) as Record<string, Array<Record<string, unknown>>>;
    expect(Object.keys(seed)).toEqual(["checkin"]);
    const fields = app.entities.checkin!.fields;
    expect(seed.checkin!.length).toBeGreaterThanOrEqual(18);
    for (const row of seed.checkin!) {
      for (const [key, value] of Object.entries(row)) {
        expect(fields[key], key).toBeDefined();
        expect(fieldValueProblem(fields[key]!, value, "write", key), `${key}=${JSON.stringify(value)}`).toBeNull();
      }
    }
  });
});
