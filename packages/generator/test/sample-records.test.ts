import { describe, expect, it } from "vitest";
import type { EntityDef } from "potyro";
import { describeSampleShape, readSampleReply, sampleMessages } from "../src/agent/sample-records.js";

// What the create loop asks the model for when it wants sample records (#486), and how it reads the
// reply. The model sees the entities' fields, never anyone's records.

const ENTITIES = {
  plant: {
    label: "Plant",
    fields: {
      name: { type: "text", label: "Plant", required: true },
      watered: { type: "datetime", label: "Last watered" },
      price: { type: "money", currency: "EUR" },
      room: { type: "relation", to: "room" },
      photo: { type: "media" },
      keeper: { type: "member" },
      sets: { type: "list", of: { amount: { type: "number", min: 0 }, room: { type: "relation", to: "room", many: true } } },
    },
  },
  room: { label: "Room", fields: { name: { type: "text" } } },
  pictures: { label: "Pictures", fields: { file: { type: "file" } } },
} as unknown as Record<string, EntityDef>;

describe("the request for sample records", () => {
  it("describes every field it can fill, with its rule — relations by the ids it writes", () => {
    const shape = describeSampleShape(ENTITIES);
    expect(shape).toContain('entity plant ("Plant")');
    expect(shape).toContain('name ("Plant"): text, required');
    expect(shape).toContain('watered ("Last watered"): date, ISO 8601');
    expect(shape).toContain("money as whole minor units, EUR");
    expect(shape).toContain('room ("Room"): relation to room: the "id" of a room record you write here');
    expect(shape).toContain('relation to room (a list): the "id" of a room record you write here');
    expect(shape).not.toContain('"@<ref>"');
    // A photo, a file, a person: not asked for. An entity with nothing else is left out.
    expect(shape).not.toMatch(/photo|keeper|entity pictures/);
  });

  it("names today and asks for plausible records, never placeholders", () => {
    const [system, user] = sampleMessages(ENTITIES, new Date("2026-10-31T23:30:00.000Z"))!;
    expect(system!.content).toMatch(/ONE JSON object/);
    expect(user!.content).toContain("Today is 2026-10-31.");
    expect(user!.content).toContain("within 30 days before or after today");
    expect(user!.content).toContain("3 to 5 sample records");
    expect(user!.content).toContain('Never placeholders such as "name 1"');
  });

  it("asks nothing when no field can be filled", () => {
    expect(sampleMessages({ pictures: ENTITIES.pictures! }, new Date())).toBeNull();
  });
});

describe("the reply", () => {
  it("is one JSON object, fenced or not", () => {
    expect(readSampleReply('{"plant":[{"name":"Monstera"}]}')).toEqual({ plant: [{ name: "Monstera" }] });
    expect(readSampleReply('Sure!\n```json\n{"plant":[{"name":"Fig"}]}\n```')).toEqual({ plant: [{ name: "Fig" }] });
  });

  it("is nothing when it is not one", () => {
    expect(readSampleReply("Monstera, Lemon tree")).toBeNull();
    expect(readSampleReply('{"plant": [ {"name": "Monstera", }')).toBeNull();
    expect(readSampleReply('[{"name":"Monstera"}]')).toBeNull();
    expect(readSampleReply("")).toBeNull();
  });
});
