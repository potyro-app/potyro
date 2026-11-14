// What an app's failed code is, once it has left the app (#76).
//
// An action can fail three ways, and a person is owed a different sentence for each:
//
//   refused  the host refused a write (a value that does not fit its field): the entity, the field
//            and the rule are known as data, so it is said in the person's language, in the app's labels
//   said     the app (or the host, on its behalf) threw an `Error` with words of its own — "Pick a
//            photo first", "Free AI isn't available yet" — and those words are the message
//   broke    anything else: the engine's own errors (`TypeError: x is undefined`), a call that ran
//            out of time, a box that was stopped. Nothing in that is for a person to read
//
// The same three whichever way the app runs. Directly, the thrown error arrives as it is. From a
// sealed box only data crosses, so what was thrown is described (`thrownOf`) on the far side and
// rebuilt here as an `AppCodeError`, without a prefix naming the box: the box is how Potyro runs
// the app, not something its message should mention. Trouble that is the box's own (a timeout, a
// stop) is a `HostFault`, so it can never read as the app's words.
//
// The developer's detail is never dropped: `detail` is what the console and the Studio get.
//
// Pure, and bundled into the realm's worker too: no imports beyond types.

import type { FieldRefusal, ValueIssue } from "potyro";

/** A thrown error as data: what crosses out of a sealed box. */
export interface Thrown {
  /** The error's class name (`TypeError`, `FieldValueError`, the app's own). */
  name: string;
  message: string;
  /** An `Error`'s own `code`, when it has one (a socket's "denied"). */
  code?: string;
  /** A write the host refused, as data. */
  refusal?: FieldRefusal;
}

/** The app's own code failed inside a sealed box. `message` is the thrown message, nothing added. */
export class AppCodeError extends Error {
  readonly code?: string;
  readonly refusal?: FieldRefusal;
  constructor(readonly thrown: Thrown) {
    super(thrown.message);
    this.name = "AppCodeError";
    if (thrown.code !== undefined) this.code = thrown.code;
    if (thrown.refusal) this.refusal = thrown.refusal;
  }
}

/** The runner's own trouble — a call out of time, a box stopped or closed — not the app's words. */
export class HostFault extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostFault";
  }
}

const MAX_MESSAGE = 2_000;
const RULES_PLAIN = ["text", "number", "whole", "amount", "yesNo", "tags", "date", "place", "media", "file", "list"];
const RULES_MANY = ["record", "person", "member"];

/** A `ValueIssue` read out of untrusted data, or `undefined` when it is not one. */
function issueFrom(v: unknown, depth = 0): ValueIssue | undefined {
  if (!v || typeof v !== "object" || depth > 4) return undefined;
  const o = v as Record<string, unknown>;
  const rule = o.rule;
  if (typeof rule !== "string") return undefined;
  if (RULES_PLAIN.includes(rule)) return { rule } as ValueIssue;
  if (RULES_MANY.includes(rule)) return { rule, many: o.many === true } as ValueIssue;
  if (rule === "min" || rule === "max") {
    if (typeof o.bound !== "number" || !Number.isFinite(o.bound)) return undefined;
    return { rule, bound: o.bound, ...(typeof o.currency === "string" ? { currency: o.currency.slice(0, 8) } : {}) };
  }
  if (rule === "options") {
    if (!Array.isArray(o.options)) return undefined;
    return { rule, options: o.options.filter((x): x is string => typeof x === "string").slice(0, 500) };
  }
  if (rule === "row") {
    const issue = issueFrom(o.issue, depth + 1);
    return issue && typeof o.key === "string" ? { rule, key: o.key.slice(0, 200), issue } : undefined;
  }
  return undefined;
}

/** A `FieldRefusal` read out of untrusted data (what a box sent back), or `undefined`. */
export function refusalFrom(v: unknown): FieldRefusal | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const issue = issueFrom(o.issue);
  if (!issue || typeof o.entity !== "string" || typeof o.field !== "string") return undefined;
  return { entity: o.entity.slice(0, 200), field: o.field.slice(0, 200), issue };
}

/** Anything thrown, as data that can cross a port or a JSON string. */
export function thrownOf(e: unknown): Thrown {
  const o = (e ?? {}) as { name?: unknown; message?: unknown; code?: unknown; refusal?: unknown };
  const isError = e instanceof Error || (typeof e === "object" && e !== null && typeof o.message === "string");
  // A DOMException names itself after its kind ("DataCloneError", "AbortError"): say what it is.
  const dom = typeof DOMException !== "undefined" && e instanceof DOMException;
  const refusal = refusalFrom(o.refusal);
  return {
    name: dom ? "DOMException" : isError && typeof o.name === "string" && o.name ? o.name.slice(0, 80) : "Error",
    message: (isError ? String(o.message) : String(e)).slice(0, MAX_MESSAGE),
    ...(typeof o.code === "string" ? { code: o.code.slice(0, 80) } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

/** `Thrown` read out of what a box sent (never trusted to be well-formed). */
export function thrownFrom(m: { error?: unknown; name?: unknown; code?: unknown; refusal?: unknown }): Thrown {
  const refusal = refusalFrom(m.refusal);
  return {
    name: typeof m.name === "string" && m.name ? m.name.slice(0, 80) : "Error",
    message: String(m.error ?? "").slice(0, MAX_MESSAGE),
    ...(typeof m.code === "string" ? { code: m.code.slice(0, 80) } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

/** The errors the engine itself makes: a bug's trace, never words an app chose for a person. */
const ENGINE_ERRORS = new Set(["TypeError", "ReferenceError", "RangeError", "SyntaxError", "EvalError", "URIError", "AggregateError", "InternalError", "DOMException"]);

/** A failed action (or any app code), sorted by what a person may be told about it. */
export type ActionFailure =
  | { kind: "refused"; refusal: FieldRefusal; detail: string }
  | { kind: "said"; message: string; detail: string }
  | { kind: "broke"; detail: string };

/**
 * Sort what an app's code threw. `detail` is the developer's line (class name and message), for the
 * console and the Studio; only `refusal` and a `said` message are for the person.
 */
export function actionFailure(e: unknown): ActionFailure {
  if (e instanceof HostFault) return { kind: "broke", detail: e.message };
  const thrown = e instanceof AppCodeError ? e.thrown : thrownOf(e);
  const detail = thrown.name === "Error" ? thrown.message : `${thrown.name}: ${thrown.message}`;
  if (thrown.refusal) return { kind: "refused", refusal: thrown.refusal, detail };
  if (ENGINE_ERRORS.has(thrown.name) || !thrown.message.trim()) return { kind: "broke", detail };
  return { kind: "said", message: thrown.message, detail };
}
