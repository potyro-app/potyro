// An account's display name, read off its profile.
//
// Best-effort on purpose: a profile is its own CoValue and may not be on this device yet, so a
// name that has not arrived reads as `undefined` and the caller shows the id. Blocking on every
// peer's profile would be the worse trade (see `spaceMembers`).

/** The name on an account's profile, or `undefined` when the profile has not reached this device. */
export async function accountName(node: { load(id: string): Promise<unknown> }, id: string): Promise<string | undefined> {
  try {
    const account = (await node.load(id)) as { get?(k: string): unknown } | "unavailable" | null;
    if (!account || account === "unavailable") return undefined;
    const profileId = account.get?.("profile");
    if (typeof profileId !== "string") return undefined;
    const profile = (await node.load(profileId)) as { get?(k: string): unknown } | "unavailable" | null;
    if (!profile || profile === "unavailable") return undefined;
    const n = profile.get?.("name");
    return typeof n === "string" && n ? n : undefined;
  } catch {
    // A profile that will not load is not a reason to fail; the id still identifies the person.
    return undefined;
  }
}
