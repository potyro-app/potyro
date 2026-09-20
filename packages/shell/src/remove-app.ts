// Deleting an app, asked the same way everywhere it can be asked.
//
// The launcher's tile menu asked carefully; the Studio's little ✕ did not ask at all — one tap and
// the app and everything in it were gone, with no way back ("right now if I click on the X the app
// is simply deleted!"). Two call sites, one of them silent, is exactly the shape a shared helper
// exists to prevent, so the question lives here and both paths call it.

import { shellDialogs } from "./dialog.js";
import { removeUserApp, type UserApp } from "./user-apps.js";

/**
 * Ask, then delete. Answers whether it happened.
 *
 * A SHARED app is not yours alone, and deleting it is not the same act as deleting a private one:
 * it takes this device out of the space. The others keep the app and everything in it, and getting
 * back in means someone sending a new invite — so the question says that, rather than "this can't
 * be undone", which reads as "you will lose the data" and is the one thing that does not happen.
 */
export async function confirmAndRemoveApp(app: Pick<UserApp, "id" | "name" | "sync">): Promise<boolean> {
  const ok = await shellDialogs.confirm(
    app.sync ? `Leave “${app.name}”?` : `Delete “${app.name}” and everything in it?`,
    {
      detail: app.sync
        ? "This is a shared app. Everyone else keeps it and everything in it — but this device leaves, and getting back in needs a new invite from them."
        : "This deletes the app AND its data — every record you have added to it. It cannot be undone.",
      ok: app.sync ? "Leave" : "Delete",
      destructive: true,
    },
  );
  if (!ok) return false;
  await removeUserApp(app.id);
  return true;
}
