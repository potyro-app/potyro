// The notes the shell writes on a version itself, in the person's language (#299).
//
// A version's note is stored, and it travels: History on every device and every member of a shared
// app reads the same record, in whatever language each of them uses. And some of these notes are
// RECOGNISED by their words — `SYSTEM_NOTES` in studio-thread.ts tells a seeded example or a copy
// from a request. So the shell keeps writing them in English, and translates them where they are
// shown. A note the person wrote (what they asked for) is theirs and is shown as it is.

import { t } from "@lingui/core/macro";

/** `note` as the person reads it: the shell's own notes in their language, anything else unchanged. */
export function shownNote(note: string): string {
  switch (note) {
    case "example app":
      return t({ message: "example app", comment: "A version's note in History: the app came with Potyro" });
    case "the source before history was kept":
      return t`the source before history was kept`;
    case "from your account":
      return t`from your account`;
    case "from your account, replacing this device's copy":
      return t`from your account, replacing this device's copy`;
    case "shared with you":
      return t({ message: "shared with you", comment: "A version's note in History: someone shared the app with you" });
    case "updated by a collaborator":
      return t`updated by a collaborator`;
    // Not a version's: the line a shared conversation ends with (studio-chat.ts `importChat`).
    case "how it was made, as shared by its author":
      return t`how it was made, as shared by its author`;
  }
  let m = /^copied from “(.*)”$/s.exec(note);
  if (m) {
    const name = m[1]!;
    return t`copied from “${name}”`;
  }
  // A remix's first version (add-app.ts `remixNote`): what it remixed, and who made that when they said.
  m = /^remix of “(.*)” by (.+)$/s.exec(note);
  if (m) {
    const name = m[1]!;
    const by = m[2]!;
    return t({ message: `remix of “${name}” by ${by}`, comment: "A version's note in History, lower case: this app is a remix of another, made by someone" });
  }
  m = /^remix of “(.*)”$/s.exec(note);
  if (m) {
    const name = m[1]!;
    return t({ message: `remix of “${name}”`, comment: "A version's note in History, lower case: this app is a remix of another" });
  }
  m = /^(rolled|went) back to version (\d+)$/.exec(note);
  if (m) {
    const seq = m[2]!;
    return m[1] === "went"
      ? t({ message: `went back to version ${seq}`, comment: "A version's note, lower case: the app was put back to an older version from the Studio" })
      : t({ message: `rolled back to version ${seq}`, comment: "A version's note, lower case: the app was put back to an older version from History" });
  }
  m = /^(.*) — from a collaborator$/s.exec(note);
  if (m) {
    const asked = m[1]!;
    return t({ message: `${asked} — from a collaborator`, comment: "A version's note in History: what a collaborator asked for, and that it came from them" });
  }
  return note;
}
