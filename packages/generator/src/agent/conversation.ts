// What was said about EARLIER versions of the app, for the modify loop (#279, docs/19 F4).
//
// The loop used to see only what was said since the last version (`briefSince`): a change the
// person turned down two versions ago, the answer they gave to a question, the feature they had
// removed — all gone, so the model did the reasonable thing and got it wrong. The Studio keeps the
// whole conversation per app (`studio-chat`, #265), so the material exists. Two ways in, built and
// measured together and apart (owner, 2026-10-13):
//
//   - a RECAP: the last N earlier requests, each with the questions asked about it, the answers and
//     what came of it, deterministic and in ONE place — the loop's single opening message. Splitting
//     information over turns costs ~39%; the same information concatenated into one message keeps
//     95% (Laban et al. 2025). So it is never replayed as chat turns.
//   - `read_conversation(before, count)`: older requests, paged on demand, capped. The recap says
//     how to call it when it left any out.
//
// Only what was said: the person's words and the Studio's answers. Never the app's source (it is
// in the conversation once, in the opening message) and never the person's records — the
// conversation does not hold them, and nothing here reads anything else.

import type { AgentTool } from "./tools.js";

/** What a message in the Studio's conversation was — the same kinds `studio-chat` keeps. */
export type ConversationKind = "ask" | "question" | "answer" | "refusal" | "failure" | "version" | "event";

/** One message of the conversation, as the loop is handed it: its kind and its words. */
export interface ConversationEntry {
  kind: ConversationKind;
  text: string;
  /** For an `ask`: the part of the app the person pointed at, in words (#284). */
  about?: string;
}

/** An earlier request with what was said about it and what came of it, written for the model. */
export interface ConversationRound {
  /** From 1, oldest first. */
  n: number;
  text: string;
}

/**
 * How many earlier requests the recap shows. Chosen on the conversation cases (modify-corpus.ts):
 * the request a case depends on is at most 4 back in all of them — as far back as a person refers to
 * something ("like before", "put it back") in the cases written from real use — and 6 rounds stay
 * well inside the size budget. The paid ablation (`--recap-rounds 1|3|6`, the PR) is what confirms it.
 */
export const DEFAULT_RECAP_ROUNDS = 6;
/** One message's words, at most. A person's long paste is the start of it, not all of it. */
const MAX_TEXT = 300;
/** The recap's rounds, at most: the oldest go first when it would be longer. */
const MAX_RECAP_CHARS = 3400;
/** What `read_conversation` returns at once. */
const MAX_PAGE = 5;
const MAX_PAGE_CHARS = 4000;
const DEFAULT_PAGE = 3;

const TOOL = "read_conversation";

const clip = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
};
const quoted = (text: string): string => `"${clip(text)}"`;

/** What came of a request, as one line. */
const OUTCOME: Record<"version" | "answer" | "refusal" | "failure", string> = {
  version: "Changed:",
  answer: "Nothing was changed:",
  refusal: "Not done — not something the app could change:",
  failure: "Could not be done:",
};

interface Open {
  lines: string[];
  hasAsk: boolean;
  /** The last thing said was a question to the person: the next ask answers it. */
  asked: boolean;
}

/** The conversation as requests, oldest first: each with its questions, answers and outcome. */
export function conversationRounds(entries: readonly ConversationEntry[]): ConversationRound[] {
  const done: string[][] = [];
  let open: Open | null = null;
  const close = (): void => {
    if (open && open.lines.length) done.push(open.lines);
    open = null;
  };
  for (const e of entries) {
    const text = e.text.trim();
    if (!text) continue;
    if (e.kind === "ask") {
      const said = e.about ? `About ${clip(e.about)}: ${quoted(text)}` : quoted(text);
      if (open?.asked) {
        open.lines.push(`They answered: ${said}`);
        open.asked = false;
      } else if (open?.hasAsk) open.lines.push(`They added: ${said}`);
      else {
        close();
        open = { lines: [`They asked: ${said}`], hasAsk: true, asked: false };
      }
    } else if (e.kind === "question") {
      open ??= { lines: [], hasAsk: false, asked: false };
      open.lines.push(`You asked them: ${quoted(text)}`);
      open.asked = true;
    } else if (e.kind === "event") {
      // Something that happened to the app — a rollback, a hand edit, a library fetched. Inside a
      // request it is part of that request; on its own it is a request's worth of its own.
      if (open?.hasAsk) open.lines.push(`Then: ${clip(text)}`);
      else {
        close();
        done.push([`Then: ${clip(text)}`]);
      }
    } else {
      open ??= { lines: [], hasAsk: false, asked: false };
      open.lines.push(`${OUTCOME[e.kind]} ${quoted(text)}`);
      close();
    }
  }
  if (open) {
    const o: Open = open;
    if (o.hasAsk) o.lines.push("(no answer: the Studio was closed or stopped before one came)");
    close();
  }
  return done.map((lines, i) => ({ n: i + 1, text: [`#${i + 1} ${lines[0]}`, ...lines.slice(1).map((l) => `   ${l}`)].join("\n") }));
}

/** The rounds that fit `budget` characters, newest kept: the oldest go first. */
function fitting(rounds: readonly ConversationRound[], budget: number): ConversationRound[] {
  const kept: ConversationRound[] = [];
  let used = 0;
  for (let i = rounds.length - 1; i >= 0; i--) {
    const size = rounds[i]!.text.length + 1;
    if (kept.length && used + size > budget) break;
    kept.unshift(rounds[i]!);
    used += size;
  }
  return kept;
}

const toolCall = (before: number): string => `\`${TOOL}({ before: ${before} })\``;

export interface RecapOptions {
  /** How many earlier requests to show (0: none). */
  rounds: number;
  /** Whether `read_conversation` is offered — the recap then says how to read what it left out. */
  tool: boolean;
}

/**
 * The recap for the opening message, or null when there is nothing earlier to say. Deterministic:
 * the same conversation always reads the same, and no model writes it.
 */
export function conversationRecap(entries: readonly ConversationEntry[], opts: RecapOptions): string | null {
  const all = conversationRounds(entries);
  if (!all.length) return null;
  const wanted = Math.max(0, Math.floor(opts.rounds));
  const shown = wanted ? fitting(all.slice(-wanted), MAX_RECAP_CHARS) : [];
  const firstShown = shown[0]?.n ?? all.length + 1;
  if (!shown.length) {
    if (!opts.tool) return null;
    return (
      `This app has a conversation: ${all.length} earlier request${all.length === 1 ? "" : "s"}, not shown here. If the request below refers to ` +
      `something said before ("like before", "put it back", "as I said"), call ${toolCall(firstShown)} to read the most recent of them.`
    );
  }
  const lines = [
    "WHAT WAS SAID EARLIER about this app, before the request below, oldest first. It is context, not the request: what the person " +
      "chose, answered or turned down still holds unless they now say otherwise. Only what was said is here — never their records.",
    ...shown.map((r) => r.text),
  ];
  if (firstShown > 1) {
    lines.push(
      opts.tool
        ? `(Older requests, #1–#${firstShown - 1}, are not shown; if you need them, call ${toolCall(firstShown)}.)`
        : `(${firstShown - 1} older request${firstShown - 1 === 1 ? " is" : "s are"} not shown.)`,
    );
  }
  return lines.join("\n");
}

/**
 * `read_conversation`: older requests on demand (#279). `shownFrom` is the first request the recap
 * shows — the default page ends just before it, so the first call reads the next ones back.
 */
export function buildConversationTool(entries: readonly ConversationEntry[], opts: { shownFrom: number }): AgentTool {
  const rounds = conversationRounds(entries);
  return {
    name: TOOL,
    description:
      "Read earlier requests from this app's conversation that the opening message does not show: what the person asked, your " +
      `questions and their answers, and what came of each. Only what was said — never the app or its records. ${TOOL}({ before: 4, count: 3 }) ` +
      `returns #1–#3; at most ${MAX_PAGE} at a time. Call it when the request refers to something said before that you cannot see.`,
    parameters: {
      type: "object",
      properties: {
        before: { type: "number", description: "Read the requests before this number (default: the first one the opening message shows)" },
        count: { type: "number", description: `How many (default ${DEFAULT_PAGE}, at most ${MAX_PAGE})` },
      },
    },
    run: async (args) => {
      const asked = Number(args.before);
      const before = Math.min(rounds.length + 1, Math.max(1, Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : opts.shownFrom));
      const wanted = Number(args.count);
      const count = Math.min(MAX_PAGE, Math.max(1, Number.isFinite(wanted) && wanted > 0 ? Math.floor(wanted) : DEFAULT_PAGE));
      if (before <= 1) return { ok: true, detail: "Nothing earlier: #1 is the start of the conversation." };
      const page = fitting(rounds.slice(Math.max(0, before - 1 - count), before - 1), MAX_PAGE_CHARS);
      const from = page[0]!.n;
      const to = page[page.length - 1]!.n;
      return {
        ok: true,
        detail: [
          `Earlier requests #${from}${to > from ? `–#${to}` : ""}, oldest first:`,
          ...page.map((r) => r.text),
          from > 1 ? `Older ones: ${toolCall(from)}.` : "That is the start of the conversation.",
        ].join("\n"),
      };
    },
  };
}

/** The first request a recap of `rounds` shows, out of `total` — where `read_conversation` starts. */
export function recapStartsAt(entries: readonly ConversationEntry[], rounds: number): number {
  const all = conversationRounds(entries);
  const wanted = Math.max(0, Math.floor(rounds));
  return (wanted ? fitting(all.slice(-wanted), MAX_RECAP_CHARS)[0]?.n : undefined) ?? all.length + 1;
}

/**
 * Whether a recap of the last `rounds` requests shows the one a case depends on, `back` requests
 * from the newest (1 = the latest) out of `total`. The model-free half of choosing N.
 */
export function recapCoverage(total: number, back: number, rounds: number): boolean {
  return back >= 1 && back <= Math.min(rounds, total);
}

/** How many requests back the one holding `words` is, 1 being the latest; null when none holds them. */
export function requestsBack(entries: readonly ConversationEntry[], words: string): number | null {
  const rounds = conversationRounds(entries);
  const at = rounds.findIndex((r) => r.text.includes(words));
  return at < 0 ? null : rounds.length - at;
}
