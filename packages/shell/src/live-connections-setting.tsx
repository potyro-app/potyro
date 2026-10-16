// Edit tile's "Live connections" (docs/28 §3): every place this app was allowed to stay connected to
// on this device — a server, Potyro's rooms, a device on the home network — each with a switch.
// Off closes the app's connections there as soon as the person saves, and the app cannot connect
// there again until they turn it back on (it is not asked again: the switch is the answer). A home
// device also has "Change address": the next connection asks for the address again.
//
// The rows are the person's, kept by app-sockets.ts; this only shows them and hands the changes back.

import { Trans, useLingui } from "@lingui/react/macro";
import type { SocketTarget } from "@potyro/capabilities";
import { setSocketSwitch, socketSwitches } from "./app-sockets.js";

export type LiveChoice = "on" | "off" | "forget";

export interface LiveRow {
  key: string;
  target: SocketTarget;
  /** As it is stored now. */
  was: "on" | "off";
  /** As the person left it. */
  choice: LiveChoice;
}

export function liveRows(appId: string): LiveRow[] {
  return socketSwitches(appId).map((s) => ({ key: s.key, target: s.target, was: s.on ? "on" : "off", choice: s.on ? "on" : "off" }));
}

/** Save what changed: off and forget end the app's open connections there at once. */
export function saveLiveRows(appId: string, rows: readonly LiveRow[]): void {
  for (const r of rows) if (r.choice !== r.was) setSocketSwitch(appId, r.key, r.choice);
}

interface Props {
  rows: readonly LiveRow[];
  onChange: (rows: LiveRow[]) => void;
}

export function LiveConnectionsSetting({ rows, onChange }: Props) {
  const { t } = useLingui();
  if (rows.length === 0) return null;
  const set = (key: string, choice: LiveChoice): void => onChange(rows.map((r) => (r.key === key ? { ...r, choice } : r)));

  const nameOf = (target: SocketTarget): string => ("rooms" in target ? t({ message: "Potyro’s rooms", comment: "Edit tile, Live connections: Potyro's own relay where apps play together" }) : "local" in target ? target.local : target.host);
  const whatOf = (target: SocketTarget): string =>
    "rooms" in target
      ? t({ message: "Rooms where people with the link play or talk together", comment: "Edit tile, Live connections: what Potyro's rooms are" })
      : "local" in target
        ? t({ message: "A device on your home network", comment: "Edit tile, Live connections: a local address like 192.168.1.20" })
        : t({ message: "A server on the internet", comment: "Edit tile, Live connections: a host like stream.binance.com" });

  return (
    <section className="k-tile-editor-live" aria-labelledby="k-tile-editor-live">
      <span className="k-field-label" id="k-tile-editor-live">
        <Trans comment="Tile editor: the places a shared app may keep a live connection to (WebSockets)">Live connections</Trans>
      </span>
      <span className="k-muted">
        <Trans>Where this app may stay connected while it is open. Turn one off to close it now; the app can’t connect there again until you turn it back on.</Trans>
      </span>
      <ul className="k-tile-editor-live-list">
        {rows.map((r) => {
          const name = nameOf(r.target);
          const forgotten = r.choice === "forget";
          return (
            <li key={r.key} className="k-tile-editor-live-row" data-state={r.choice}>
              <label className="k-tile-editor-live-switch">
                <input
                  type="checkbox"
                  role="switch"
                  className="k-switch"
                  checked={r.choice === "on"}
                  disabled={forgotten}
                  aria-label={t`Live connection to ${name}`}
                  onChange={(e) => set(r.key, e.target.checked ? "on" : "off")}
                />
                <span className="k-tile-editor-live-text">
                  <span className="k-tile-editor-live-name">{name}</span>
                  <span className="k-muted">{forgotten ? t`The app will ask for the address again.` : whatOf(r.target)}</span>
                </span>
              </label>
              {"local" in r.target ? (
                forgotten ? (
                  <button type="button" className="k-add k-tile-editor-live-action" onClick={() => set(r.key, r.was)}>
                    <Trans comment="Tile editor: undo 'Change address'">Undo</Trans>
                  </button>
                ) : (
                  <button type="button" className="k-add k-tile-editor-live-action" title={t`Forget this address: the app asks for it again next time`} onClick={() => set(r.key, "forget")}>
                    <Trans comment="Tile editor: forget a home device's address so the app asks for it again">Change address</Trans>
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
