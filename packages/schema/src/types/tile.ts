// What an app's launcher tile says when it is live (docs/04 §Tile): `AppDefinition.tile`.
//
// Outside the model's reference on purpose (packages/generator/src/reference.ts): the prompt carries
// only the one `tile` line on `AppDefinition`, and this shape is documented for people and the
// Studio's search in docs/04 (#341 — the system prompt is at its budget).
//
// Plain, serialisable data, never markup: the launcher caches it beside the app's tile and will hand
// the same object to a phone's home-screen widget later. The shell checks it (`checkTileContent`)
// and drops what it cannot show; a tile that throws, runs out of time or returns nothing shows the
// app's plain face, with no error anywhere.

import type { FileRef, MediaRef } from "./core.js";
import type { Words } from "./words.js";

export interface TileContent {
  /** What is waiting, as a number: "3 to water" is `count: 3`. A small tile shows only this. */
  count?: number;
  /** The live face's headline: "3 to water", "Ana owes you €12". */
  title?: Words;
  /** Up to three short lines under it: plant names, the last session, what is left to buy. */
  lines?: Words[];
  /** A picture for the face: a `media` field's value, a `file` field's value, or a path in `ctx.files`. */
  image?: MediaRef | FileRef | string;
}
