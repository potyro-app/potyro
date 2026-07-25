// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { defineApp } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "@karta/runtime";
import { useMapMarkers } from "../src/map.js";

// Tests marker resolution against a real (DirectHost) runtime, without mounting MapLibre (which
// needs WebGL). `useMapMarkers` is the testable part: geo/title/color resolution + geo filtering.

const app = defineApp({
  id: "map-fixture",
  name: "Map Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    place: {
      label: "Place",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        location: { type: "geo" },
        kind: { type: "enum", options: ["bar", "cafe"] },
      },
    },
  },
  pages: [
    {
      id: "map",
      title: "Map",
      view: { type: "map", entity: "place", geo: "location", title: "name", color: (p) => (p.kind === "bar" ? "#E4A93C" : "#5FB0E4") },
    },
  ],
});

async function makeRuntime(): Promise<KartaRuntime> {
  const store = new MemoryStore();
  await store.open("map-fixture");
  await store.insert("place", { name: "Cozy Bar", location: { lat: 52.52, lng: 13.405 }, kind: "bar" });
  await store.insert("place", { name: "No Geo Cafe", kind: "cafe" }); // no location → not a marker

  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
}

function Harness({ runtime }: { runtime: KartaRuntime }) {
  const { rows } = runtime.usePageQuery("map", {});
  const markers = useMapMarkers(runtime, "map", rows);
  return (
    <ul>
      {markers.map((m) => (
        <li key={m.id} data-lat={m.lat} data-lng={m.lng} data-color={m.color}>
          {m.title}
        </li>
      ))}
    </ul>
  );
}

afterEach(cleanup);

describe("useMapMarkers", () => {
  it("resolves geo/title/color per row and skips rows without a geo point", async () => {
    render(<Harness runtime={await makeRuntime()} />);

    const marker = await screen.findByText("Cozy Bar");
    expect(marker.getAttribute("data-lat")).toBe("52.52");
    expect(marker.getAttribute("data-lng")).toBe("13.405");
    expect(marker.getAttribute("data-color")).toBe("#E4A93C");

    expect(screen.queryByText("No Geo Cafe")).toBeNull(); // no location → no marker
  });
});
