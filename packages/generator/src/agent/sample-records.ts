// Sample records for an app the create loop just made (#486): what a link anyone can try opens on.
//
// The run check seeds every candidate with records made up from its fields ("name 1", "name 2",
// https://example.com/name/1) — values that exercise the code and say nothing about what the app is
// for. They stay in the run. Once a candidate has passed, the loop makes ONE more call, through the
// same engine as every other (so it is metered the same way), asking for 3–5 plausible records per
// entity in the app's own shape, in the person's language, dated around today.
//
// THE MODEL SEES STRUCTURE, NEVER RECORDS, as in Ask (ask.ts): the prompt is built from the entities'
// fields alone. Nothing here checks the reply beyond reading it as JSON — the caller holds every row
// to the rule a use of the seed is held to (the shell's app-seed.ts), drops what does not fit, and
// keeps none when fewer than two are left. A reply that is not JSON, or a call that fails, is no seed:
// the app was made, and opens on an empty copy.

import { humanizeKey, plainWords, type EntityDef, type Field } from "potyro";
import type { ChatEngine, ChatMessage } from "../chat-backend.js";
import { LANGUAGE_NAMES, type Language } from "../language.js";
import { describeField } from "./ask.js";

export interface SampleRequest {
  engine: ChatEngine;
  model?: string;
  /** The app's entities, as the run loaded them: labels in the person's language (#302). */
  entities: Readonly<Record<string, EntityDef>>;
  /** Dates are asked for within 30 days of this. */
  today: Date;
  /** The person's language (#301): names and text are written in it. English when absent. */
  language?: Language;
  signal?: AbortSignal;
}

/** The model's reply, read as JSON: rows by entity, not yet checked. */
export type SampleReply = Record<string, unknown>;

/** Fields a model cannot fill: a photo or a file it would have to name, a person in the app. */
const UNFILLABLE = new Set<Field["type"]>(["media", "file", "member"]);

/** Wider than a first draft's: these are records, and three of them should not read alike. */
const SAMPLE_TEMPERATURE = 0.7;

export const SAMPLE_SYSTEM_PROMPT =
  "You write sample records for an app someone has just made, so that a person trying it for the first time sees at once what it is for. " +
  "Reply with ONE JSON object and nothing else: no prose, no code fence.";

/** A relation in a sample: the id of a record written in the same reply. */
const sampleRelation = (field: Field & { type: "relation" }): string =>
  `relation to ${field.to}${field.many ? " (a list)" : ""}: the "id" of a ${field.to} record you write here`;

const day = (d: Date): string => d.toISOString().slice(0, 10);

/** The entities, in words a model can fill: only the fields it can set. Empty when there are none. */
export function describeSampleShape(entities: Readonly<Record<string, EntityDef>>): string {
  const blocks: string[] = [];
  for (const [key, entity] of Object.entries(entities)) {
    const fields = Object.entries((entity.fields ?? {}) as Record<string, Field>).filter(([, f]) => !UNFILLABLE.has(f.type));
    if (!fields.length) continue;
    const label = entity.label === undefined ? humanizeKey(key) : plainWords(entity.label);
    blocks.push([`entity ${key}${label !== key ? ` ("${label}")` : ""}`, ...fields.map(([fk, f]) => `  - ${describeField(fk, f, sampleRelation)}`)].join("\n"));
  }
  return blocks.join("\n\n");
}

/** The one request: what the app keeps, today's date, and the rules. Null when nothing can be filled. */
export function sampleMessages(entities: Readonly<Record<string, EntityDef>>, today: Date, language?: Language): ChatMessage[] | null {
  const shape = describeSampleShape(entities);
  if (!shape) return null;
  const lines = [
    `Today is ${day(today)}.`,
    "",
    "The app keeps:",
    shape,
    "",
    'Write 3 to 5 sample records for each entity, as one JSON object: { "<entity>": [ { "<field>": <value>, … }, … ], … }.',
    '- Plausible values a real person would enter: real names, places and amounts, specific to what the app is for. Never placeholders such as "name 1", "Example", "test" or "Lorem ipsum".',
    "- Use the field keys exactly, and follow each field's rule. Leave a field out rather than guess; leave out every field that is set by the app.",
    "- Dates fall within 30 days before or after today.",
    '- Give every record an "id" ("<entity>-1", "<entity>-2", …). A relation is the "id" of a record you write in this reply.',
    "- Photos, files and people are not listed: leave them out.",
  ];
  // As everywhere on the model side (language.ts): no instruction at all for English.
  if (language && language !== "en") lines.push(`- Write every name and every piece of text in ${LANGUAGE_NAMES[language]}.`);
  return [
    { role: "system", content: SAMPLE_SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The reply as JSON — one object, in a code fence or not. Null when it is not one. */
export function readSampleReply(text: string): SampleReply | null {
  const fenced = /```(?:json)?[^\S\n]*\n([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  const parsed = (json: string): unknown => {
    try {
      return JSON.parse(json);
    } catch {
      return undefined;
    }
  };
  // The reply as it is; else the object in it, when a line of prose came before or after.
  let value = parsed(body);
  if (value === undefined) {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start && !body.slice(0, start).includes("[")) value = parsed(body.slice(start, end + 1));
  }
  return isObject(value) ? value : null;
}

/**
 * Ask the model for sample records: one call, through `engine`. The reply read as JSON, or null when
 * there is nothing to fill, the call failed, or the reply was not JSON — never a throw: the app it is
 * for is already made.
 */
export async function askSampleRecords(req: SampleRequest): Promise<SampleReply | null> {
  if (req.signal?.aborted) return null;
  const messages = sampleMessages(req.entities, req.today, req.language);
  if (!messages) return null;
  try {
    const res = await req.engine.chat.completions.create({ ...(req.model ? { model: req.model } : {}), messages, temperature: SAMPLE_TEMPERATURE });
    return readSampleReply(res.choices[0]?.message.content ?? "");
  } catch (e) {
    console.warn("[potyro] no sample records for the new app:", e);
    return null;
  }
}
