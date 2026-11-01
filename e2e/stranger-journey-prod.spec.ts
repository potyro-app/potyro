import { test } from "./console-guard";
import { DESKTOP, PHONE, makeUseAndShare, noFreeRouteToGallery, type Device } from "./stranger-journey";

// The stranger journey (#124, the amendment of 2026-10-30) on a DEPLOYED build (`pnpm test:e2e:prod`):
// `vite build` + `vite preview` with nothing configured, so there is no `claude -p` and a first visit's
// engine is the build's own pick — Potyro's free engine while the relay's chat route serves, the key
// panel when it does not. Nothing is chosen by hand. The relay is faked at the browser's edge; the
// share service is the one `vite preview` runs. The steps are in ./stranger-journey.ts, shared with
// stranger-journey-trusted.spec.ts.

// The build's service worker would make the shell's requests itself, past the context's routes: the
// relay is faked at the page, so the worker is kept out. The prod project leaves the console guard
// off; this journey is held to it.
test.use({ serviceWorkers: "block", guardConsole: true });

// Playwright's `serviceWorkers: "block"` reads `navigator.serviceWorker` in every frame it starts, and in
// the sealed realm's opaque-origin frames reading it throws: the harness's own, never the page's.
const SEALED_WORKERS = /^SecurityError: Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag\.$/;
const BLOCKED_WHY = "Playwright's service-worker block probes the sealed frames, where the property throws";

const DEVICES: Array<[string, Device]> = [
  ["phone", PHONE],
  ["desktop", DESKTOP],
];

for (const [name, device] of DEVICES) {
  test.describe(name, () => {
    test.use(device);

    test("a stranger with no key describes an app on Home, uses it, and its link opens on a second device", async ({ page, context, browser, baseURL, consoleGuard }) => {
      test.setTimeout(180_000);
      consoleGuard.allow(SEALED_WORKERS, BLOCKED_WHY);
      await makeUseAndShare({ page, context, browser, baseURL: baseURL!, device, deployed: true });
    });

    test("with no free app making, the Studio is no dead end: the gallery gives an app of one's own", async ({ page, context, browser, baseURL, consoleGuard }) => {
      test.setTimeout(180_000);
      consoleGuard.allow(SEALED_WORKERS, BLOCKED_WHY);
      await noFreeRouteToGallery({ page, context, browser, baseURL: baseURL!, device, deployed: true });
    });
  });
}
