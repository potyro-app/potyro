// @vitest-environment happy-dom
// What the trust dialog says an app asks for (docs/07, docs/28): as precisely as the app declared it.
// An app that only joins Potyro's rooms must not be listed as asking for "the internet", and one that
// names its sites is listed with them.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TrustDialog } from "../src/trust-dialog.js";
import { permissionWords } from "../src/capability-words.js";

afterEach(cleanup);

const listed = (permissions: Record<string, unknown>): string[] => {
  render(<TrustDialog name="Draw & Guess" permissions={permissions} onCancel={() => undefined} onPromote={() => undefined} />);
  return screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
};

describe("the trust dialog's list of what an app asks for", () => {
  it("names Potyro's rooms for an app that only asks for rooms, never the internet", () => {
    const items = listed({ network: { rooms: true } });
    expect(items).toEqual(["Potyro’s rooms (play live with people who have the link)"]);
    expect(items.join(" ")).not.toMatch(/internet/i);
  });

  it("names the sites an app asks for, and the internet only when it asks for all of it", () => {
    expect(listed({ network: { hosts: ["www.seismicportal.eu", "api.example.com"] }, geo: true })).toEqual([
      "the internet, only these sites: www.seismicportal.eu, api.example.com",
      "location",
    ]);
    cleanup();
    expect(listed({ network: true })).toEqual(["the internet"]);
  });

  it("lists sites and rooms both when an app asks for both, and nothing for a permission set to false", () => {
    expect(permissionWords({ network: { hosts: ["a.example"], rooms: true }, camera: false })).toEqual([
      "the internet, only these sites: a.example",
      "Potyro’s rooms (play live with people who have the link)",
    ]);
    expect(permissionWords({ network: {} })).toEqual([]);
  });
});
