// What the modify loop says when it rolls a repeat back or starts a chain again (#278, docs/19 F1–F2).
//
// Repetition reinforces itself: the more often a sentence is already in the context, the likelier
// the model is to say it again. So a repeat is taken OUT of the conversation, and one short note
// goes in its place: what was tried, why it was turned back, and the ways out that exist. And a
// chain that has had two candidates turned back is not extended — repair decays within two or three
// attempts — but started again from the app and the request, with one line per attempt so the same
// thing is not sent a third time.
//
// The ways out are the ones the loop can act on: another approach, `ASK:`, `NOT-IN-APP:`, and since
// #263 `NEEDS-PLATFORM:` — a repeat is one of the places the harness offers it (docs/19 F1, F5).

import type { ToolCallOnMessage } from "../chat-backend.js";
import { NOT_IN_APP } from "../prompt.js";
import { NEEDS_PLATFORM } from "./platform-request.js";

const ASK = "ASK:";

/** The text, on one line and at most `max` characters. */
export function oneLine(text: string, max = 160): string {
  const flat = text.replace(/```[\s\S]*?(```|$)/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The same calls with the same arguments, whatever their ids: what "the same tool call" means. */
export function toolTurnSignature(calls: readonly ToolCallOnMessage[]): string {
  return JSON.stringify(
    calls.map((c) => {
      let args: unknown = c.function.arguments;
      try {
        args = JSON.parse(c.function.arguments || "{}");
      } catch {
        // compared as the raw string
      }
      return [c.function.name, args];
    }),
  );
}

/** How a call is named in a note: `lookup {"query":"Ctx"}`. */
export function describeToolTurn(calls: readonly ToolCallOnMessage[]): string {
  return calls.map((c) => `\`${c.function.name}\` ${oneLine(c.function.arguments || "{}", 80)}`).join(", ");
}

/** An attempt that was turned back, in one line each: what it was, and why. */
export interface TurnedBack {
  tried: string;
  reason: string;
}

/** The note that replaces a rolled-back repeat. */
export function rollbackNote(r: TurnedBack): string {
  return [
    `You already did this: ${r.tried}`,
    `What came back: ${r.reason}`,
    "Sending it again will not work, so it has been taken out of this conversation. Do something different:",
    "- change the app another way, with edits against the app as first shown;",
    `- or, if only the person can tell you what they want, start your reply with "${ASK}" and one short question about what they want, in their words;`,
    `- or, if this cannot be done inside the app, start your reply with "${NOT_IN_APP}" and say why in one sentence;`,
    `- or, if it needs something Potyro itself does not offer yet, do what the app can do and add a line "${NEEDS_PLATFORM} <what Potyro would need>" — or reply with only that line if nothing can be done.`,
  ].join("\n");
}

/** What the first message of a fresh chain adds after the request: everything already turned back. */
export function freshStartNote(attempts: readonly TurnedBack[]): string {
  return [
    "Already tried and turned back — do not send these again; find another way:",
    ...attempts.map((a) => `- ${a.tried} — ${a.reason}`),
  ].join("\n");
}
