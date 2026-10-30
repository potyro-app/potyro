// Where a person writes to Potyro: one place for the addresses (contacts.json), read by the shell here
// and by the gallery's build (gallery/src/build.mjs).
//
// `ABUSE_CONTACT` is the report address the terms name (docs/legal/terms.md, "Reporting illegal
// content"; issue #11). It is the placeholder `<ABUSE EMAIL>` until the owner fills it in
// contacts.json — and until then a report goes to the general address, which is read today, rather
// than to a `mailto:` nobody can send to. Fill it in once and every "Report" follows.

import contacts from "./contacts.json";

export const ABUSE_CONTACT: string = contacts.abuse;
export const GENERAL_CONTACT: string = contacts.general;

/** `<ABUSE EMAIL>` and the like: a value nobody has filled in yet. */
export const isPlaceholder = (address: string): boolean => /^<[^>]*>$/.test(address.trim());

/** Where a report about a link goes: the abuse address once it is filled in, the general one until then. */
export function reportAddress(): string {
  return isPlaceholder(ABUSE_CONTACT) ? GENERAL_CONTACT : ABUSE_CONTACT;
}

/** A `mailto:` for a report, with its subject and the start of its text. */
export function reportMailto(subject: string, body: string): string {
  return `mailto:${reportAddress()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
