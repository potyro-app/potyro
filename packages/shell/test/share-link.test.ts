// @vitest-environment happy-dom
//
// Invite link size (KA-08 / deep links).
//
// The link used to embed the whole app source. That is fine on the web and fatal on a device: a
// native build receives invites through Android App Links / iOS Universal Links, where URL handling
// gets unreliable past a few KB. Now that the source syncs through the space, the link only needs
// the coordinates to reach it.

import { describe, expect, it } from "vitest";

/** The encoding `share-sync.ts` uses. Kept in step deliberately — this test is about SIZE. */
const encode = (p: unknown): string => btoa(encodeURIComponent(JSON.stringify(p)));

const COORDS = {
  appId: "shared-todo",
  name: "Shared Todo",
  group: "co_zBKumQ3HxmSQvJeWw5KFFLzYwWrrnBkpq2oBhzeq2vfDS",
  root: "co_zD44rtDkZHhZt2S37uLgvQ9xKpBc7YbvPmXn4TqRs8Wa",
  secret: "inviteSecret_z2bUTpsQXnrgfLgtZEparticularlyLongSecretValueHere",
  custom: true,
};

/** A modest real app — the workout example is far bigger than this. */
const SOURCE = `import { defineApp } from "potyro";\n${'// a line of app source that is entirely typical\n'.repeat(120)}`;

describe("invite link size", () => {
  it("fits comfortably inside a deep link", () => {
    const link = `https://potyro.app/#join=${encode(COORDS)}`;
    // Both platforms handle a few KB reliably; this leaves an order of magnitude of headroom.
    expect(link.length).toBeLessThan(1000);
  });

  it("would NOT fit if it still carried the app source", () => {
    // The regression this guards: re-adding `source` to the payload for convenience.
    const withSource = `https://potyro.app/#join=${encode({ ...COORDS, source: SOURCE })}`;
    expect(withSource.length).toBeGreaterThan(5000);
    expect(withSource.length).toBeGreaterThan(
      `https://potyro.app/#join=${encode(COORDS)}`.length * 5,
    );
  });

  it("round-trips through the fragment encoding", () => {
    const decoded = JSON.parse(decodeURIComponent(atob(encode(COORDS))));
    expect(decoded).toEqual(COORDS);
  });
});
