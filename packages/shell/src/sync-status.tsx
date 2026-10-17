// "Is this actually syncing?" — answered in the header, not in devtools.
//
// Sync that gives no feedback is untestable by a user: with nothing on screen, a working relay and
// a dead one look identical, and the only way to tell them apart was the network tab. This watches
// the relay socket directly, so it reports the transport rather than a guess.

import { useEffect, useState } from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { syncRelayUrl } from "./open-store.js";

type State = "off" | "local" | "connecting" | "synced" | "offline";

const LABEL: Record<Exclude<State, "off">, MessageDescriptor> = {
  local: msg`Sync on · no relay`,
  connecting: msg`Connecting…`,
  synced: msg({ message: "Synced", comment: "Header status: this app's data reaches the relay" }),
  offline: msg`Offline · changes saved here`,
};

/**
 * Let go of a probe without an error in the console. Firefox writes two ("can't establish a
 * connection", "interrupted while the page was loading") for every `close()` on a socket still
 * CONNECTING — the header unmounting mid-probe, or React's dev double mount — although nothing is
 * wrong. A probe still opening is closed the moment it opens instead; it has no listeners left.
 */
export function dropProbe(ws: Pick<WebSocket, "readyState" | "close" | "onopen" | "onerror">): void {
  ws.onerror = null;
  if (ws.readyState === 0) ws.onopen = () => ws.close();
  else (ws.onopen = null), ws.close();
}

/**
 * Probes the relay with its own short-lived socket rather than reading cojson's peer state.
 *
 * cojson does not surface a stable "is this peer up" signal, and a wrong-but-confident indicator is
 * worse than none — it is the thing a user would trust when deciding whether their data is safe.
 * A probe can only be honest about what it observed.
 */
export function SyncStatus({ sync }: { sync?: boolean }) {
  const { t } = useLingui();
  const [state, setState] = useState<State>(sync ? "connecting" : "off");

  useEffect(() => {
    if (!sync) return setState("off");
    const url = syncRelayUrl();
    if (!url) return setState("local");

    let alive = true;
    let socket: WebSocket | null = null;
    const probe = (): void => {
      if (!alive) return;
      if (!navigator.onLine) return setState("offline");
      try {
        socket = new WebSocket(url);
        socket.onopen = () => {
          if (alive) setState("synced");
          socket?.close();
        };
        socket.onerror = () => alive && setState("offline");
      } catch {
        if (alive) setState("offline");
      }
    };
    probe();
    const timer = setInterval(probe, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
      if (socket) dropProbe(socket);
    };
  }, [sync]);

  if (state === "off") return null;
  const label = t(LABEL[state]);
  return (
    <span className="k-sync-status" data-state={state} title={label} aria-live="polite">
      <span className="k-sync-icon" aria-hidden>
        {state === "synced" ? "⇄" : state === "connecting" ? "◌" : "⇄̸"}
      </span>
      {/* Its own element so a phone's top bar can show the icon alone and keep the words for a
          screen reader and the tooltip: "Offline · changes saved here" beside an app's name and the
          menu is wider than a phone. */}
      <span className="k-sync-label">{label}</span>
    </span>
  );
}
