import { describe, expect, it } from "vitest";
import type { AppDefinition, Migration } from "karta";
import { compareData, type DataSnapshot } from "../src/data-safety.js";

// The check that says whether a person still has what they wrote.
//
// Every case here is a shape a real modification produced: a field renamed properly, a field
// renamed and lost on the way, a table renamed wholesale, a `transform` nobody can attribute, and
// the quiet one — the app stops declaring a field and the values sit in the store where nothing
// will ever show them again.

const snap = (rows: Record<string, Record<string, Record<string, unknown>>>): DataSnapshot => {
  const out: DataSnapshot = new Map();
  for (const [entity, byId] of Object.entries(rows)) {
    out.set(entity, new Map(Object.entries(byId)));
  }
  return out;
};

/** A definition with just enough shape for the orphaned-field check. */
const def = (entities: Record<string, string[]>): AppDefinition =>
  ({
    entities: Object.fromEntries(
      Object.entries(entities).map(([name, fields]) => [
        name,
        { label: name, fields: Object.fromEntries(fields.map((f) => [f, { type: "text" }])) },
      ]),
    ),
    pages: [],
  }) as unknown as AppDefinition;

const NOTE = def({ note: ["title", "body"] });
const BEFORE = snap({ note: { n1: { title: "Groceries", body: "milk, eggs" }, n2: { title: "Ideas", body: "a thing" } } });

const migration = (steps: Migration["steps"]): Migration[] => [{ from: "1.0.0", to: "1.1.0", steps }];

const run = (after: DataSnapshot, chain: Migration[] = [], afterDef: AppDefinition = NOTE) =>
  compareData({ before: BEFORE, after, chain, beforeDef: NOTE, afterDef });

describe("compareData", () => {
  it("passes a modification that changed nothing about the data", () => {
    const r = run(BEFORE);
    expect(r.verdict).toBe("ok");
    expect(r.lostRecords).toEqual([]);
    expect(r.changedValues).toEqual([]);
  });

  it("reports a record that is no longer stored, which is the finding that stops a chain", () => {
    const r = run(snap({ note: { n1: { title: "Groceries", body: "milk, eggs" } } }));
    expect(r.verdict).toBe("loss");
    expect(r.lostRecords).toEqual([{ entity: "note", id: "n2" }]);
  });

  it("accepts a value change the app declared, and refuses one it did not", () => {
    const dropped = snap({ note: { n1: { title: "Groceries" }, n2: { title: "Ideas" } } });

    const declared = run(dropped, migration([{ op: "dropField", entity: "note", field: "body" }]), def({ note: ["title"] }));
    expect(declared.verdict).toBe("ok");
    expect(declared.unexplained).toEqual([]);
    expect(declared.removedFields).toEqual([{ entity: "note", field: "body", explained: "dropField note.body" }]);

    // The same data, with nothing in the app accounting for it.
    const silent = run(dropped);
    expect(silent.verdict).toBe("review");
    expect(silent.unexplained).toHaveLength(2);
    expect(silent.unexplained[0]).toMatchObject({ entity: "note", field: "body", explained: null });
    expect("after" in silent.unexplained[0]!).toBe(false); // the value is gone, not different
  });

  it("follows a declared rename, and calls a rename that lost the value what it is", () => {
    const chain = migration([{ op: "renameField", entity: "note", from: "body", to: "content" }]);
    const afterDef = def({ note: ["title", "content"] });

    const moved = run(
      snap({ note: { n1: { title: "Groceries", content: "milk, eggs" }, n2: { title: "Ideas", content: "a thing" } } }),
      chain,
      afterDef,
    );
    expect(moved.verdict).toBe("ok");
    expect(moved.renamedFields).toEqual([{ entity: "note", from: "body", to: "content" }]);
    expect(moved.changedValues).toEqual([]);

    // Declared, and the value did not arrive. A rename must not excuse the loss it was supposed to
    // prevent — this is the assertion that keeps the whole check honest.
    const lost = run(snap({ note: { n1: { title: "Groceries" }, n2: { title: "Ideas" } } }), chain, afterDef);
    expect(lost.verdict).toBe("review");
    expect(lost.unexplained).toHaveLength(2);
  });

  it("does not call a value deleted by a changeType converter a type change", () => {
    const r = run(
      snap({ note: { n1: { title: "Groceries" }, n2: { title: "Ideas" } } }),
      migration([{ op: "changeType", entity: "note", field: "body", to: "number", via: () => undefined }]),
      def({ note: ["title", "body"] }),
    );
    expect(r.verdict).toBe("review");
    expect(r.unexplained).toHaveLength(2);
  });

  it("matches records across a renamed entity instead of reporting the table as lost", () => {
    const r = compareData({
      before: BEFORE,
      after: snap({ memo: { n1: { title: "Groceries", body: "milk, eggs" }, n2: { title: "Ideas", body: "a thing" } } }),
      chain: migration([{ op: "renameEntity", from: "note", to: "memo" }]),
      beforeDef: NOTE,
      afterDef: def({ memo: ["title", "body"] }),
    });
    expect(r.lostRecords).toEqual([]);
    expect(r.removedEntities).toEqual([]);
    expect(r.renamedEntities).toEqual([{ from: "note", to: "memo" }]);
    expect(r.verdict).toBe("ok");
  });

  it("refuses to clear a chain that ran a transform, because it cannot attribute anything in it", () => {
    const r = run(BEFORE, migration([{ transform: (rec) => rec }]));
    expect(r.opaqueTransform).toBe(true);
    expect(r.verdict).toBe("review");
  });

  it("catches the field the app stopped declaring while the values are still in the store", () => {
    // Nothing was deleted, nothing moved, every record is exactly where it was. And `body` is no
    // longer in the definition, so what the person typed there is now unreachable through the app.
    // This is the failure reachability reports as a clean pass.
    const r = run(BEFORE, [], def({ note: ["title"] }));
    expect(r.lostRecords).toEqual([]);
    expect(r.changedValues).toEqual([]);
    expect(r.orphanedFields).toEqual([{ entity: "note", field: "body", records: 2 }]);
    expect(r.verdict).toBe("review");
  });

  // A chain that renames the table and then changes a field on it under the NEW name. Everything
  // here is declared, and matching the step's entity against the snapshot's would find nothing —
  // which reads as loss, and prints `note.body → gone` for a value sitting in `memo.content`. A
  // false alarm in the review sheet is not a safe direction to be wrong in: it is how the sheet
  // stops being read.
  describe("declared steps that follow a renameEntity", () => {
    const renameThen = (steps: Migration["steps"]): Migration[] => [
      { from: "1.0.0", to: "1.1.0", steps: [{ op: "renameEntity", from: "note", to: "memo" }] },
      { from: "1.1.0", to: "1.2.0", steps },
    ];

    it("explains a dropField declared on the new entity name", () => {
      const r = compareData({
        before: BEFORE,
        after: snap({ memo: { n1: { title: "Groceries" }, n2: { title: "Ideas" } } }),
        chain: renameThen([{ op: "dropField", entity: "memo", field: "body" }]),
        beforeDef: NOTE,
        afterDef: def({ memo: ["title"] }),
      });
      expect(r.unexplained).toEqual([]);
      expect(r.removedFields).toEqual([{ entity: "note", field: "body", explained: "dropField memo.body" }]);
      expect(r.verdict).toBe("ok");
    });

    it("follows a renameField declared on the new entity name", () => {
      const r = compareData({
        before: BEFORE,
        after: snap({ memo: { n1: { title: "Groceries", content: "milk, eggs" }, n2: { title: "Ideas", content: "a thing" } } }),
        chain: renameThen([{ op: "renameField", entity: "memo", from: "body", to: "content" }]),
        beforeDef: NOTE,
        afterDef: def({ memo: ["title", "content"] }),
      });
      expect(r.unexplained).toEqual([]);
      expect(r.changedValues).toEqual([]);
      expect(r.orphanedFields).toEqual([]);
      expect(r.verdict).toBe("ok");
    });

    it("still calls it loss when the declared rename did not deliver the value", () => {
      const r = compareData({
        before: BEFORE,
        after: snap({ memo: { n1: { title: "Groceries" }, n2: { title: "Ideas" } } }),
        chain: renameThen([{ op: "renameField", entity: "memo", from: "body", to: "content" }]),
        beforeDef: NOTE,
        afterDef: def({ memo: ["title", "content"] }),
      });
      expect(r.unexplained).toHaveLength(2);
      expect(r.verdict).toBe("review");
    });

    it("resolves a table renamed twice, not just once", () => {
      const r = compareData({
        before: BEFORE,
        after: snap({ entry: { n1: { title: "Groceries" }, n2: { title: "Ideas" } } }),
        chain: [
          { from: "1.0.0", to: "1.1.0", steps: [{ op: "renameEntity", from: "note", to: "memo" }] },
          { from: "1.1.0", to: "1.2.0", steps: [{ op: "renameEntity", from: "memo", to: "entry" }] },
          { from: "1.2.0", to: "1.3.0", steps: [{ op: "dropField", entity: "entry", field: "body" }] },
        ],
        beforeDef: NOTE,
        afterDef: def({ entry: ["title"] }),
      });
      expect(r.lostRecords).toEqual([]);
      expect(r.unexplained).toEqual([]);
      expect(r.verdict).toBe("ok");
    });
  });

  it("does not call a renamed field orphaned", () => {
    const r = run(
      snap({ note: { n1: { title: "Groceries", content: "milk, eggs" }, n2: { title: "Ideas", content: "a thing" } } }),
      migration([{ op: "renameField", entity: "note", from: "body", to: "content" }]),
      def({ note: ["title", "content"] }),
    );
    expect(r.orphanedFields).toEqual([]);
  });
});
