// The translate step (docs/30 §5): an app's catalog for one language, filled by the model, on request.
//
// The app is written in one language and the model never writes another one into it. When the person
// asks for a language ("Translate into…", or "Update translations" after the app changed), the
// messages are extracted from the source, merged into that language's catalog, and ONLY those that
// need it — new, or fuzzy after their source text changed — go to the model, numbered, in one
// structured answer per batch. A translation must keep its message's {placeholders}; one that does
// not is left out, so the app shows the source text there rather than a broken message. The code is
// never touched.

import { readPo, writePo, type CatalogEntry } from "@potyro/i18n/app-catalogs";
import { extractMessages, mergeCatalog, messageHoles } from "./app-catalog.js";

/**
 * One model call: a system and a user message in, the model's reply out. `keys` are the answer's keys,
 * every one required, for a backend that holds the answer to a JSON schema (`answerSchema`).
 */
export type AskModel = (request: { system: string; user: string; keys: readonly string[]; signal?: AbortSignal }) => Promise<string>;

/** The JSON schema of an answer with exactly `keys`, each a string: strict, as a structured-output backend wants it. */
export function answerSchema(keys: readonly string[]): Record<string, unknown> {
  return { type: "object", properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])), required: [...keys], additionalProperties: false };
}

export interface TranslateCatalogRequest {
  /** The app's main source, and its own modules' sources. */
  source: string;
  modules?: readonly string[];
  /** The language to translate into, a BCP 47 tag ("pl", "pt-BR"). */
  language: string;
  /** That language's catalog as it is, or nothing for a new language. */
  po?: string | null;
  ask: AskModel;
  signal?: AbortSignal;
  /** Messages per call (default `TRANSLATE_BATCH`): fewer where a backend caps an answer's length. */
  batch?: number;
}

export interface TranslateCatalogResult {
  /** The catalog, every message in step with the source. */
  po: string;
  /** Messages sent to the model; translated; left out because the answer broke their placeholders or skipped them. */
  asked: number;
  translated: number;
  left: string[];
}

/** Messages per call: enough for most apps in one, small enough that an answer is never cut off. */
export const TRANSLATE_BATCH = 120;

const keyOf = (e: { id: string; context?: string }): string => (e.context ? `${e.context}\u0004${e.id}` : e.id);

export function translateSystem(from: string, to: string): string {
  return [
    `You translate the interface words of a small personal app from ${from} to ${to}: its labels, titles, buttons, help and messages.`,
    "Each message is numbered; \"where\" says where it shows, \"context\" tells apart one text with two meanings, and \"was\" is an",
    "older translation to start from. Write what a native speaker would expect to read in an app: short, natural, consistent.",
    "Messages are ICU MessageFormat. Keep every {placeholder} exactly as written, and translate the words inside plural and",
    "select branches, giving the target language the plural categories it needs (one, few, many, other…). Keep emoji, units",
    "and names that read the same in the target language.",
    'Answer with ONE JSON object and nothing else: { "1": "…", "2": "…" }, one entry per message number.',
  ].join("\n");
}

function readAnswer(reply: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply)?.[1] ?? reply;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const parsed: unknown = JSON.parse(fenced.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Fill `language`'s catalog: what the app's messages need, asked of the model, checked, merged. */
export async function translateCatalog(req: TranslateCatalogRequest): Promise<TranslateCatalogResult> {
  const extracted = await extractMessages(req.source, req.modules);
  if (!extracted) throw new Error("The app has no defineApp({...}) written out, so its words cannot be read.");
  const from = extracted.language ?? "en";
  const { po: merged } = mergeCatalog(req.po ?? null, req.language, extracted.messages);
  const entries = readPo(merged).entries;
  const needed = entries.filter((e) => !e.obsolete && (!e.text || e.fuzzy));
  const filled = new Map<string, string>();
  const left: string[] = [];

  const size = Math.max(1, req.batch ?? TRANSLATE_BATCH);
  for (let at = 0; at < needed.length; at += size) {
    req.signal?.throwIfAborted();
    const batch = needed.slice(at, at + size);
    const listed = batch.map((e, i) => ({
      n: String(i + 1),
      text: e.id,
      ...(e.context ? { context: e.context } : {}),
      ...(e.references[0] ? { where: e.references[0] } : {}),
      ...(e.fuzzy && e.text ? { was: e.text } : {}),
    }));
    const reply = await req.ask({ system: translateSystem(from, req.language), user: JSON.stringify(listed, null, 1), keys: listed.map((m) => m.n), ...(req.signal ? { signal: req.signal } : {}) });
    const answer = readAnswer(reply);
    batch.forEach((e, i) => {
      const text = answer[String(i + 1)];
      // A broken placeholder would show nothing, or throw where the message is formatted: leave it to the source text.
      if (typeof text === "string" && text.trim() && messageHoles(text) === messageHoles(e.id)) filled.set(keyOf(e), text);
      else left.push(e.id);
    });
  }

  const out: CatalogEntry[] = entries.map((e) => {
    const text = filled.get(keyOf(e));
    return text === undefined || e.obsolete ? e : { ...e, text, fuzzy: false };
  });
  return { po: writePo(req.language, out), asked: needed.length, translated: filled.size, left };
}

/** How many of the app's messages `language`'s catalog lacks, new or changed: what "Update translations" would ask. */
export async function catalogGaps(source: string, modules: readonly string[] | undefined, language: string, po: string | null): Promise<number> {
  const extracted = await extractMessages(source, modules);
  if (!extracted) return 0;
  const { po: merged } = mergeCatalog(po, language, extracted.messages);
  return readPo(merged).entries.filter((e) => !e.obsolete && (!e.text || e.fuzzy)).length;
}
