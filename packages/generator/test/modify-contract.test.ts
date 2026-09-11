import { describe, expect, test } from "vitest";
import { NOT_IN_APP, buildModifyMessage, parseModifyReply, parseNotDone, buildRepairInstruction } from "../src/prompt.js";

// The Edit-mode contract. Its job is to make "this isn't the app's to fix" a REPRESENTABLE answer:
// when the only legal reply is updated source, a request the module cannot express comes back as a
// confident edit to whatever function looked closest, and each attempt's rationalisation becomes the
// next attempt's premise.

describe("buildModifyMessage", () => {
  test("offers both reply shapes, not just source", () => {
    const msg = buildModifyMessage("make the map remember my zoom");
    expect(msg).toContain(NOT_IN_APP);
    expect(msg).toContain("```ts block");
    // The asymmetry has to be stated, or the model defaults to producing code — and since #132 it is
    // two-sided: an edit that cannot work is bad, and refusing a mostly-doable request is worse.
    expect(msg).toMatch(/cannot possibly work/i);
    expect(msg).toMatch(/worse than both/i);
  });

  test("states the target view's declarable surface, so the boundary is knowable", () => {
    const msg = buildModifyMessage("remember my zoom", {
      target: { viewType: "map", pageTitle: "Map", fields: ["entity", "geo", "title?", "camera?"] },
    });
    expect(msg).toContain('the "Map" page');
    expect(msg).toContain("entity, geo, title?, camera?");
    expect(msg).toMatch(/belongs to the host/i);
  });

  test("names what was already tried, so a repeated complaint escalates", () => {
    const msg = buildModifyMessage("still no pins", {
      priorAttempts: ['Regarding the "Map" page: no pins until I filter', 'Regarding the "Map" page: still no pins'],
    });
    expect(msg).toContain("did NOT work");
    expect(msg).toContain("no pins until I filter");
    expect(msg).toMatch(/not propose the same lever a third time/i);
  });

  test("forbids causal comments in the source", () => {
    expect(buildModifyMessage("x")).toMatch(/comments that assert a cause/i);
  });

  test("omits the optional sections when there is nothing to say", () => {
    const msg = buildModifyMessage("x");
    expect(msg).not.toContain("did NOT work");
    expect(msg).not.toContain("Already reported as host-side");
  });

  // The whole-file ask was the defect: reproducing 200 lines to change 3 is where pages got renamed
  // and colons doubled. The prompt now asks for the changed lines only.
  test("asks for SEARCH/REPLACE edits, never the whole file", () => {
    const msg = buildModifyMessage("add a rating field");
    expect(msg).toContain("<<<<<<< SEARCH");
    // Measured (2026-09-10, 36 samples): every SEARCH miss came from two edits touching the same
    // lines, the later one still describing the text the earlier one had changed.
    expect(msg).toMatch(/never send two edits that touch the same lines/i);
    expect(msg).toContain(">>>>>>> REPLACE");
    expect(msg).toMatch(/do not send the whole file/i);
    expect(msg).not.toMatch(/the whole file, not a diff/i);
    expect(msg).toMatch(/any SEARCH line you do not repeat in REPLACE is deleted/i);
  });

  // The system prompt's OUTPUT rule ("only the source, no prose") is for CREATING an app. Left
  // implicit, it contradicts "put your reasoning in the prose before the block", and a model
  // resolving the contradiction picks the system prompt. Say which rule applies here.
  test("overrides the system prompt's whole-file OUTPUT rule explicitly", () => {
    expect(buildModifyMessage("x")).toMatch(/OUTPUT rule .*does not apply/i);
  });
});

// The ladder (#132). A request with four parts and one host gap used to be refused whole: the only
// legal replies were "edits" and "NOT-IN-APP", and the prompt called the refusal cheap. Now the
// refusal is the LAST rung, after built-ins, a custom view, and doing the parts that can be done.
describe("buildModifyMessage — the feasibility ladder", () => {
  const msg = buildModifyMessage("select a trip, then everything shows that trip");

  test("orders the rungs: declare, custom view, partial with Not done, refuse last", () => {
    const declare = msg.search(/REFERENCE/);
    const custom = msg.search(/custom.*view/i);
    const partial = msg.indexOf("Not done:");
    const refuse = msg.indexOf(NOT_IN_APP);
    expect(declare).toBeGreaterThanOrEqual(0);
    expect(custom).toBeGreaterThan(declare);
    expect(partial).toBeGreaterThan(custom);
    expect(refuse).toBeGreaterThan(partial);
  });

  test("says a custom view is a legitimate answer for a trusted app, despite the size budget", () => {
    expect(msg).toMatch(/size.budget[\s\S]*?(creating|new) apps/i);
  });

  test("forbids refusing a request because one part of it cannot be done", () => {
    expect(msg).toMatch(/never refuse .* because (one|a) part/i);
    expect(msg).toMatch(/only if no part/i);
  });

  test("still names the asymmetry, so the model does not send edits it knows cannot work", () => {
    expect(msg).toMatch(/cannot possibly work/i);
  });
});

describe("parseNotDone", () => {
  test("reads the bullet lines under a Not done heading", () => {
    expect(parseNotDone("I added the chip.\n\nNot done:\n- centre the map on the trip, needs a function-valued `camera`\n- an app-wide current trip, needs `ctx.scope`\n")).toEqual([
      "centre the map on the trip, needs a function-valued `camera`",
      "an app-wide current trip, needs `ctx.scope`",
    ]);
  });

  test("tolerates markdown dressing on the heading and the bullets", () => {
    expect(parseNotDone("**Not done:**\n* first\n• second\n1. third")).toEqual(["first", "second", "third"]);
  });

  test("stops at the first non-bullet line and is empty without the heading", () => {
    expect(parseNotDone("Not done:\n- one\n\nAlso, I renamed a page.")).toEqual(["one"]);
    expect(parseNotDone("Nothing was left undone.")).toEqual([]);
  });
});

describe("parseModifyReply", () => {
  test("carries the Not done parts alongside the source", () => {
    const r = parseModifyReply("Added the chip.\n\nNot done:\n- centre the map\n```ts\nconst a = 1;\n```");
    expect(r).toEqual({ kind: "source", source: "const a = 1;", rationale: "Added the chip.\n\nNot done:\n- centre the map", notDone: ["centre the map"] });
  });

  test("a reply without a Not done section has no notDone key at all", () => {
    expect(parseModifyReply("done\n```ts\nconst a = 1;\n```")).not.toHaveProperty("notDone");
  });

  test("reads a code block as source", () => {
    const r = parseModifyReply("here you go\n```ts\nconst a = 1;\n```");
    expect(r).toEqual({ kind: "source", source: "const a = 1;", rationale: "here you go" });
  });

  test("keeps prose before the block as the rationale, so it need not live in comments", () => {
    const r = parseModifyReply("I widened the filter.\n\n```ts\nconst a = 1;\n```");
    expect(r.kind === "source" && r.rationale).toBe("I widened the filter.");
  });

  test("source with no prose carries no rationale", () => {
    const r = parseModifyReply("```ts\nconst a = 1;\n```");
    expect(r).toEqual({ kind: "source", source: "const a = 1;" });
  });

  test("reads a marker line as a diagnosis", () => {
    const r = parseModifyReply(`${NOT_IN_APP} the map's camera is fixed by the host view.`);
    expect(r).toEqual({ kind: "diagnosis", text: "the map's camera is fixed by the host view." });
  });

  test("a diagnosis wins over code the model attached anyway", () => {
    // Models habitually ship code while explaining that code will not help. Acting on source the
    // model has just disowned is precisely the failure this contract exists to prevent.
    const r = parseModifyReply(
      `${NOT_IN_APP} the camera lives in the built-in map view.\nA fix belongs in packages/views.\n\n\`\`\`ts\nconst unchanged = 1;\n\`\`\``,
    );
    expect(r.kind).toBe("diagnosis");
    expect(r.kind === "diagnosis" && r.text).toContain("built-in map view");
    expect(r.kind === "diagnosis" && r.text).not.toContain("const unchanged");
  });

  test("the marker only counts at the start of a line", () => {
    const r = parseModifyReply("I considered whether this was NOT-IN-APP: it isn't.\n```ts\nconst a = 1;\n```");
    expect(r.kind).toBe("source");
  });

  test("bare source with no fence still parses", () => {
    expect(parseModifyReply("  const a = 1;  ")).toEqual({ kind: "source", source: "const a = 1;" });
  });
});

// A measured DeepSeek reply: three paragraphs of reasoning, then the verdict wrapped in backticks on
// its own line. The strict line-start match missed it, and the whole essay went to the bundler as
// source - in the eval that scored a correct refusal as "invalid", and in the Studio it would have
// landed as a broken app. The marker still has to OPEN its line, so a mid-prose mention stays prose.
describe("parseModifyReply tolerates a dressed-up marker", () => {
  test("finds NOT-IN-APP wrapped in backticks at the end of an explanation", () => {
    const reply = [
      "This change is **not achievable within the app source**. The map's tap-to-create flow is",
      "handled by the host shell; the app cannot intercept it.",
      "",
      "So the answer is:",
      "",
      "`NOT-IN-APP: The map's create-tap flow is a host-shell behaviour the app cannot sequence.`",
    ].join("\n");
    const r = parseModifyReply(reply);
    expect(r.kind).toBe("diagnosis");
    expect((r as { text: string }).text).toBe("The map's create-tap flow is a host-shell behaviour the app cannot sequence.");
  });

  test("finds NOT-IN-APP wrapped in bold", () => {
    const r = parseModifyReply("Reasoning first.\n\n**NOT-IN-APP: the host owns this.**");
    expect(r.kind).toBe("diagnosis");
    expect((r as { text: string }).text).toBe("the host owns this.");
  });

  test("still ignores a mention that does not open its line", () => {
    const r = parseModifyReply("I considered whether this was NOT-IN-APP: it is not.\n```ts\nconst x = 1;\n```");
    expect(r.kind).toBe("source");
  });
});

describe("buildRepairInstruction", () => {
  // A repair is a modify whose instruction is the validator's own words. It must name every issue,
  // and it must scope the change to those issues — a repair that "improves" other things is how a
  // second, unrelated regression arrives.
  test("lists every issue and scopes the change to them", () => {
    const text = buildRepairInstruction(['pages.2: Unrecognized key(s) in object: "onLoad"', 'page "detail" references unknown field "servings"']);
    expect(text).toContain('pages.2: Unrecognized key(s) in object: "onLoad"');
    expect(text).toContain('unknown field "servings"');
    expect(text).toMatch(/fix exactly these problems/i);
    expect(text).toMatch(/nothing else/i);
    expect(text).not.toMatch(/whole file/i);
  });
});
