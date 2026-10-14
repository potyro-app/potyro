// Making a demo link for one of your apps (docs/24 §2): the app, its demo records, and nothing of yours.
import { t } from "@lingui/core/macro";
import { demoPackageFor } from "./demo-package.js";
import { inlineDemoLink } from "./demo-link.js";
import { shareEvent } from "./share-events.js";
import type { UserApp } from "./user-apps.js";

export interface MadeDemoLink {
  link: string;
  /** Hosted links get a preview card in chats; an inline one shows the site's own. */
  hosted: boolean;
}

export interface DemoLinkOptions {
  /** The sharer's name, when they chose to show it. */
  by?: string;
  /** Where the site is, for the link. Defaults to this page's. */
  origin?: string;
  pathname?: string;
}

export async function makeDemoLink(app: UserApp, opts: DemoLinkOptions = {}): Promise<MadeDemoLink> {
  const zip = await demoPackageFor(app, { by: opts.by });
  const link = inlineDemoLink(zip, opts.origin ?? location.origin, opts.pathname ?? location.pathname);
  if (!link) {
    const name = app.name;
    throw new Error(t`“${name}” is too big to fit in a link on its own. Send its package instead: in the Studio, Files → Save as a package.`);
  }
  shareEvent("demo-link-made");
  shareEvent("demo-link-inline");
  return { link, hosted: false };
}
