import { test } from "./console-guard";
import { settleFirstRow } from "./split-settle";

// A balance row's Settle records that row's payment, filled in from it (e2e/split-settle.ts).

test("a balance row's Settle records that row's payment", async ({ page }) => {
  await settleFirstRow(page);
});
