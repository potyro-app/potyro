import { test } from "./console-guard";
import { liveScopeJourney, seedLiveScope } from "./scope-live.js";

// `ctx.scope` is live (docs/04 §Scope), for a sealed app too: its title is worked out in the realm, and
// its own screen reads the selection from the data its frame holds — sent again when the trip changes.

test.use({ viewport: { width: 1280, height: 800 } });

test("a sealed app's selected record, edited, is the new one in its title and in its framed screen", async ({ page }, info) => {
  test.skip(info.project.name === "sandbox-quickjs", "the QuickJS fallback has no sealed screens");
  await seedLiveScope(page, false);
  await liveScopeJourney(page, page.frameLocator(".k-sealed-view iframe"), process.env.POTYRO_SHOTS, "scope-live-sealed");
});
