// The code in the Studio's editor, against the app as it is saved (#77).
//
// Save used to keep a version whatever the editor held: a person who opened the code, read it and
// pressed Save got "Changed by hand, in the code." on a version byte for byte the one before it.

/**
 * Whether Save has nothing to record: the entry is the saved one and no module was edited, made or
 * deleted. Never so for code that is not an app yet (`saved` null) — saving that is how it becomes one.
 */
export function draftIsSaved(draft: string, saved: string | null, changedModules: number): boolean {
  return saved !== null && changedModules === 0 && draft === saved;
}
