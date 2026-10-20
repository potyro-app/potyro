import { test } from "./console-guard";
import { mapSelectClaims, openMapSelect } from "./map-select";

// The same app SEALED (docs/22): its `onSelect` runs in the box, with the record, and reaches the map
// on screen through `ctx.views.map().select` / `.open` over the mediated bridge. What a person asks
// of a built-in view's tap must work the same for an app they wrote and one they were sent.

test("sealed: tapping a strip card runs the app's onSelect in its box, which selects the pin; the second tap opens", async ({ page }) => {
  await openMapSelect(page, false);
  await mapSelectClaims(page);
});
