import { test } from "./console-guard";
import { liveScopeJourney, seedLiveScope } from "./scope-live.js";

// `ctx.scope` is live (docs/04 §Scope), for an app that runs as yours: the selected trip, renamed and
// added to while it stays selected, is the new one everywhere that reads it. Fails with a snapshot scope.

test.use({ viewport: { width: 1280, height: 800 } });

test("the selected record, edited, is the new one in the chip, the title and the app's own screen", async ({ page }) => {
  await seedLiveScope(page, true);
  await liveScopeJourney(page, page, process.env.POTYRO_SHOTS, "scope-live-trusted");
});
