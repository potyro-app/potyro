// Turning an account id into something a person can tell apart.
//
// Shared by everything that renders somebody: chat (KA-35), activity (KA-36), the member chip
// (KA-19). Two copies of these rules would drift, and drift here is visible — the same person
// reading as "You" on one line and `co_z9f…` on the next, or changing colour between screens.

import type { Person } from "potyro";

/**
 * An account id as a person to read: "You", their name, or a short id.
 *
 * The last branch is not a fallback for a bug: someone who has LEFT the space is no longer in
 * `members`, and their edits and messages stay in the log forever. There is no name to find, so the
 * only honest answer is something stable and distinguishable rather than a blank.
 */
export function memberName(
  id: string,
  who: { me?: Person; members?: readonly { id: string; name: string }[] },
): string {
  if (who.me && id === who.me.id) return "You";
  return who.members?.find((m) => m.id === id)?.name ?? `${id.slice(0, 8)}…`;
}

/**
 * A colour for a person, derived from their account id.
 *
 * **Derived, never assigned.** Nothing is stored and nothing is agreed: every device computes the
 * same hue from the same id, so a person is the same colour on everyone's screen. Assigning colours
 * (first-come indices, a field on the member) would need a writer, a conflict policy, and a
 * migration — and would still disagree between two peers who joined in a different order.
 *
 * It exists because the NAME cannot be relied on to distinguish anyone. A fresh identity is called
 * "Me" until its owner renames it, so a space of three people is three lines of "Me"; and nothing
 * stops two people choosing the same name. The colour is the part that cannot collide by accident.
 *
 * Returns a hue for `oklch()`, not a finished colour: fixing lightness and chroma in CSS is what
 * keeps every person's colour equally readable against the page, which a hash straight to RGB
 * cannot promise.
 */
export function personHue(id: string): number {
  // Twelve, evenly spread. More would put two people a few degrees apart and call them different.
  const HUES = [25, 55, 85, 115, 145, 175, 205, 235, 265, 295, 325, 355];
  // FNV-1a: tiny, no dependency, and well-spread for short strings — an id's first characters are
  // shared by every account (`co_z…`), so a weaker hash would cluster everyone on one colour.
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return HUES[Math.abs(h) % HUES.length]!;
}

/**
 * One or two letters to put in an avatar.
 *
 * Falls back to the account id rather than to a generic glyph: every unnamed person would otherwise
 * share the same initial, which is exactly the ambiguity this is here to remove.
 */
export function personInitials(name: string, id: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const one = words[0] ?? "";
  // "Me" is everybody's default, so it identifies nobody. Two characters of the id do.
  if (one && one.toLowerCase() !== "me") return one.slice(0, 2).toUpperCase();
  return id.replace(/^co_z?/, "").slice(0, 2).toUpperCase();
}
