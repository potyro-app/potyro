/**
 * A field key as a person would read it: `boughtBy` -> "Bought By", `needs_chilling` -> "Needs
 * Chilling". Used when an app declares no `label`.
 *
 * It lives in `schema` because both the views (rendering a form) and the runtime (describing a
 * change, KA-36) need it, and two copies is how two conventions start: the second implementation of
 * this produced "Needs chilling" where the first produced "Needs Chilling", and only a test caught
 * the difference.
 */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
