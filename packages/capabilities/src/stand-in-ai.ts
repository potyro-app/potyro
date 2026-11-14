// A stand-in AI service that answers every request without a model (#74): free, deterministic, and
// awkward on purpose. An app that reads a label with `ctx.caps.ai.extract` and writes the answer into
// a record works on the answer its author imagined; a real model also answers with half of it
// missing, or with a word the app has no option for. A run that never drives those answers passes
// apps that then fail in a person's hands.
//
// It answers the JSON Schema a request carries (`AiCall.json`), in one of three ways:
//   - "plausible": a value of the right type for every key — one from the app's own list of options
//                  where the run knows the key is written into one (`listed`);
//   - "missing":   null wherever the schema allows it, an empty list wherever it asks for a list;
//   - "unlisted":  the right types, and every free text a string that is in no list an app could
//                  have — so writing it into a field with fixed options is exercised.
// A key the schema holds to a list of options is always answered from that list: the service is held
// to it too, so anything else would be the stand-in's failure, not the app's.

import type { AiCall, AiCap, AiReply } from "./types.js";

export type AiAnswerPass = "plausible" | "missing" | "unlisted";

/** Every way the stand-in answers, the ordinary one first. */
export const AI_ANSWER_PASSES: readonly AiAnswerPass[] = ["plausible", "missing", "unlisted"];

/** A text no fixed list holds. Said as what it is, so a model reading an error knows where it came from. */
export const UNLISTED_TEXT = "Something not in any list";

/** What one answer was made of: which keys came back empty, and which carry a text in no list. */
export interface AiAnswer {
  value: unknown;
  /** Keys answered with null or an empty list, by path: "grape", "items". */
  missing: string[];
  /** Keys answered with `UNLISTED_TEXT`, by path. */
  unlisted: string[];
}

type Schema = Record<string, unknown>;

const typesOf = (s: Schema): string[] => (Array.isArray(s.type) ? s.type.map(String) : typeof s.type === "string" ? [s.type] : []);
const join = (path: string, key: string): string => (path ? `${path}.${key}` : key);
const lastKey = (path: string): string => path.replace(/\[\]$/, "").split(".").pop() || "value";

/** The values a key is known to be written into a fixed list of, when whoever runs the stand-in knows. */
export type ListedValues = (key: string) => readonly string[] | undefined;

function fill(schema: Schema, pass: AiAnswerPass, path: string, out: AiAnswer, listed?: ListedValues): unknown {
  const types = typesOf(schema);
  if (pass === "missing" && types.includes("null")) {
    out.missing.push(path);
    return null;
  }
  if (Array.isArray(schema.enum)) {
    const listed = schema.enum.filter((v) => v !== null);
    if (listed.length) return listed[0];
  }
  const type = types.find((t) => t !== "null") ?? (schema.properties ? "object" : schema.items ? "array" : "string");
  switch (type) {
    case "object": {
      const props = (schema.properties ?? {}) as Record<string, Schema>;
      return Object.fromEntries(Object.entries(props).map(([k, sub]) => [k, fill(sub ?? {}, pass, join(path, k), out, listed)]));
    }
    case "array": {
      if (pass === "missing") {
        out.missing.push(path);
        return [];
      }
      const items = (schema.items ?? {}) as Schema;
      return [fill(items, pass, `${path}[]`, out, listed), fill(items, pass, `${path}[]`, { value: undefined, missing: [], unlisted: [] }, listed)];
    }
    case "number":
    case "integer":
      return 12;
    case "boolean":
      return true;
    default: {
      if (/YYYY-MM-DD/.test(String(schema.description ?? ""))) return "2024-05-17";
      // The answer an app's author had in mind: a value its own list holds, where one is known.
      if (pass !== "unlisted") return listed?.(lastKey(path))?.[0] ?? `Sample ${lastKey(path)}`;
      out.unlisted.push(path);
      return UNLISTED_TEXT;
    }
  }
}

/** An answer to a JSON Schema, the way `pass` says. Pure: the same schema and pass give the same answer. */
export function answerSchema(schema: Record<string, unknown>, pass: AiAnswerPass, listed?: ListedValues): AiAnswer {
  const out: AiAnswer = { value: undefined, missing: [], unlisted: [] };
  out.value = fill(schema, pass, "", out, listed);
  return out;
}

/**
 * The stand-in service. `pass` is how it answers from now on; `asked` counts requests, and `answers`
 * keeps what the structured ones were made of, so a run can say what an action was given.
 * A request for words (no schema) gets a sentence — in no list, like any sentence.
 */
export class StandInAi implements AiCap {
  readonly service = "a stand-in";
  pass: AiAnswerPass = "plausible";
  asked = 0;
  answers: AiAnswer[] = [];
  /** The schemas asked for, in order: what another pass would be answering. */
  schemas: Array<Record<string, unknown>> = [];
  /** Which values a key's fixed list holds, so a plausible answer is one the app has an option for. */
  listed: ListedValues | undefined;

  async complete(call: AiCall): Promise<AiReply> {
    this.asked++;
    if (!call.json) return { text: `${UNLISTED_TEXT}.`, via: "free" };
    const answer = answerSchema(call.json, this.pass, this.listed);
    this.answers.push(answer);
    this.schemas.push(call.json);
    return { text: JSON.stringify(answer.value), via: "free" };
  }

  /** Allowed already: nobody is there to ask. */
  standing(): "on" {
    return "on";
  }

  /** Forget what was asked so far; the next action starts counting from nothing. */
  reset(): void {
    this.asked = 0;
    this.answers = [];
    this.schemas = [];
  }
}

/** A real 1×1 PNG: what a stand-in camera hands over, small enough to cross any bridge. */
export function standInPicture(): Blob {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}
