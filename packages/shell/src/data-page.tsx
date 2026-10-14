// The Data page: every app's records on this device, as tables you can read, correct and prune.
//
// Your data is yours to see — not only through whatever screens an app happened to be given. An app
// that shows a total but not the rows behind it, a record stuck behind a filter, a typo in something
// the app has no edit screen for: all of them are one table away here.
//
// A page of its own rather than a dialog: a table wants the whole screen, and a place you reach from
// home AND from inside any app wants an address (`?data=<app>`) that Back and a reload understand.
//
// Each app is read through a data-only runtime (data-runtime.ts): values look and edit exactly as they
// do in the app, without running the app's code. A synced app is opened on its shared space, so an
// edit here reaches the people you share it with, just as it would from inside the app.

import { useEffect, useState, type CSSProperties } from "react";
import { useInstalledApps, type InstalledApp } from "./launcher-store.js";
import { tileIdentity } from "./tile-identity.js";
import { openDataSession, type DataSession } from "./data-runtime.js";
import { shellCaps } from "./shell-caps.js";
import { canGoBack, navigateTo, urlFor } from "./router.js";
import { DatabaseIcon } from "./data-icon.js";
import { Count, Table } from "./data-table.js";
import { Trans, useLingui } from "@lingui/react/macro";

export function DataPage({ initialAppId }: { initialAppId?: string }) {
  const { t } = useLingui();
  const apps = useInstalledApps()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const [appId, setAppId] = useState(initialAppId);
  const app = apps.find((a) => a.id === appId) ?? apps[0] ?? null;

  const choose = (id: string): void => {
    setAppId(id);
    // The address follows the choice, so a reload or a shared link lands on the same app. Replaced,
    // not pushed: Back leaves the page rather than walking through every app you looked at.
    history.replaceState(history.state, "", urlFor({ kind: "data", id }));
  };
  const back = (): void => (canGoBack() ? history.back() : navigateTo({ kind: "home" }));

  return (
    <div className="k-datapage">
      <header className="k-datapage-bar">
        <button type="button" className="k-add k-datapage-back" onClick={back}>
          <span aria-hidden>‹</span> <Trans comment="Data page: leave the page">Back</Trans>
        </button>
        <h1 className="k-datapage-title">
          <DatabaseIcon /> <Trans comment="Data page title: every app's records">Data</Trans>
        </h1>
      </header>
      <div className="k-datapage-body">
        <nav className="k-datapage-apps" aria-label={t`Apps`}>
          <h2 className="k-datapage-apps-head">
            <Trans>Apps</Trans>
          </h2>
          {apps.map((a) => (
            <AppChoice key={a.id} app={a} current={a.id === app?.id} onChoose={() => choose(a.id)} />
          ))}
        </nav>
        <main className="k-datapage-main">
          {app ? <AppData key={app.id} app={app} /> : <p className="k-muted k-data-note"><Trans>No apps on this device yet.</Trans></p>}
        </main>
      </div>
    </div>
  );
}

function AppChoice({ app, current, onChoose }: { app: InstalledApp; current: boolean; onChoose: () => void }) {
  const { t } = useLingui();
  const identity = tileIdentity(app);
  return (
    <button
      type="button"
      className="k-datapage-app"
      aria-current={current ? "true" : undefined}
      style={{ "--tile-accent": identity.accent } as CSSProperties}
      onClick={onChoose}
    >
      <span className="k-datapage-app-glyph" data-kind={identity.kind} aria-hidden>
        {identity.glyph}
      </span>
      <span className="k-datapage-app-name">{app.name}</span>
      {app.sync ? <span className="k-data-shared" title={t`Shared — edits here reach everyone in it`}>
          <Trans comment="Data page: a tag on an app that is synced with other people">shared</Trans>
        </span> : null}
    </button>
  );
}

/** One app, opened for as long as it is the one being looked at. */
function AppData({ app }: { app: InstalledApp }) {
  const { t } = useLingui();
  const [session, setSession] = useState<DataSession | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [entity, setEntity] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let opened: DataSession | null = null;
    openDataSession(app.user, shellCaps())
      .then((s) => {
        opened = s;
        if (!live) return void s.close();
        setSession(s);
        setEntity(s.entities[0]?.key ?? null);
      })
      .catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      void opened?.close().catch(() => {});
    };
    // The app's identity, not the object: the installed list is rebuilt on every registry write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id, app.sync, app.user.source]);

  const head = (
    <header className="k-datapage-apphead">
      <h2>{app.name}</h2>
      <button type="button" className="k-add" onClick={() => navigateTo({ kind: "user", id: app.id })}>
        <Trans>Open app</Trans> <span aria-hidden>›</span>
      </button>
    </header>
  );

  const name = app.name;
  if (failed) return <>{head}<p className="k-data-note k-data-error"><Trans>Couldn’t open {name}’s data: {failed}</Trans></p></>;
  if (!session) return <>{head}<p className="k-muted k-data-note"><Trans>Opening {name}…</Trans></p></>;
  if (session.entities.length === 0) return <>{head}<p className="k-muted k-data-note"><Trans>{name} doesn’t declare any kinds of record.</Trans></p></>;
  const current = session.entities.find((e) => e.key === entity) ?? session.entities[0]!;

  return (
    <>
      {head}
      <div className="k-data-tabs" role="tablist" aria-label={t`${name} records`}>
        {session.entities.map((e) => (
          <button key={e.key} type="button" role="tab" aria-selected={e.key === current.key} className="k-data-tab" onClick={() => setEntity(e.key)}>
            {e.label}
            <Count session={session} entity={e.key} />
          </button>
        ))}
      </div>
      <Table key={current.key} session={session} entity={current.key} fields={current.fields} opaque={current.opaque} />
    </>
  );
}
