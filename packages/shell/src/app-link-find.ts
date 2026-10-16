// Which of this device's apps a link opens (docs/24 §11): the one with the link's line, else a remix
// of that app, preferring the most recently changed. See app-link.ts for what a line is.
import { derivedLine, matchLinkedApp } from "./app-link.js";
import { listUserApps, type UserApp } from "./user-apps.js";

export async function findLinkedApp(line: string): Promise<UserApp | null> {
  const apps = listUserApps();
  // Only a declared id can be `id:…`; a line of an app's own is random, so a random line is never
  // worth reading every app's source for.
  const byId = line.startsWith("id:");
  const { declaredAppId } = byId ? await import("./source-declared.js") : { declaredAppId: undefined };
  const candidates = await Promise.all(
    apps.map(async (app) => ({
      id: app.id,
      app,
      line: app.line ?? (declaredAppId ? derivedLine(await declaredAppId(app.source)) : undefined),
      lineOf: app.lineOf,
    })),
  );
  return matchLinkedApp(candidates, line)?.app ?? null;
}
