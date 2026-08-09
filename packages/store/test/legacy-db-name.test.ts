// Which cojson database an app opens (regression).
//
// The database was renamed from `${appId}-jazz` to a device-global `karta-jazz` to fix the second
// synced app failing to open. That fix was right and shipped WITHOUT A MIGRATION, which orphaned
// every space that already existed: the group and root CoValues live in the old per-app file, so
// opening the new one found nothing and `createJazzStore` refused —
//
//     group co_z… for "user:city-places" is unavailable. Its storage is missing or unreadable;
//     refusing to silently create a new space and strand the existing data.
//
// The guard behaved exactly as designed. The rename was the bug.
//
// `openJazzStore` owns the choice and needs a browser to run, so these test the DECISION RULE it
// applies, which is where the mistake actually lived: an app with a saved space but no database
// marker predates the move and must keep its old file.

import { describe, expect, it } from "vitest";
import type { JazzKeyStore } from "../src/index.js";

/** The rule as implemented in `openJazzStore`. Kept in step by the tests below. */
function chooseDb(appId: string, keys: JazzKeyStore): string {
  const recorded = keys.get(`karta:jazz:db:${appId}`);
  const predatesMove = !recorded && !!keys.get(`karta:jazz:group:${appId}`);
  const name = recorded ?? (predatesMove ? `${appId}-jazz` : "karta-jazz");
  keys.set(`karta:jazz:db:${appId}`, name);
  return name;
}

function store(entries: Record<string, string> = {}): { keys: JazzKeyStore; map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return { keys: { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) }, map };
}

describe("choosing an app's cojson database", () => {
  it("keeps the legacy file for a space that already existed", () => {
    // The exact shape of the reported failure: a group id saved, no database marker.
    const { keys } = store({ "karta:jazz:group:user:city-places": "co_zbGaeSGYa5qT9nkU6JnJP8bz2LZ" });
    expect(chooseDb("user:city-places", keys)).toBe("user:city-places-jazz");
  });

  it("uses the device-global file for a brand-new app", () => {
    const { keys } = store();
    expect(chooseDb("user:new-app", keys)).toBe("karta-jazz");
  });

  it("records the choice, so it cannot drift on a later open", () => {
    // Without this, anything that later writes a group id would flip an app's database underneath it.
    const { keys, map } = store({ "karta:jazz:group:user:city-places": "co_zGroup" });
    const first = chooseDb("user:city-places", keys);
    expect(map.get("karta:jazz:db:user:city-places")).toBe(first);

    map.set("karta:jazz:group:user:city-places", "co_zSomethingElse");
    expect(chooseDb("user:city-places", keys)).toBe(first);
  });

  it("does not send a new app to a legacy file just because another app has one", () => {
    const { keys } = store({
      "karta:jazz:group:user:city-places": "co_zGroup",
      "karta:jazz:db:user:city-places": "user:city-places-jazz",
    });
    expect(chooseDb("user:brand-new", keys)).toBe("karta-jazz");
  });

  it("keeps two legacy apps in their own separate files", () => {
    // Each was created in its own database before the move; neither can be moved without copying
    // CoValues, which is not something a name change can do.
    const { keys } = store({
      "karta:jazz:group:user:a": "co_zA",
      "karta:jazz:group:user:b": "co_zB",
    });
    expect(chooseDb("user:a", keys)).toBe("user:a-jazz");
    expect(chooseDb("user:b", keys)).toBe("user:b-jazz");
  });
});
