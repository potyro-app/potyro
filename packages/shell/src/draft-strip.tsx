// Unfinished apps on the home screen (#261): conversations in the Studio that never made an app.
//
// A conversation is kept from its first message, so one you leave — the agent asked something and
// you went to think about it — is still there. Without a way back to it from the home screen it
// would be kept and unreachable, which is worse than not keeping it. It stays until you delete it.

import { useEffect, useState } from "react";
import { clearChat, listDrafts, STUDIO_CHAT_CHANGED, type DraftChat } from "./studio-chat.js";
import { shellDialogs } from "./dialog.js";

function useDrafts(): DraftChat[] {
  const [drafts, setDrafts] = useState<DraftChat[]>([]);
  useEffect(() => {
    let alive = true;
    const load = (): void => void listDrafts().then((d) => alive && setDrafts(d));
    load();
    globalThis.addEventListener(STUDIO_CHAT_CHANGED, load);
    return () => {
      alive = false;
      globalThis.removeEventListener(STUDIO_CHAT_CHANGED, load);
    };
  }, []);
  return drafts;
}

/** "2 hours ago", in the person's words. */
function ago(iso: string, now = Date.now()): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function DraftStrip({ onResume }: { onResume: (id: string) => void }) {
  const drafts = useDrafts();
  if (!drafts.length) return null;
  const remove = async (d: DraftChat): Promise<void> => {
    if (await shellDialogs.confirm(`Delete “${d.title}”?`, { detail: "The conversation goes. Nothing was made from it yet.", ok: "Delete", destructive: true })) {
      await clearChat(d.id);
    }
  };
  return (
    <section className="k-launch-section k-drafts" aria-labelledby="k-launch-drafts">
      <h3 className="k-launch-title" id="k-launch-drafts">
        Unfinished
      </h3>
      <ul className="k-drafts-list">
        {drafts.map((d) => (
          <li key={d.id} className="k-draft">
            <button type="button" className="k-draft-open" onClick={() => onResume(d.id)} aria-label={`Continue “${d.title}”`}>
              <span className="k-draft-mark" aria-hidden>
                ✦
              </span>
              <span className="k-draft-title">{d.title}</span>
              <span className="k-draft-when">{ago(d.updatedAt)}</span>
            </button>
            <button type="button" className="k-draft-del" aria-label={`Delete “${d.title}”`} title="Delete" onClick={() => void remove(d)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
