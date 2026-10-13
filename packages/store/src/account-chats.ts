// Your Studio conversations, kept on your ACCOUNT (#283).
//
// The Studio keeps each app's conversation on the device it happened on (`studio-chat` in the shell).
// This is how it follows you to your other devices: the same mechanism as the list of your apps
// (`account-apps.ts`) — a map owned by a group whose only member is your account, its id kept on the
// account itself, so it is encrypted to you and to nobody else and any device that is you can reach
// it. NEVER the app's shared space: the people you share an app with are members of that, and what
// you said to the Studio about it is yours. Sharing a conversation stays the opt-in on export.
//
// One key per message, `<appId>\0<messageId>` → the message as JSON. Messages are only ever added,
// so two devices that each said something offline merge by keeping both: different keys never
// collide, and the same message written twice is one key. A message forgotten — its app was deleted
// — becomes an empty value, so a device that has not heard yet cannot put it back.

/** One message as it is stored here: whatever the Studio keeps, with its id. */
export type AccountChatMessage = { id: string } & Record<string, unknown>;

export interface AccountChat {
  messages: AccountChatMessage[];
  /** Ids of messages forgotten on another device. */
  removed: string[];
}

/** The key on the account CoMap pointing at the conversations. */
const CHATS = "potyroChats";
const SEP = "\u0000";

interface CoMapish {
  id: string;
  get(key: string): unknown;
  set(key: string, value: unknown, privacy?: string): void;
  keys(): string[];
}

interface Nodeish {
  expectCurrentAccount(hint: string): Promise<CoMapish>;
  load(id: string): Promise<CoMapish | "unavailable">;
  createGroup(): { id: string; createMap(): CoMapish };
}

/**
 * The conversations map, as far as it has arrived — created the first time something is written.
 *
 * Named on the account but not here yet means wait (up to `waitMs`), and never make another: a
 * second map would split the conversations in two. If two devices DO each make one while offline,
 * the account keeps one; the other device's messages are still in its own Studio, and it writes them
 * again into the one that won the next time it syncs.
 */
async function chats(node: Nodeish, create: boolean, waitMs: number): Promise<CoMapish | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const account = await node.expectCurrentAccount("potyro chats");
    const id = account.get(CHATS);
    if (typeof id !== "string") {
      // Not named on the account this device holds — which, once a device is you, is the account as
      // it is: nothing was ever said. Made now, not after a wait: a page closed during one would
      // leave what was just said unsent.
      if (!create) return null;
      const map = node.createGroup().createMap();
      account.set(CHATS, map.id, "private");
      return map;
    }
    const loaded = await node.load(id);
    if (loaded && loaded !== "unavailable") return loaded;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

const keyOf = (appId: string, id: string): string => `${appId}${SEP}${id}`;

function parse(raw: unknown, id: string): AccountChatMessage | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>), id } : null;
  } catch {
    return null;
  }
}

/**
 * One app's conversation as your account holds it. Empty when nothing was said, or the map has not
 * arrived within `waitMs` — a device just signed in reads before the relay's copy reaches it.
 */
export async function readAccountChat(node: unknown, appId: string, opts?: { waitMs?: number }): Promise<AccountChat> {
  try {
    const map = await chats(node as Nodeish, false, opts?.waitMs ?? 0);
    if (!map) return { messages: [], removed: [] };
    const prefix = keyOf(appId, "");
    const messages: AccountChatMessage[] = [];
    const removed: string[] = [];
    for (const key of map.keys()) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      const raw = map.get(key);
      if (raw === "") removed.push(id);
      else {
        const message = parse(raw, id);
        if (message) messages.push(message);
      }
    }
    return { messages, removed };
  } catch {
    return { messages: [], removed: [] };
  }
}

/** Add messages to an app's conversation on your account. One already there, or forgotten, is left. */
export async function publishChatMessages(node: unknown, appId: string, messages: readonly AccountChatMessage[], opts?: { waitMs?: number }): Promise<boolean> {
  try {
    if (!messages.length) return true;
    const map = await chats(node as Nodeish, true, opts?.waitMs ?? 0);
    if (!map) return false;
    for (const { id, ...rest } of messages) {
      const key = keyOf(appId, id);
      if (map.get(key) !== undefined) continue; // there, or forgotten: messages never change
      map.set(key, JSON.stringify(rest), "private");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Call `onChange` whenever your account's conversations change — another of your devices said
 * something — including the moment the map first arrives on this device. Returns the way to stop.
 */
export async function watchAccountChats(node: unknown, onChange: () => void): Promise<() => void> {
  const stops: Array<() => void> = [];
  let watching: string | null = null;
  try {
    const n = node as Nodeish;
    const account = (await n.expectCurrentAccount("potyro chats")) as CoMapish & Partial<Subscribable>;
    const attach = async (): Promise<void> => {
      const id = account.get(CHATS);
      if (typeof id !== "string" || id === watching) return;
      const map = await n.load(id);
      if (!map || map === "unavailable" || watching === id) return;
      watching = id;
      const sub = (map as CoMapish & Partial<Subscribable>).subscribe;
      if (typeof sub === "function") stops.push(sub.call(map, () => onChange()));
      onChange();
    };
    if (typeof account.subscribe === "function") stops.push(account.subscribe.call(account, () => void attach().catch(() => {})));
    await attach();
  } catch {
    // Nothing to watch: the conversation still syncs whenever the Studio opens.
  }
  return () => {
    for (const stop of stops.splice(0)) stop();
  };
}

interface Subscribable {
  subscribe(listener: (value: unknown) => void): () => void;
}

/** Forget messages — their app was deleted — on every device of yours. */
export async function removeChatMessages(node: unknown, appId: string, ids: readonly string[]): Promise<boolean> {
  try {
    if (!ids.length) return true;
    const map = await chats(node as Nodeish, false, 0);
    if (!map) return true; // nothing was ever kept there
    for (const id of ids) map.set(keyOf(appId, id), "", "private");
    return true;
  } catch {
    return false;
  }
}
