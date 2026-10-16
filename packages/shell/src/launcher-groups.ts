// What kind of app it is, for the wall's groups (owner, 2026-10-15): "a bigger rectangle that's just
// games or AI". An app may say (`category: "games"`); for apps that do not, a short local list of
// the ones Potyro ships knows. Never a network call, never a model — a guess here is a group the
// person can rename or take apart in two taps.

import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

/** Potyro's own apps that say nothing, by id. The examples and packaged apps declare theirs. */
const KNOWN: Readonly<Record<string, string>> = {
  daily: "games",
  "photo-puzzle": "games",
  breakout: "games",
  "mirror-monsters": "camera",
  "palette-catcher": "camera",
  "photo-garden": "camera",
};

/** The category an app goes in: what it declares, else the local rule's, else none. */
export function categoryOf(id: string, declared?: string): string | undefined {
  const own = declared?.trim().toLowerCase();
  if (own && /^[a-z][a-z0-9-]*$/.test(own)) return own;
  return KNOWN[id];
}

/** A group's name in the person's language, for the categories Potyro proposes. */
const NAMES: Readonly<Record<string, MessageDescriptor>> = {
  everyday: msg({ message: "Everyday", comment: "A launcher tile group: everyday apps (shopping, plants, recipes)" }),
  games: msg({ message: "Games", comment: "A launcher tile group" }),
  camera: msg({ message: "Camera", comment: "A launcher tile group: apps that use the camera" }),
  ai: msg({ message: "AI", comment: "A launcher tile group: apps that use AI" }),
  health: msg({ message: "Health", comment: "A launcher tile group" }),
  money: msg({ message: "Money", comment: "A launcher tile group" }),
  music: msg({ message: "Music", comment: "A launcher tile group" }),
  home: msg({ message: "Home", comment: "A launcher tile group: apps for the household" }),
  travel: msg({ message: "Travel", comment: "A launcher tile group" }),
  work: msg({ message: "Work", comment: "A launcher tile group" }),
  notes: msg({ message: "Notes", comment: "A launcher tile group" }),
};

export const UNNAMED_GROUP = msg({ message: "Group", comment: "A launcher tile group the person made and has not named yet" });

/** What a category's group is called: its proposed name, else the word itself, capitalised. */
export function categoryName(category: string | undefined, t: (d: MessageDescriptor) => string): string {
  if (!category) return t(UNNAMED_GROUP);
  const known = NAMES[category];
  if (known) return t(known);
  const word = category.replace(/-/g, " ");
  return word.charAt(0).toUpperCase() + word.slice(1);
}
