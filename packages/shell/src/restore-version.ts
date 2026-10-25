// Putting a version from History back (#448): its source, the libraries it ran with, and its own
// modules as they were — written back to this device first, so the restored app runs exactly the
// code that version ran, not its old entry file over today's modules.
import type { AppVersion } from "./app-history.js";
import { keepCode, ownModuleCode, withOwnModules } from "./app-modules.js";
import { lockToRestore, saveUserApp, type UserApp } from "./user-apps.js";

/**
 * Restore `version` of `app` as a new version of it. `note` is what History and the conversation show
 * for it (stored in English; `shownNote` translates it where it is read). Resolves to the saved app.
 */
export async function restoreVersion(app: UserApp, version: AppVersion, note: string, now: string): Promise<UserApp> {
  let lock = lockToRestore(version, app);
  if (version.modules) {
    const code = await ownModuleCode(version.modules);
    await keepCode(app.id, code.files);
    lock = withOwnModules(lock, code.lock);
  }
  return saveUserApp(
    {
      id: app.id,
      name: app.name,
      source: version.source,
      lock,
      ...(version.modules ? { modules: version.modules } : {}),
      origin: "restored",
      note,
    },
    now,
  );
}
