// "Include how this app was made?" — the one question before a conversation leaves the device (#261).
//
// The Studio conversation is the full history of how an app came to be, and the owner's decision is
// that it is worth giving away with the app — but only when the person says so, every time, because
// it is their own words going to someone else. Nothing asked means nothing sent: an app with no
// conversation, or a person who says no, sends the app alone.

import { exportChat, type ChatRecord } from "./studio-chat.js";
import { t } from "@lingui/core/macro";
import { shellDialogs } from "./dialog.js";

export async function askToIncludeChat(appId: string): Promise<ChatRecord | undefined> {
  const record = await exportChat(appId);
  if (!record.messages.some((m) => m.kind === "ask")) return undefined;
  const yes = await shellDialogs.confirm(t`Include how this app was made?`, {
    detail: t`The conversation from the Studio goes with it — everything you asked for, in your own words, and the answers. Whoever opens the file can read it.`,
    ok: t`Include it`,
    cancel: t`Leave it out`,
  });
  return yes ? record : undefined;
}
