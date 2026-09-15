// Who is in a shared app, and — for its owner — inviting and removing them (#58).
//
// A space's membership used to be visible only as initials on a tile and names in chat, and nothing
// could remove anyone: access, once given, could never be taken back. This lists everyone with
// their role; the owner can invite someone to edit or only to view, and remove a person. Removal
// revokes their role, rotates the space's key so nothing new reaches them, and revokes the links
// shared before (see `removeSpaceMember`) — the confirm says all of that in words.

import { useEffect, useState } from "react";
import { personHue, personInitials } from "@karta/runtime";
import { shellDialogs } from "./dialog.js";

type Role = "admin" | "writer" | "reader";
interface Member {
  id: string;
  name: string;
  role: Role;
}

const ROLE_WORDS: Record<Role, string> = {
  admin: "Owner · can invite and remove people",
  writer: "Can edit",
  reader: "Can view",
};

export function PeoplePanel({ appId, appName, meId, onClose, toast }: { appId: string; appName: string; meId?: string; onClose: () => void; toast: (msg: string) => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [myRole, setMyRole] = useState<Role>("reader");
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    void (async () => {
      const { currentSpace, onSpaceChange } = await import("./open-store.js");
      const refresh = async (): Promise<void> => {
        const space = await currentSpace().catch(() => null);
        if (!alive || !space) return;
        setMembers(space.members);
        setMyRole(space.role);
      };
      await refresh();
      stop = onSpaceChange(() => void refresh());
    })();
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  const owner = members?.find((m) => m.role === "admin");
  const isOwner = myRole === "admin";

  const remove = async (m: Member): Promise<void> => {
    const first = m.name.split(/\s+/)[0] ?? m.name;
    const ok = await shellDialogs.confirm(`Remove ${m.name}?`, {
      detail:
        `${first} can no longer open or change “${appName}”, and won’t receive anything new. What’s already on ${first}’s devices stays there. ` +
        "Links you shared before stop working — share again to invite someone new.",
      ok: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { removeMember, currentSpace } = await import("./open-store.js");
      await removeMember(m.id);
      const space = await currentSpace();
      if (space) setMembers(space.members);
      toast(`Removed ${m.name}`);
    } catch (e) {
      await shellDialogs.confirm(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const invite = async (role: "writer" | "reader"): Promise<void> => {
    setBusy(true);
    try {
      const { createShareLink } = await import("./share-sync.js");
      const link = await createShareLink(appId, role);
      setInviting(false);
      await shellDialogs.share(
        role === "writer" ? "Send this link. Whoever opens it joins your app and can change it." : "Send this link. Whoever opens it can see your app, but not change it.",
        link,
      );
    } catch (e) {
      await shellDialogs.confirm(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k-modal-scrim" onClick={onClose}>
      <div className="k-modal k-people" role="dialog" aria-modal="true" aria-label="People" onClick={(e) => e.stopPropagation()}>
        <header className="k-people-head">
          <h2>People</h2>
          <button type="button" className="k-add" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <p className="k-muted">Everyone who can open “{appName}”.</p>
        {members === null ? <p className="k-loading">Loading…</p> : null}
        <ul className="k-people-list">
          {(members ?? []).map((m) => (
            <li key={m.id} className="k-people-row">
              <span className="k-person-avatar" aria-hidden style={{ ["--k-hue" as string]: personHue(m.id) }}>
                {personInitials(m.name, m.id)}
              </span>
              <span className="k-people-who">
                <b>
                  {m.name}
                  {m.id === meId ? " (you)" : ""}
                </b>
                <span className="k-muted">{ROLE_WORDS[m.role]}</span>
              </span>
              {isOwner && m.id !== meId && m.role !== "admin" ? (
                <button type="button" className="k-add k-people-remove" disabled={busy} onClick={() => void remove(m)}>
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {isOwner ? (
          inviting ? (
            <div className="k-people-invite" role="group" aria-label="Invite someone">
              <span className="k-muted">What can they do?</span>
              <button type="button" className="k-add k-primary-action" disabled={busy} onClick={() => void invite("writer")}>
                Can edit
              </button>
              <button type="button" className="k-add" disabled={busy} onClick={() => void invite("reader")}>
                Can view
              </button>
            </div>
          ) : (
            <button type="button" className="k-add k-primary-action k-people-invite-btn" disabled={busy} onClick={() => setInviting(true)}>
              ＋ Invite someone
            </button>
          )
        ) : members ? (
          <p className="k-muted">Only {owner?.name ?? "the person who created this app"}, who created this app, can invite or remove people.</p>
        ) : null}
      </div>
    </div>
  );
}
