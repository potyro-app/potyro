// Runs that stopped to ask the person something (#75), held until the answer comes.
//
// A question used to END the run: the answer started a new one from a recap of the conversation, and
// everything the model had looked up before asking was gone. A loop's question now carries the run it
// paused (`PausedRun`: the conversation so far, the call waiting for its result). It is held here, by
// the conversation it belongs to, and the answer goes back into it.
//
// In memory only, and on purpose. The transcript holds the whole app and can be large; the question
// itself, with its choices, is kept with the conversation (studio-chat.ts), so after a reload the card
// is still there and answering still works — the run then starts again from the conversation, with the
// question and the answer in its brief (`briefSince`), as every answer did before this. Nothing waits
// here on a timer or a connection: a paused run is data.

import type { PausedRun } from "@potyro/generator/agent";

interface Held {
  run: PausedRun;
  /** The app the run was changing, as it was shown to the model; null for a new app. */
  base: string | null;
}

const held = new Map<string, Held>();

/** Hold the run a question paused, for the conversation it was asked in. */
export function holdPaused(chatId: string, run: PausedRun, base: string | null): void {
  held.set(chatId, { run, base });
}

/**
 * The run to go on with for an answer in this conversation, taken out of the hold — or null when
 * there is none in memory, or the app has changed since it asked (a hand edit, a rollback): its
 * conversation shows an app that is no longer the one being changed.
 */
export function takePaused(chatId: string, base: string | null): PausedRun | null {
  const found = held.get(chatId);
  held.delete(chatId);
  return found && found.base === base ? found.run : null;
}

/** Forget a conversation's paused run: something else was asked, or the conversation is gone. */
export function dropPaused(chatId: string): void {
  held.delete(chatId);
}

/** Whether a run waits on this conversation's answer. */
export const hasPaused = (chatId: string): boolean => held.has(chatId);
