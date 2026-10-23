// "Bring this into" (#213): text shared into Potyro from another app — a plan, a list, a table
// another AI made — and the person picking which of their apps it goes into. The best fits come
// first (share-inbox.ts `bestFits`, judged on this device); the person picks either way. Picking
// opens that app with its Ask filled in, where the same review as any Ask decides what is added.

import { useMemo, useState, type CSSProperties } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useInstalledApps } from "./launcher-store.js";
import { tileIdentity } from "./tile-identity.js";
import { TileGlyph } from "./tile-glyph.js";
import { listUserApps } from "./user-apps.js";
import { bestFits, dropShare, handShareTo, peekShare } from "./share-inbox.js";
import { navigateTo } from "./router.js";

const PREVIEW = 420;

export function SharePage() {
  const { t } = useLingui();
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
        <h1 className="k-share-title">
          <Trans>Nothing to bring in</Trans>
        </h1>
        <p className="k-muted">
          <Trans>Share text to Potyro from another app and it will wait here for you to pick where it goes.</Trans>
        </p>
        <button type="button" className="k-add" onClick={() => navigateTo({ kind: "home" })}>
          <Trans>Go to your apps</Trans>
        </button>
      </main>
    );
  }

  const long = share.text.length > PREVIEW;
  return (
    <main className="k-share-page">
      <p className="k-ask-eyebrow">
        <Trans>Shared with Potyro</Trans>
      </p>
      <h1 className="k-share-title">
        <Trans comment="Heading over a list of your apps: pick which one the shared text goes into">Bring this into</Trans>
      </h1>
      <figure className="k-share-preview">
        {share.title ? <figcaption>{share.title}</figcaption> : null}
        <pre>{full || !long ? share.text : `${share.text.slice(0, PREVIEW)}…`}</pre>
        {long ? (
          <button type="button" className="k-ask-more" onClick={() => setFull((v) => !v)}>
            {full ? t`Show less` : t`Show all of it`}
          </button>
        ) : null}
      </figure>
      <ul className="k-share-apps" aria-label={t`Your apps`}>
        {apps.map((app, i) => {
          const identity = tileIdentity({ key: app.key, name: app.name, icon: app.icon, image: app.image, accent: app.accent, hue: app.entry.hue });
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
                  <TileGlyph identity={identity} size={24} />
                </span>
                <span className="k-share-app-name">{app.name}</span>
                {best ? <span className="k-ask-badge" data-tone="good">
                    <Trans comment="Badge on the app the shared text suits best">Best fit</Trans>
                  </span> : null}
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
        <Trans>Don’t add it</Trans>
      </button>
    </main>
  );
}
