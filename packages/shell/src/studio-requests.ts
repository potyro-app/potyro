// The Studio's side of requests to the Potyro team (#263): what the thread's cards call, and the
// requests kept on this device being sent once the relay can be reached.
//
// Kept out of studio.tsx so the screen only wires it: `answer` attaches the agent's request to the
// message it said (`platformAsk`), the card asks `review` for exactly what would be sent and `send`
// to send it, and every outcome is recorded in the app's conversation as an event carrying the
// request's id — the hook #288's "Potyro can do this now" will look for.

import { useEffect, useMemo } from "react";
import type { PlatformRequest } from "@potyro/generator/agent";
import type { PlatformRequestPayload } from "@potyro/platform-requests";
import { appendMessage, type NewMessage, type PlatformAsk } from "./studio-chat.js";
import { buildRequest, newRequestId, sendPlatformRequest, sendSaved, sentLine } from "./platform-requests.js";
import { currentLocale } from "./locale.js";

/** The agent's request, as the conversation keeps it: with the id it will be sent under. */
export function platformAsk(request: PlatformRequest | undefined): { platform: PlatformAsk } | Record<string, never> {
  return request ? { platform: { id: newRequestId(), title: request.title, body: request.body } } : {};
}

export interface StudioRequestsDeps {
  /** The conversation the cards are in, and the app as it is now. */
  chatId: () => string;
  source: () => string | null;
  appName: () => string | undefined;
  say: (message: NewMessage) => Promise<void>;
  /** Read the conversation again: a request kept earlier was sent in the background. */
  refresh: () => Promise<void>;
}

export function useStudioRequests(deps: StudioRequestsDeps): {
  review: (ask: PlatformAsk) => Promise<PlatformRequestPayload>;
  send: (ask: PlatformAsk, payload: PlatformRequestPayload) => Promise<void>;
} {
  // The ones kept for later go when the Studio opens and the relay answers; each says so in its own app's conversation.
  useEffect(() => {
    void sendSaved(async (chatId, payload, url) => {
      await appendMessage(chatId, { kind: "event", text: sentLine(payload.title, { state: "sent", url }), request: { id: payload.id, state: "sent", ...(url ? { url } : {}) } }, new Date().toISOString());
    }).then(deps.refresh, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useMemo(
    () => ({
      review: (ask: PlatformAsk) => buildRequest(ask, { source: deps.source() ?? "", app: deps.appName(), language: currentLocale() }),
      send: async (ask: PlatformAsk, payload: PlatformRequestPayload) => {
        const result = await sendPlatformRequest(payload, deps.chatId());
        await deps.say({
          kind: "event",
          text: sentLine(ask.title, result),
          ...(result.state === "refused" ? {} : { request: { id: ask.id, state: result.state, ...(result.state === "sent" && result.url ? { url: result.url } : {}) } }),
        });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
