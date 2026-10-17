// The app-wide selection is live (docs/04 §Scope): one trip is what everything belongs to, and its
// own screen — a custom view — names it from `ctx.scope`, renames it, and lists who is coming. Seeded
// as a user app by e2e/scope-live-{trusted,sandbox}.spec.ts: run as yours, and sealed, where the
// view is in its own frame and `ctx.scope` crosses as data. Kept out of the examples' tsconfig.

import { defineApp } from "potyro";
import type { ViewProps } from "potyro";

function Here(props: ViewProps) {
  // Watched, as any screen's rows are: a change to the trip re-renders through them.
  const { rows } = props.runtime.useQuery("place");
  const ctx = props.runtime.ctx;
  const trip = ctx.scope.trip;
  const who = String(trip?.who ?? "");
  return (
    <div style={{ padding: 16 }}>
      <h2 id="lv-city">{trip ? String(trip.city) : "No trip"}</h2>
      <p id="lv-who">{who || "Nobody yet"}</p>
      <p id="lv-places">{rows.length} places</p>
      <button type="button" disabled={!trip} onClick={() => trip && void props.runtime.patch("trip", trip.id, { city: `${String(trip.city)} Old Town` })}>
        Rename it
      </button>
      <button type="button" disabled={!trip} onClick={() => trip && void props.runtime.patch("trip", trip.id, { who: who ? `${who}, Ana` : "Ana" })}>
        Ana is coming
      </button>
    </div>
  );
}

export default defineApp({
  id: "live-trips",
  name: "Live trips",
  version: "1.0.0",
  schemaVersion: 1,
  scope: { entity: "trip", label: "Trip", required: true },
  entities: {
    trip: { label: "Trip", icon: "✈️", displayField: "city", fields: { city: { type: "text", required: true }, who: { type: "text" } } },
    place: { label: "Place", icon: "📍", displayField: "name", fields: { name: { type: "text", required: true }, trip: { type: "relation", to: "trip" } } },
  },
  pages: [
    {
      id: "here",
      // Worked out by the app's logic — in the realm, when sealed — from the same selection.
      title: (ctx) => (ctx.scope.trip ? `In ${String(ctx.scope.trip.city)}` : "Here"),
      view: { type: "custom", entity: "place", render: (props) => <Here {...props} /> },
    },
    { id: "places", title: "Places", view: { type: "list", entity: "place", display: { primary: "name" } } },
  ],
});
