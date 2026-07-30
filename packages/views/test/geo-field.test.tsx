// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp } from "karta";
import type { Field } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "@karta/runtime";
import { FieldInput, FieldValue } from "../src/index.js";

// Geo field (issue #22): "use my location" fills coordinates from ctx.caps.geo (graceful/disabled
// without the cap), and the value renderer shows coordinates as a map link.

const app = defineApp({
  id: "geo-fixture",
  name: "Geo Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    place: { label: "Place", displayField: "name", fields: { name: { type: "text", required: true }, location: { type: "geo" } } },
  },
  pages: [{ id: "list", title: "Places", view: { type: "list", entity: "place", display: { primary: "name" } } }],
});

async function makeRuntime(caps: FakeCapabilities): Promise<KartaRuntime> {
  const store = new MemoryStore();
  await store.open("geo-fixture");
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  return createRuntime({ app: loaded, host, store, caps, ui, nav });
}

const GEO_FIELD = { type: "geo" } as Field;

afterEach(cleanup);

describe("geo field input", () => {
  it("'use my location' fills coordinates from ctx.caps.geo", async () => {
    const caps = new FakeCapabilities({ geolocation: true, position: { lat: 52.52, lng: 13.405, label: "Berlin" } });
    const runtime = await makeRuntime(caps);
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={GEO_FIELD} value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Use my location/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lat: 52.52, lng: 13.405 })));
  });

  it("disables 'use my location' when there is no geolocation cap", async () => {
    const runtime = await makeRuntime(new FakeCapabilities({ geolocation: false }));
    render(<FieldInput runtime={runtime} field={GEO_FIELD} value={null} onChange={() => {}} />);
    expect((screen.getByRole("button", { name: /Use my location/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  // The map is the primary affordance; nobody picks a place by typing coordinates. They stay
  // reachable as an escape hatch, one click away.
  it("hides raw coordinates behind a toggle", async () => {
    const runtime = await makeRuntime(new FakeCapabilities());
    render(<FieldInput runtime={runtime} field={GEO_FIELD} value={{ lat: 0, lng: 0 }} onChange={() => {}} />);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.getByText(/Tap the map to place a point/)).toBeTruthy();
  });

  it("supports manual coordinate entry once revealed", async () => {
    const runtime = await makeRuntime(new FakeCapabilities());
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={GEO_FIELD} value={{ lat: 0, lng: 0 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Enter coordinates/ }));
    const [lat] = screen.getAllByRole("spinbutton");
    fireEvent.change(lat!, { target: { value: "48.85" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lat: 48.85 }));
  });
});

describe("geo field value", () => {
  it("renders coordinates as a map link", async () => {
    const runtime = await makeRuntime(new FakeCapabilities());
    render(<FieldValue runtime={runtime} entity="place" fieldKey="location" value={{ lat: 52.52, lng: 13.405 }} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toContain("mlat=52.52");
    expect(link.textContent).toContain("52.5200");
  });
});
