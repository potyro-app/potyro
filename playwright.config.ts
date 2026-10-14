import { defineConfig, devices } from "@playwright/test";

// M1 e2e smoke (issue #15): verifies the recipes DoD in a real browser — both the TRUSTED path
// (`pnpm dev`) and the SANDBOX path (`pnpm dev:sandbox`, same app untrusted, its logic in the browser
// realm, #272). Two Vite dev servers run on distinct ports; each project targets one via baseURL.
//
// Requires Node 20+ (Playwright constraint). In CI run under Node 20/22; locally the servers can be
// launched by Playwright's webServer below.

const TRUSTED_PORT = 4188;
const SANDBOX_PORT = 4189;
// A real `vite build` + `vite preview`, because the dev server hides deployment bugs by definition:
// the relay default, the generator endpoint and the service worker all behave differently there.
// KA-28 exists because a production build had no relay and nobody had ever run one.
const PROD_PORT = 4190;
/** `pnpm dev:sandbox:quickjs`: shared apps in the QuickJS fallback, for `POTYRO_QUICKJS=1` (#272). */
const QUICKJS_PORT = 4191;
const shellVite = (extra: string, port: number) =>
  `pnpm --filter @potyro/shell exec vite ${extra} --port ${port} --strictPort`;

/** `POTYRO_PARALLEL`, or the one worker this suite defaults to. See `workers` below. */
function workerCount(): number {
  const raw = process.env.POTYRO_PARALLEL;
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  // `Number("0")` is 0 and `Number("some")` is NaN, and a non-empty string is truthy either way —
  // so without this a typo silently configures a suite that never runs a test.
  if (!Number.isInteger(n) || n < 1) throw new Error(`POTYRO_PARALLEL must be a positive integer, got "${raw}"`);
  return n;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // ONE WORKER by default, which is a claim about this suite rather than about Playwright.
  //
  // `fullyParallel: false` only serialises tests within a file; separate files still land on
  // separate workers, and every one of them drives the SAME origin against the SAME dev server.
  // The durable store is SQLite over OPFS and the sync specs share one relay on 4201, so two
  // workers are two clients of the same state. Measured, not assumed: at the default worker count
  // `export-import-trusted.spec.ts` dies on `Boot error: Missing required OPFS APIs.` and
  // `relay-reconnect` takes its neighbours down with it; at one worker both pass. (That spec also
  // launches its own browser, for a second reason its own header explains.)
  //
  // A default command that fails for reasons that have nothing to do with the code is worse than a
  // slow one: it teaches everybody to re-run until green, and a suite people re-run until green
  // cannot report a regression. `POTYRO_PARALLEL=4 pnpm e2e` is there for a quick local sweep, with
  // the understanding that a failure from it needs confirming at one worker before it is believed.
  // A bad value is refused rather than quietly becoming `NaN` or `0` workers, either of which turns
  // a typo into a suite that does not run and does not say why.
  workers: workerCount(),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  webServer: [
    {
      // The sync relay. Without it the sync specs exercise a local CRDT store and nothing else —
      // two peers converging is the actual claim, and that needs a relay to converge THROUGH.
      // `--in-memory` needs no native build and a test relay has nothing worth persisting.
      command: "pnpm jazz-run sync --port 4201 --in-memory",
      // `port`, not `url`: a websocket-only server never answers an HTTP GET, so a `url` probe
      // waits until the whole run times out. `port` just checks something is listening.
      port: 4201,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: shellVite("", TRUSTED_PORT),
      url: `http://localhost:${TRUSTED_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: shellVite("--mode sandbox", SANDBOX_PORT),
      url: `http://localhost:${SANDBOX_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // The QuickJS fallback (#272), only when asked for: `POTYRO_QUICKJS=1 pnpm e2e --project=sandbox-quickjs`
    // runs every sandbox spec with shared apps in QuickJS, while it is still the flag's other side.
    ...(process.env.POTYRO_QUICKJS
      ? [
          {
            command: shellVite("--mode sandbox-quickjs", QUICKJS_PORT),
            url: `http://localhost:${QUICKJS_PORT}`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
        ]
      : []),
    // Only when asked for (`pnpm test:e2e:prod`). Playwright starts every `webServer` on every run
    // regardless of the project selected, so leaving this in unconditionally made each ordinary run
    // pay for a full production build — and the CPU it stole made the parallel suite flaky.
    ...(process.env.POTYRO_PROD
      ? [
          {
            // Built with NOTHING configured, on purpose: this is what a self-hoster gets by running
            // `vite build` and serving `dist`. A deployment default that only works when an env var
            // is set would pass a test that set one.
            command:
              "pnpm --filter @potyro/shell exec vite build && " +
              `pnpm --filter @potyro/shell exec vite preview --port ${PROD_PORT} --strictPort`,
            url: `http://localhost:${PROD_PORT}`,
            reuseExistingServer: !process.env.CI,
            timeout: 240_000,
          },
        ]
      : []),
  ],

  projects: [
    {
      name: "trusted",
      testMatch: /.*trusted\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${TRUSTED_PORT}` },
    },
    // Firefox, for the trusted app surface only. The geo picker rendered fine in Chromium and blank
    // in the user's Firefox — a Chrome-only suite could not see it.
    //
    // OPT-IN (`pnpm test:e2e:firefox`), and that is a statement about this suite rather than about
    // Firefox. The project was added on 30 July and has never once run in CI: the suite died at
    // collection from that day until now, so nobody saw what it does here. Switched on, it fails 11
    // map specs — not by failing to launch, but by rendering ONE marker where three are expected,
    // which is the marker-sync race `map-camera-trusted.spec.ts` was written to catch, surfacing on
    // a slower browser. That is a real finding and it has an issue; it is not something to discover
    // inside the change that puts CI back on its feet, and turning it on now would leave main red
    // for a defect nothing on main introduced.
    ...(process.env.POTYRO_FIREFOX
      ? [
          {
            name: "trusted-firefox",
            testMatch: /.*trusted\.spec\.ts/,
            use: { ...devices["Desktop Firefox"], baseURL: `http://localhost:${TRUSTED_PORT}` },
          },
        ]
      : []),
    {
      name: "sandbox",
      testMatch: /.*sandbox\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${SANDBOX_PORT}` },
    },
    // The browser realm's own specs in Firefox and WebKit (#272): its containment, its watchdog and the
    // shell's frame-src are properties of each engine, measured in all three (docs/22). OPT-IN
    // (`POTYRO_REALM_BROWSERS=1 pnpm e2e --project=sandbox-firefox --project=sandbox-webkit`) for the
    // reason trusted-firefox is: the rest of the sandbox suite has never run on these engines.
    ...(process.env.POTYRO_REALM_BROWSERS
      ? (
          [
            ["sandbox-firefox", devices["Desktop Firefox"]],
            ["sandbox-webkit", devices["Desktop Safari"]],
          ] as const
        ).map(([name, device]) => ({
          name,
          testMatch: /(realm|realm-escape|shell-csp)-sandbox\.spec\.ts/,
          use: { ...device, baseURL: `http://localhost:${SANDBOX_PORT}` },
        }))
      : []),
    ...(process.env.POTYRO_QUICKJS
      ? [
          {
            name: "sandbox-quickjs",
            // The realm's own specs assert the realm; every other sandbox spec is the shared contract.
            testMatch: /.*sandbox\.spec\.ts/,
            testIgnore: /(realm|realm-escape)-sandbox\.spec\.ts/,
            use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${QUICKJS_PORT}` },
          },
        ]
      : []),
    // Claims that are only true of a DEPLOYED build. Kept a separate project so the ordinary suite
    // does not pay for a production build on every run.
    //
    // Gated on the SAME env var as its webServer above. Without this the project ran on every
    // invocation while the server it needs was never started, so `pnpm e2e` reported four
    // connection-refused failures that said nothing about the code — and would have kept CI red
    // even once everything genuinely broken was fixed. Use `pnpm test:e2e:prod`.
    ...(process.env.POTYRO_PROD
      ? [
          {
            name: "prod",
            testMatch: /.*prod\.spec\.ts/,
            use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PROD_PORT}` },
          },
        ]
      : []),
  ],
});
