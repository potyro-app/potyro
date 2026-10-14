// Unfinished apps on the home screen (#261): conversations in the Studio that never made an app.
//
// A conversation is kept from its first message, so one you leave — the agent asked something and
// you went to think about it — is still there. Without a way back to it from the home screen it
// would be kept and unreachable, which is worse than not keeping it. It stays until you delete it.

import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";
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

/** "2 hours ago", "yesterday", in the person's language. Under a minute is "now". */
function ago(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  // Rounded down to the minute, so a conversation from seconds ago does not read "in 0 minutes".
  return fmt.relative(Math.abs(now - then) < 60_000 ? now : then, now);
}

export function DraftStrip({ onResume }: { onResume: (id: string) => void }) {
  const { t } = useLingui();
  const drafts = useDrafts();
  if (!drafts.length) return null;
  const remove = async (d: DraftChat): Promise<void> => {
    const title = d.title;
    if (
      await shellDialogs.confirm(t`Delete “${title}”?`, {
        detail: t`The conversation goes. Nothing was made from it yet.`,
        ok: t`Delete`,
        destructive: true,
      })
    ) {
      await clearChat(d.id);
    }
  };
  return (
    <section className="k-launch-section k-drafts" aria-labelledby="k-launch-drafts">
      <h3 className="k-launch-title" id="k-launch-drafts">
        <Trans comment="Launcher: Studio conversations that have not made an app yet">Unfinished</Trans>
      </h3>
      <ul className="k-drafts-list">
        {drafts.map((d) => (
          <li key={d.id} className="k-draft">
            <button type="button" className="k-draft-open" onClick={() => onResume(d.id)} aria-label={t`Continue “${d.title}”`}>
              <span className="k-draft-mark" aria-hidden>
                ✦
              </span>
              <span className="k-draft-title">{d.title}</span>
              <span className="k-draft-when">{ago(d.updatedAt)}</span>
            </button>
            <button type="button" className="k-draft-del" aria-label={t`Delete “${d.title}”`} title={t`Delete`} onClick={() => void remove(d)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
