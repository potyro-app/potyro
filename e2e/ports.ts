// Every fixed port the browser suite uses, in one place (docs/16 §8).
//
// Without `POTYRO_E2E_PORT_BASE` they are the ports the suite has always used — `pnpm e2e`, `pnpm dev`
// and anyone's scratch config keep working unchanged. With it, the suite takes one BLOCK of
// `PORT_BLOCK` consecutive ports starting there, so several copies of the suite can run side by side
// on one machine (ci-local runs its shards that way). The port is part of a page's origin, so a block
// is also its own OPFS, localStorage and IndexedDB: two blocks share no browser state, no dev server
// and no relay.
//
// Read by playwright.config.ts AND by the specs (a test worker inherits the runner's environment), so
// a spec and the servers it talks to can never disagree.
//
// Ports a spec needs for itself and nobody else (an echo server, a rooms relay, a realm probe) are
// not here: those ask the OS for a free one (`freePort()` in live-servers.ts). Only a port something
// must know in advance belongs in this file.

/** How many ports one block takes. ci-local claims blocks this wide. */
export const PORT_BLOCK = 10;

export interface E2ePorts {
  /** `pnpm dev`: the examples trusted. */
  trusted: number;
  /** `pnpm dev:sandbox`: the examples sealed, in the browser realm. */
  sandbox: number;
  /** `vite build` + `vite preview` (`POTYRO_PROD=1`). */
  prod: number;
  /** `pnpm dev:sandbox:quickjs` (`POTYRO_QUICKJS=1`). */
  quickjs: number;
  /** The shared sync relay every sync spec converges through. */
  relay: number;
  /** relay-reconnect's own relay, which it kills on purpose. */
  reconnectRelay: number;
  /** A port nothing ever listens on: "syncing must work with no relay" (sync-toggle). */
  deadRelay: number;
}

const LEGACY: E2ePorts = { trusted: 4188, sandbox: 4189, prod: 4190, quickjs: 4191, relay: 4201, reconnectRelay: 4321, deadRelay: 4299 };

function fromEnv(): E2ePorts {
  const raw = process.env.POTYRO_E2E_PORT_BASE;
  if (raw === undefined || raw === "") return LEGACY;
  const base = Number(raw);
  if (!Number.isInteger(base) || base < 1024 || base + PORT_BLOCK > 65_535) {
    throw new Error(`POTYRO_E2E_PORT_BASE must be an integer port in 1024..${65_535 - PORT_BLOCK}, got "${raw}"`);
  }
  return { trusted: base, sandbox: base + 1, prod: base + 2, quickjs: base + 3, relay: base + 4, reconnectRelay: base + 5, deadRelay: base + 6 };
}

export const PORTS: E2ePorts = fromEnv();

/** The shared relay's URL, as the specs hand it to a page's `potyro:sync:relay`. */
export const E2E_RELAY = `ws://localhost:${PORTS.relay}`;
