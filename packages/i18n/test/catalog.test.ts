// The catalogs are generated from the code (`pnpm i18n:extract`), and this fails while they are
// stale — the same arrangement as the generator's reference (#130) and corpus (#262).
//
// Why it matters more than tidiness: a production build keeps only each message's hash id, not its
// English. A message the English catalog does not have renders as that hash — `x7Kq2a` on a button.

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { getConfig } from "@lingui/conf";
import { getCatalogs } from "@lingui/cli/api";
import { LOCALES, SOURCE_LOCALE } from "../src/locale.js";

const config = getConfig({ configPath: fileURLToPath(new URL("../lingui.config.ts", import.meta.url)), skipValidation: true });

const live = (catalog: Record<string, { obsolete?: boolean; message?: string; translation?: string }>) =>
  Object.fromEntries(Object.entries(catalog).filter(([, m]) => !m.obsolete));

describe("catalogs", () => {
  it("hold every message in the code, and nothing the code no longer says (run `pnpm i18n:extract`)", async () => {
    const [catalog] = await getCatalogs(config);
    const extracted = (await catalog!.collect()) ?? {};
    const english = live(await catalog!.read(SOURCE_LOCALE));
    expect(Object.keys(english).sort()).toEqual(Object.keys(extracted).sort());
    for (const [id, m] of Object.entries(extracted)) expect(english[id]?.translation, `English for ${m.message}`).toBe(m.message);

    // Every language lists every message, translated or not, so a translator sees the whole job.
    for (const locale of LOCALES) {
      const theirs = live(await catalog!.read(locale));
      expect(Object.keys(theirs).sort(), locale).toEqual(Object.keys(extracted).sort());
    }
  }, 60_000);
});
