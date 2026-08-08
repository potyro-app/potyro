import { defineConfig, devices } from "@playwright/test";

// M1 e2e smoke (issue #15): verifies the recipes DoD in a real browser — both the TRUSTED path
// (`pnpm dev`) and the SANDBOX path (`pnpm dev:sandbox`, same app untrusted in the QuickJS-WASM
// isolate). Two Vite dev servers run on distinct ports; each project targets one via baseURL.
//
// Requires Node 20+ (Playwright constraint). In CI run under Node 20/22; locally the servers can be
// launched by Playwright's webServer below.

const TRUSTED_PORT = 4188;
const SANDBOX_PORT = 4189;
const shellVite = (extra: string, port: number) =>
  `pnpm --filter @karta/shell exec vite ${extra} --port ${port} --strictPort`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
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
  ],

  projects: [
    {
      name: "trusted",
      testMatch: /.*trusted\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${TRUSTED_PORT}` },
    },
    // Firefox, for the trusted app surface only. The geo picker rendered fine in Chromium and blank
    // in the user's Firefox — a Chrome-only suite could not see it.
    {
      name: "trusted-firefox",
      testMatch: /.*trusted\.spec\.ts/,
      use: { ...devices["Desktop Firefox"], baseURL: `http://localhost:${TRUSTED_PORT}` },
    },
    {
      name: "sandbox",
      testMatch: /.*sandbox\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${SANDBOX_PORT}` },
    },
  ],
});
