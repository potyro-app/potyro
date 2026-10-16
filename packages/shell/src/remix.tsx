// Make it mine, from an app already on this device (docs/24 §6): someone else's app you kept, running
// sealed. The same card and the same install as Make it mine on a demo link, fed the package a demo
// link of this app would carry — so what the copy starts with is the app's sample records, never the
// records in this app (which may be a space other people write in), and its credit is its maker's.
import { readAppPackage, type AppPackage } from "@potyro/store";
import { AddAppDialog } from "./add-app-dialog.js";
import type { UserApp } from "./user-apps.js";

/**
 * Whether to offer Make it mine for this app: it runs sealed (someone else's code) and is not already a
 * remix of the person's own. Their own apps have Duplicate.
 */
export function canRemix(app: Pick<UserApp, "trusted" | "remixOf">): boolean {
  return app.trusted === false && !app.remixOf;
}

/** The package Make it mine copies: what a demo link of this app would carry. */
export async function remixPackage(app: UserApp): Promise<AppPackage> {
  const { demoPackageFor } = await import("./demo-package.js");
  // No `by`: the copy credits whoever made the app, never the person remixing it.
  const demo = await demoPackageFor(app);
  return readAppPackage(demo.zip);
}

export function RemixDialog({ app, onClose }: { app: UserApp; onClose: () => void }) {
  return <AddAppDialog initialPackage={() => remixPackage(app)} remix onClose={onClose} />;
}
