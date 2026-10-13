// "Why is it slow on MY phone?" — answered on the phone.
//
// Every measurement behind the storage work so far was taken on a developer machine, and the owner
// kept reporting slowness none of it reproduced. The gap is not going to close by measuring here
// harder: what a device is actually doing — which storage it ended up on, how much it is holding,
// how long a write really takes — is knowable only on that device.
//
// So this runs the same three things the store does all day (write, read back, tick a field) against
// a scratch app, and reports plain numbers anyone can read aloud.

import { useState } from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";

const ms = (n: number): string => fmt.number(n, { style: "unit", unit: "millisecond", unitDisplay: "short" });

interface Measured {
  mode: string;
  storedMB: string;
  writeMs: number;
  readMs: number;
  tickMs: number;
  rows: number;
}

/** Enough writes to average out one slow moment, few enough to stay under a second when healthy. */
const WRITES = 20;
const PROBE = "storage-probe";

async function measure(): Promise<Measured> {
  const { openStore, storageModes } = await import("./open-store.js");
  const store = await openStore(PROBE);

  const t0 = performance.now();
  for (let i = 0; i < WRITES; i++) await store.insert("probe", { id: `p${i}`, n: i, at: new Date().toISOString() });
  const writeMs = (performance.now() - t0) / WRITES;

  const t1 = performance.now();
  const rows = await store.all("probe");
  const readMs = performance.now() - t1;

  // One field of one record: what ticking a checkbox costs the store.
  const t2 = performance.now();
  await store.update("probe", "p0", { n: 99 });
  const tickMs = performance.now() - t2;

  for (const row of rows) await store.delete("probe", row.id);

  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  const used = estimate?.usage ?? 0;
  return {
    mode: storageModes().get(PROBE) ?? "unknown",
    storedMB: (used / 1024 / 1024).toFixed(1),
    writeMs: Math.round(writeMs),
    readMs: Math.round(readMs),
    tickMs: Math.round(tickMs),
    rows: rows.length,
  };
}

/** What each mode means, in words rather than identifiers. Descriptors: read when shown, in the language then. */
const MODE_TEXT: Record<string, MessageDescriptor> = {
  worker: msg`a database in a worker (the fast one)`,
  "crdt-worker": msg`a synced database in a worker (the fast one)`,
  opfs: msg`a database on the main thread`,
  "indexeddb-snapshot": msg`IndexedDB, rewritten whole on every save (slow)`,
  "local-storage": msg`browser local storage (slow, and small)`,
  unknown: msg`not opened yet`,
};

export function StorageReport() {
  const { t } = useLingui();
  const [result, setResult] = useState<Measured | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      setResult(await measure());
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k-storage-report">
      <button type="button" className="k-add" disabled={busy} onClick={() => void run()}>
        {busy ? t`Measuring…` : t`Check storage speed`}
      </button>
      {failed ? (
        <p className="k-muted">
          <Trans>Could not measure: {failed}</Trans>
        </p>
      ) : null}
      {result ? (
        <dl className="k-storage-figures" aria-label={t`Storage speed`}>
          <dt>
            <Trans comment="Storage report: which kind of storage this device ended up on">Storage</Trans>
          </dt>
          <dd>{MODE_TEXT[result.mode] ? t(MODE_TEXT[result.mode]!) : result.mode}</dd>
          <dt>
            <Trans comment="Storage report: how much this site stores on the device">Holding</Trans>
          </dt>
          <dd>{fmt.number(Number(result.storedMB), { style: "unit", unit: "megabyte", maximumFractionDigits: 1 })}</dd>
          <dt>
            <Trans>Save one thing</Trans>
          </dt>
          <dd>{ms(result.writeMs)}</dd>
          <dt>
            <Trans>Change one thing</Trans>
          </dt>
          <dd>{ms(result.tickMs)}</dd>
          <dt>{plural(result.rows, { one: "Read # back", other: "Read # back" })}</dt>
          <dd>{ms(result.readMs)}</dd>
        </dl>
      ) : null}
    </div>
  );
}
