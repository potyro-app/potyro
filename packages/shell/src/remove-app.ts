// Deleting an app, asked the same way everywhere it can be asked.
//
// The launcher's tile menu asked carefully; the Studio's little ✕ did not ask at all — one tap and
// the app and everything in it were gone, with no way back ("right now if I click on the X the app
// is simply deleted!"). Two call sites, one of them silent, is exactly the shape a shared helper
// exists to prevent, so the question lives here and both paths call it.

import { t } from "@lingui/core/macro";
import { shellDialogs } from "./dialog.js";
import { removeUserApp, type UserApp } from "./user-apps.js";
import { recordLeft } from "./account-offer.js";
import { setAiStanding } from "./ai-setting.js";
import { forgetSocketStanding } from "./app-sockets.js";
import { forgetSpeechStanding } from "./app-speech.js";

/**
 * Ask, then delete. Answers whether it happened.
 *
 * A SHARED app is not yours alone, and deleting it is not the same act as deleting a private one:
 * it takes this device out of the space. The others keep the app and everything in it, and getting
 * back in means someone sending a new invite — so the question says that, rather than "this can't
 * be undone", which reads as "you will lose the data" and is the one thing that does not happen.
 */
export async function confirmAndRemoveApp(app: Pick<UserApp, "id" | "name" | "sync">): Promise<boolean> {
  const name = app.name;
  const ok = await shellDialogs.confirm(
    app.sync ? t`Leave “${name}”?` : t`Delete “${name}” and everything in it?`,
    {
      detail: app.sync
        ? t`This is a shared app. Everyone else keeps it and everything in it — but this device leaves, and getting back in needs a new invite from them.`
        : t`This deletes the app AND its data — every record you have added to it. It cannot be undone.`,
      ok: app.sync ? t({ message: "Leave", comment: "Button: leave a shared app" }) : t`Delete`,
      destructive: true,
    },
  );
  if (!ok) return false;
  // First: the rest of the removal clears conversations and history and can take a while, and an
  // app gone from the launcher must not be offered back by a boot that happens in between.
  forgetOnAccount(app.id);
  await removeUserApp(app.id);
  // The person allowed THIS app's AI (docs/23): another app arriving later under the same id asks again.
  setAiStanding(app.id, undefined);
  // And the hosts it was let connect to (docs/28), for the same reason.
  forgetSocketStanding(app.id);
  forgetSpeechStanding(app.id);
  return true;
}

/**
 * Take a deleted app off your account's list of apps, so "Load your apps?" does not offer it back.
 *
 * Only an app that had a space has an entry there. This device also remembers that it left that
 * space, so the app is not offered back HERE even while the account cannot be reached, or while
 * another of your devices that still has it keeps putting it back on the list.
 */
function forgetOnAccount(appId: string): void {
  const root = globalThis.localStorage?.getItem(`potyro:jazz:root:user:${appId}`);
  if (!root) return;
  recordLeft({ id: appId, root });
  // Not awaited: the relay may take seconds, and this device already knows not to offer it.
  void import("./open-store.js")
    .then((store) => store.forgetAppOnAccount(appId))
    .catch((e: unknown) => console.warn("[potyro] could not take a deleted app off your account:", e));
}
