// @vitest-environment happy-dom
//
// An invite must be readable from a URL STRING, not only from the address bar.
//
// On the web a link arrives in `location.hash`. On a device it arrives as an OS event (Android App
// Link / iOS Universal Link) and never touches `location` — so a parser that only reads the address
// bar works in the browser and silently does nothing in the shipped app.

import { describe, expect, it } from "vitest";
import { pendingInvite } from "../src/share-sync.js";

const payload = { appId: "todo", name: "Todo", group: "co_z1", root: "co_z2", secret: "inviteSecret_z3", custom: false };
const fragment = `#join=${btoa(encodeURIComponent(JSON.stringify(payload)))}`;

describe("reading an invite", () => {
  it("reads one from an explicit URL — the device path", () => {
    expect(pendingInvite(`https://karta.app/${fragment}`)).toEqual(payload);
  });

  it("reads one from a custom scheme URL", () => {
    // The fallback route when there is no verified domain yet.
    expect(pendingInvite(`karta://open/${fragment}`)).toEqual(payload);
  });

  it("reads one from the address bar when no URL is given — the web path", () => {
    location.hash = fragment;
    expect(pendingInvite()).toEqual(payload);
    location.hash = "";
  });

  it("returns null for a URL with no invite", () => {
    expect(pendingInvite("https://karta.app/?user=todo")).toBeNull();
  });

  it("returns null rather than throwing on a corrupt payload", () => {
    // A malformed link must not take the app down before it has rendered anything.
    expect(pendingInvite("https://karta.app/#join=not-base64!!")).toBeNull();
  });
});
