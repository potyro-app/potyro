// The Studio's conversation follows you across your own devices (#283).
//
// Each app's conversation lives on the device it happened on (`studio-chat.ts`), and that stays the
// copy the Studio reads. This keeps it in step with your ACCOUNT's copy (`account-chats.ts` in the
// store): a map only your account can read — never the app's shared space, where the people you share
// the app with would see it.
//
// Messages are only ever added, so a merge is a union by id: what this device said and the account
// does not have is sent, what the account has and this device does not is kept here, and a message
// forgotten elsewhere (its app was deleted) goes. Two devices that each said something offline both
// keep everything, in the same order (`n`, then time), the next time each syncs.
//
// Only for an app whose data syncs on this device: an app kept on one device keeps its conversation
// there too. Drafts — conversations that have not made an app yet — stay on their device.
import type { AccountChat, AccountChatMessage } from "@potyro/store";
import { dropMessages, isDraftId, keepMessages, listMessages, readChatMessage, type ChatMessage } from "./studio-chat.js";
import { getUserApp } from "./user-apps.js";

export interface ChatMerge {
  /** From the account, to keep on this device. */
  add: ChatMessage[];
  /** From this device, to send to the account. */
  push: ChatMessage[];
  /** Forgotten elsewhere, to drop here. */
  remove: string[];
}

/** What it takes to bring this device's copy and the account's into step. `chatId` names the app. */
export function mergeChat(local: readonly ChatMessage[], remote: AccountChat, chatId?: string): ChatMerge {
  const removed = new Set(remote.removed);
  const here = new Set(local.map((m) => m.id));
  const there = new Set(remote.messages.map((m) => m.id));
  const add: ChatMessage[] = [];
  for (const raw of remote.messages) {
    if (here.has(raw.id) || removed.has(raw.id)) continue;
    const message = readChatMessage({ ...raw, chatId: chatId ?? raw.chatId });
    if (message) add.push(message);
  }
  return {
    add,
    push: local.filter((m) => !there.has(m.id) && !removed.has(m.id)),
    remove: local.filter((m) => removed.has(m.id)).map((m) => m.id),
  };
}

export interface ChatSyncDeps {
  /** This device's node on your account, or null where it has none (no identity, no sync). */
  node: () => Promise<unknown | null>;
  read: (node: unknown, appId: string, opts?: { waitMs?: number }) => Promise<AccountChat>;
  publish: (node: unknown, appId: string, messages: readonly AccountChatMessage[], opts?: { waitMs?: number }) => Promise<boolean>;
}

/** How long to wait for the account's copy to arrive: a device just signed in reads before it has. */
const WAIT_MS = 3_000;

async function liveDeps(): Promise<ChatSyncDeps> {
  const [{ readAccountChat, publishChatMessages }, { accountNode }] = await Promise.all([import("@potyro/store"), import("./open-store.js")]);
  return { node: accountNode, read: readAccountChat, publish: publishChatMessages };
}

/** Whether this app's conversation goes to your account: only when its data syncs on this device. */
async function follows(appId: string): Promise<boolean> {
  if (isDraftId(appId)) return false;
  const app = getUserApp(appId);
  if (!app?.sync) return false;
  const { syncAllowedFor } = await import("./app-store.js");
  return syncAllowedFor(app);
}

/**
 * Bring an app's conversation on this device and on your account into step. True when this device's
 * copy changed, so the Studio reads it again. Best-effort: never throws, and never loses a message —
 * one that could not be sent is sent next time, because it is still missing there.
 */
export async function syncChat(appId: string, deps?: ChatSyncDeps): Promise<boolean> {
  try {
    if (!(await follows(appId))) return false;
    const d = deps ?? (await liveDeps());
    const node = await d.node();
    if (!node) return false;
    const merged = mergeChat(await listMessages(appId), await d.read(node, appId, { waitMs: WAIT_MS }), appId);
    if (merged.add.length) await keepMessages(merged.add);
    if (merged.remove.length) await dropMessages(merged.remove);
    if (merged.push.length) {
      // The key on the account names the app; the message is the rest.
      const out = merged.push.map(({ chatId: _app, ...rest }) => rest as AccountChatMessage);
      await d.publish(node, appId, out, { waitMs: WAIT_MS });
    }
    return merged.add.length > 0 || merged.remove.length > 0;
  } catch (e) {
    console.warn("[potyro] could not sync the studio conversation:", e);
    return false;
  }
}

/**
 * While the Studio has an app open: whenever your account's conversations change — another of your
 * devices said something, or the map has only now arrived here — sync this app's, and call
 * `onChange` when this device's copy changed. Returns the way to stop. A no-op for an app whose
 * conversation does not follow you.
 */
export function followChat(appId: string, onChange: () => void): () => void {
  let stopped = false;
  let stop: () => void = () => {};
  let running: Promise<void> | null = null;
  let again = false;
  const pull = (): void => {
    if (running) {
      again = true;
      return;
    }
    running = syncChat(appId)
      .then((changed) => {
        if (changed && !stopped) onChange();
      })
      .finally(() => {
        running = null;
        if (again && !stopped) {
          again = false;
          pull();
        }
      });
  };
  void (async () => {
    if (!(await follows(appId))) return;
    const [{ watchAccountChats }, { accountNode }] = await Promise.all([import("@potyro/store"), import("./open-store.js")]);
    const node = await accountNode();
    if (!node || stopped) return;
    const unwatch = await watchAccountChats(node, pull);
    if (stopped) unwatch();
    else stop = unwatch;
  })().catch((e: unknown) => console.warn("[potyro] could not follow the studio conversation:", e));
  return () => {
    stopped = true;
    stop();
  };
}

/**
 * Every synced app's conversation, at boot, through the node boot already opened: what this device
 * said and had not sent yet — the page was closed straight after — goes now, and what your other
 * devices said is here before the Studio is opened. Background; never holds anything up.
 */
export async function syncAllChats(node: unknown): Promise<void> {
  const [{ readAccountChat, publishChatMessages }, { listUserApps }] = await Promise.all([import("@potyro/store"), import("./user-apps.js")]);
  const deps: ChatSyncDeps = { node: async () => node, read: readAccountChat, publish: publishChatMessages };
  for (const app of listUserApps()) if (app.sync) await syncChat(app.id, deps);
}

/** Forget a conversation on your account too — its app was deleted. */
export async function forgetChat(
  appId: string,
  ids: readonly string[],
  deps?: { node: () => Promise<unknown | null>; remove: (node: unknown, appId: string, ids: readonly string[]) => Promise<boolean> },
): Promise<void> {
  if (isDraftId(appId) || !ids.length) return;
  try {
    let d = deps;
    if (!d) {
      const [store, open] = await Promise.all([import("@potyro/store"), import("./open-store.js")]);
      d = { node: open.accountNode, remove: store.removeChatMessages };
    }
    const node = await d.node();
    if (node) await d.remove(node, appId, ids);
  } catch (e) {
    console.warn("[potyro] could not forget the studio conversation on your account:", e);
  }
}
