// Placeholder people in the People panel, and the question someone who joins is asked (docs/04 §Guests).
//
// A guest is "Tom", named before Tom joined, so the group could be set up first. The panel lists them
// under the members — anyone who can change the app adds one; whoever added it (or the owner) renames,
// removes, or says it is the same person as someone else. Whoever joins is asked once whether they
// are one of them; "That's me" makes every record naming the guest name them, and stays in the panel
// for whoever said "not now".

import { useEffect, useState, useSyncExternalStore } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { personHue, personInitials } from "@potyro/runtime";
import type { GuestBook } from "@potyro/host";
import type { Person } from "potyro";
import { ActionMenu, type MenuEntry } from "@potyro/views";
import { shellDialogs } from "./dialog.js";

/** Re-render when the guests change, from anyone. */
function useGuests(book: GuestBook): number {
  const [version, setVersion] = useState(0);
  useEffect(() => book.onChange(() => setVersion((v) => v + 1)), [book]);
  return version;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function GuestsSection({ book, others, nameOf, appName, toast }: { book: GuestBook; others: readonly Person[]; nameOf: (id: string) => string; appName: string; toast: (msg: string) => void }) {
  const { t } = useLingui();
  useGuests(book);
  const [linking, setLinking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guests = book.open();
  const mine = book.mine();
  const canWrite = book.canWrite();

  const run = async (work: () => Promise<void>, done?: string): Promise<void> => {
    setBusy(true);
    try {
      await work();
      if (done) toast(done);
    } catch (e) {
      await shellDialogs.confirm(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    const asked = await shellDialogs.prompt(t({ message: "Their name", comment: "Prompt: the name of someone who has not joined a shared app yet" }));
    const name = asked?.trim();
    if (name) await run(async () => void (await book.add(name)), t`Added ${name}`);
  };
  const rename = async (g: Person): Promise<void> => {
    const name = g.name;
    const asked = await shellDialogs.prompt(t`Rename ${name}`, { default: name });
    if (asked?.trim() && asked.trim() !== name) await run(() => book.rename(g.id, asked));
  };
  const remove = async (g: Person): Promise<void> => {
    const name = g.name;
    const ok = await shellDialogs.confirm(t`Take ${name} off the list?`, {
      detail: t`What already names ${name} keeps the name. Nobody can say they are ${name} any more.`,
      ok: t({ message: "Remove", comment: "Button: remove a guest (someone who has not joined) from a shared app" }),
      destructive: true,
    });
    if (ok) await run(() => book.remove(g.id));
  };
  const claim = async (g: Person): Promise<void> => {
    const name = g.name;
    const ok = await shellDialogs.confirm(t`Are you ${name}?`, {
      detail: t`Everything in “${appName}” that names ${name} will name you instead.`,
      ok: t({ message: "That’s me", comment: "Button: say you are the placeholder person someone named before you joined" }),
    });
    if (ok) await run(() => book.claim(g.id), t`You’re ${name} in “${appName}” now`);
  };

  const menu = (g: Person): MenuEntry[] => {
    const entries: MenuEntry[] = [];
    if (!mine && canWrite) entries.push({ key: "claim", label: t({ message: "That’s me", comment: "Menu: say you are the placeholder person someone named before you joined" }), icon: "🙋", onSelect: () => void claim(g) });
    if (book.canManage(g.id)) {
      entries.push({ key: "rename", label: t({ message: "Rename", comment: "Menu: rename a guest" }), icon: "✎", onSelect: () => void rename(g) });
      if (others.length) entries.push({ key: "link", label: t`Same person as…`, icon: "⇄", onSelect: () => setLinking(g.id) });
      entries.push("separator", { key: "remove", label: t({ message: "Remove", comment: "Menu: remove a guest from a shared app" }), danger: true, onSelect: () => void remove(g) });
    }
    return entries;
  };

  return (
    <section className="k-guests" aria-label={t`Not joined yet`}>
      {guests.length ? (
        <>
          <h3 className="k-guests-head">
            <Trans comment="People panel: heading over the placeholder people">Not joined yet</Trans>
          </h3>
          <ul className="k-people-list">
            {guests.map((g) => {
              const entries = menu(g);
              const by = nameOf(book.entry(g.id)?.by ?? "");
              const name = g.name;
              return (
                <li key={g.id} className="k-people-row" data-guest>
                  <span className="k-person-avatar k-guest-avatar" aria-hidden style={{ ["--k-hue" as string]: personHue(g.id) }}>
                    {personInitials(g.name, g.id)}
                  </span>
                  <span className="k-people-who">
                    <b>{g.name}</b>
                    <span className="k-muted">{t`Added by ${by}`}</span>
                  </span>
                  {linking === g.id ? (
                    <LinkPicker
                      guest={g}
                      choices={[...others, ...guests.filter((x) => x.id !== g.id)]}
                      busy={busy}
                      onCancel={() => setLinking(null)}
                      onPick={(to) =>
                        void run(async () => {
                          await book.link(g.id, to.id);
                          setLinking(null);
                        }, sameNow(t, name, to.name))
                      }
                    />
                  ) : entries.length ? (
                    <ActionMenu label={t`What about ${name}?`} title={name} entries={entries} buttonClassName="k-add k-guest-menu" busy={busy} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {canWrite ? (
        <button type="button" className="k-add k-guest-add" disabled={busy} onClick={() => void add()}>
          ＋ <Trans>Add someone who hasn’t joined</Trans>
        </button>
      ) : null}
    </section>
  );
}

function sameNow(t: ReturnType<typeof useLingui>["t"], name: string, other: string): string {
  return t`${name} is ${other} now`;
}

function LinkPicker({ guest, choices, busy, onPick, onCancel }: { guest: Person; choices: readonly Person[]; busy: boolean; onPick: (p: Person) => void; onCancel: () => void }) {
  const { t } = useLingui();
  const name = guest.name;
  const [to, setTo] = useState(choices[0]?.id ?? "");
  const chosen = choices.find((c) => c.id === to);
  return (
    <span className="k-guest-link" role="group" aria-label={t`${name} is the same person as`}>
      <select className="k-input" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t`${name} is the same person as`}>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button type="button" className="k-add k-primary-action" disabled={busy || !chosen} onClick={() => chosen && onPick(chosen)}>
        <Trans comment="Button: confirm that two people are the same">Same person</Trans>
      </button>
      <button type="button" className="k-add" onClick={onCancel}>
        <Trans>Cancel</Trans>
      </button>
    </span>
  );
}

const askedKey = (appId: string): string => `potyro:guest-asked:${appId}`;

function alreadyAsked(appId: string): boolean {
  try {
    return localStorage.getItem(askedKey(appId)) === "1";
  } catch {
    return false;
  }
}

function rememberAsked(appId: string): void {
  try {
    localStorage.setItem(askedKey(appId), "1");
  } catch {
    // Asked again next time, which is the lesser harm.
  }
}

/** Whether someone opening a shared app should be asked if they are one of its guests. */
export function shouldAskClaim(book: GuestBook, meId: string, appId: string): boolean {
  if (alreadyAsked(appId) || !book.canWrite() || book.mine()) return false;
  // Guests you added yourself are other people: you named them.
  return book.open().some((g) => book.entry(g.id)?.by !== meId);
}

/**
 * "Are you one of these people?" — asked once, when someone opens a shared app that has guests they
 * did not add. Choosing one claims it; "Not on the list" is remembered on this device.
 */
export function ClaimPrompt({ book, meId, appId, appName, toast }: { book: GuestBook; meId: string; appId: string; appName: string; toast: (msg: string) => void }) {
  const { t } = useLingui();
  const subscribe = (cb: () => void) => book.onChange(cb);
  const ask = useSyncExternalStore(subscribe, () => book.loaded && shouldAskClaim(book, meId, appId), () => false);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ask || closed) return null;
  const guests = book.open().filter((g) => book.entry(g.id)?.by !== meId);
  const close = (): void => {
    rememberAsked(appId);
    setClosed(true);
  };
  const pick = async (g: Person): Promise<void> => {
    const name = g.name;
    setBusy(true);
    try {
      await book.claim(g.id);
      close();
      toast(t`You’re ${name} in “${appName}” now`);
    } catch (e) {
      await shellDialogs.confirm(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="k-modal-scrim" onClick={close}>
      <div className="k-modal k-people k-claim" role="dialog" aria-modal="true" aria-labelledby="k-claim-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="k-claim-title">
          <Trans>Are you one of these people?</Trans>
        </h2>
        <p className="k-muted">
          <Trans>Someone in “{appName}” named people before they joined. Pick yourself, and everything that names you there is yours.</Trans>
        </p>
        <ul className="k-claim-list">
          {guests.map((g) => (
            <li key={g.id}>
              <button type="button" className="k-claim-pick" disabled={busy} onClick={() => void pick(g)}>
                <span className="k-person-avatar k-guest-avatar" aria-hidden style={{ ["--k-hue" as string]: personHue(g.id) }}>
                  {personInitials(g.name, g.id)}
                </span>
                <b>{g.name}</b>
                <span className="k-claim-me" aria-hidden>
                  <Trans comment="Beside a name: choose to be this person">That’s me</Trans>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="k-add k-claim-none" disabled={busy} onClick={close}>
          <Trans>I’m not on the list</Trans>
        </button>
      </div>
    </div>
  );
}
