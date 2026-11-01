import { test } from "./console-guard";
import { DESKTOP, PHONE, makeUseAndShare, noFreeRouteToGallery, type Device } from "./stranger-journey";

// The stranger journey (#124, the amendment of 2026-10-30), as an acceptance test with the relay faked:
// a fresh profile, no key, from Home's prompt box to a working app through the relay, a record in it, a
// link anyone can try made from its tile, and that link opened on a second device — on a phone and on
// a desktop. Then the same person on a day the relay's free route is not offered: the Studio's
// no-dead-end panel and "Start from an app in the gallery", ending in an app of their own.
//
// One thing the dev server cannot be: a deployed build. `claude -p` is the dev server's own route
// (generate-client.ts `canGenerate`), so here a first visit starts on it and the shell never picks
// Potyro's free engine by itself (engine-store.ts `checkFreeEngine`): the person's one extra step here
// is Model settings. stranger-journey-prod.spec.ts runs the same journey on a real build
// (`pnpm test:e2e:prod`), where nothing is chosen at all. The steps are in ./stranger-journey.ts.

const DEVICES: Array<[string, Device]> = [
  ["phone", PHONE],
  ["desktop", DESKTOP],
];

for (const [name, device] of DEVICES) {
  test.describe(name, () => {
    test.use(device);

    test("a stranger with no key describes an app on Home, uses it, and its link opens on a second device", async ({ page, context, browser, baseURL }) => {
      test.setTimeout(180_000);
      await makeUseAndShare({ page, context, browser, baseURL: baseURL!, device, deployed: false });
    });

    test("with no free app making, the Studio is no dead end: the gallery gives an app of one's own", async ({ page, context, browser, baseURL }) => {
      test.setTimeout(180_000);
      await noFreeRouteToGallery({ page, context, browser, baseURL: baseURL!, device, deployed: false });
    });
  });
}
