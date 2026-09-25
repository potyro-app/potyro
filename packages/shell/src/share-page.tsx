// "Bring this into…" (#213): text shared into Karta from another app — a plan, a list, a table
// another AI made — and the person picking which of their apps it goes into. The best fits come
// first (share-inbox.ts `bestFits`, judged on this device); the person picks either way. Picking
// opens that app with its Ask filled in, where the same review as any Ask decides what is added.

import { useMemo, useState, type CSSProperties } from "react";
import { useInstalledApps } from "./launcher-store.js";
import { tileIdentity } from "./tile-identity.js";
import { listUserApps } from "./user-apps.js";
import { bestFits, dropShare, handShareTo, peekShare } from "./share-inbox.js";
import { navigateTo } from "./router.js";

const PREVIEW = 420;

export function SharePage() {
  const [share] = useState(peekShare);
  const [full, setFull] = useState(false);
  const installed = useInstalledApps();
  const fits = useMemo(() => (share ? bestFits(listUserApps().map((a) => ({ id: a.id, name: a.name, source: a.source })), share.text) : []), [share]);
  const apps = useMemo(() => {
    const rank = (id: string) => (fits.indexOf(id) < 0 ? Number.MAX_SAFE_INTEGER : fits.indexOf(id));
    return [...installed].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  }, [installed, fits]);

  if (!share) {
    return (
      <main className="k-share-page">
        <h1 className="k-share-title">Nothing to bring in</h1>
        <p className="k-muted">Share text to Karta from another app and it will wait here for you to pick where it goes.</p>
        <button type="button" className="k-add" onClick={() => navigateTo({ kind: "home" })}>
          Go to your apps
        </button>
      </main>
    );
  }

  const long = share.text.length > PREVIEW;
  return (
    <main className="k-share-page">
      <p className="k-ask-eyebrow">Shared with Karta</p>
      <h1 className="k-share-title">Bring this into…</h1>
      <figure className="k-share-preview">
        {share.title ? <figcaption>{share.title}</figcaption> : null}
        <pre>{full || !long ? share.text : `${share.text.slice(0, PREVIEW)}…`}</pre>
        {long ? (
          <button type="button" className="k-ask-more" onClick={() => setFull((v) => !v)}>
            {full ? "Show less" : "Show all of it"}
          </button>
        ) : null}
      </figure>
      <ul className="k-share-apps" aria-label="Your apps">
        {apps.map((app, i) => {
          const identity = tileIdentity({ key: app.key, name: app.name, icon: app.icon, accent: app.accent, hue: app.entry.hue });
          const best = i === 0 && fits[0] === app.id;
          return (
            <li key={app.key}>
              <button
                type="button"
                className="k-share-app"
                data-best={best || undefined}
                style={{ "--tile-accent": identity.accent } as CSSProperties}
                onClick={() => {
                  handShareTo(app.id);
                  navigateTo({ kind: "user", id: app.id });
                }}
              >
                <span className="k-launch-avatar" data-kind={identity.kind} aria-hidden>
                  {identity.glyph}
                </span>
                <span className="k-share-app-name">{app.name}</span>
                {best ? <span className="k-ask-badge" data-tone="good">Best fit</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="k-ask-off"
        onClick={() => {
          dropShare();
          navigateTo({ kind: "home" });
        }}
      >
        Don’t add it
      </button>
    </main>
  );
}
