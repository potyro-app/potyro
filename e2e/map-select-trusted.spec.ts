import { test } from "./console-guard";
import { mapSelectClaims, openMapSelect } from "./map-select";

// A map's taps as the app's own (docs/04), the app run as mine: a strip card tapped runs the app's
// `onSelect`, which selects the pin through `ctx.views.map().select` rather than opening the record;
// the card in front, tapped again, opens it through `.open`; a page action selects by id.

test("tapping a strip card runs the app's onSelect, which selects the pin; the app opens it on the second tap", async ({ page }) => {
  await openMapSelect(page, true);
  await mapSelectClaims(page);
});
