// Making a demo link for one of your apps (docs/24 §2): the app, its demo records, and nothing of yours.
//
// Hosted first — a short link with a preview card in chats — when the share service answers; else the
// inline link, which needs nothing but a static site and shows no preview.
import { t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import { demoPackageFor, type DemoPackage } from "./demo-package.js";
import { inlineDemoLink } from "./demo-link.js";
import { previewLines, renderPreviewCard } from "./preview-card.js";
import { shareEvent } from "./share-events.js";
import type { UserApp } from "./user-apps.js";
import { appKey, getEntry } from "./launcher-store.js";
import { currentSite } from "./site.js";

export interface MadeDemoLink {
  link: string;
  /** Hosted links get a preview card in chats; an inline one shows the site's own. */
  hosted: boolean;
}

export interface DemoLinkOptions {
  /** The sharer's name, when they chose to show it. */
  by?: string;
  /** Where the site is, for an inline link. Defaults to this page's. */
  origin?: string;
  pathname?: string;
  /** Test seams. */
  serviceUp?: () => Promise<boolean>;
}

/** What a chat shows for the link: the app's name, and one line in the sharer's language. Never a record. */
export function previewMeta(name: string, by: string | undefined): { title: string; description: string; lang: string } {
  return {
    title: name,
    description: by
      ? t({ message: `By ${by}. Try it in your browser: no account, nothing to install.`, comment: "A shared app's link preview, under its name" })
      : t({ message: "Try it in your browser: no account, nothing to install.", comment: "A shared app's link preview, under its name" }),
    lang: i18n.locale || "en",
  };
}

async function hosted(app: UserApp, demo: DemoPackage): Promise<string> {
  // The maker the link names, which for a kept app is its maker, not the person passing it on.
  const by = demo.credit.by;
  const name = demo.credit.name;
  const [{ hostDemo }] = await Promise.all([import("./share-service.js")]);
  const image = await renderPreviewCard({
    name,
    icon: demo.icon,
    image: getEntry(appKey("user", app.id)).iconImage?.image,
    accent: demo.accent,
    by: by ? t({ message: `by ${by}`, comment: "Under an app's name on its link preview" }) : undefined,
    lines: previewLines(demo.seed, demo.entities),
    made: t({ message: "Made with Potyro", comment: "Demo bar: links to Potyro itself" }),
    tryIt: t({ message: "Try it in your browser — no account", comment: "Footer of a shared app's link preview picture" }),
  }).catch(() => null);
  return hostDemo({ appId: app.id, zip: demo.zip, meta: previewMeta(name, by), ...(image ? { image } : {}) });
}

export async function makeDemoLink(app: UserApp, opts: DemoLinkOptions = {}): Promise<MadeDemoLink> {
  const demo = await demoPackageFor(app, { by: opts.by });
  const up = opts.serviceUp ?? (async () => (await import("./share-service.js")).shareServiceUp());
  if (await up()) {
    try {
      const link = await hosted(app, demo);
      shareEvent("demo-link-made");
      return { link, hosted: true };
    } catch (e) {
      // The service is there and said no (too many today, say): the inline link still works.
      console.warn("[potyro] the share service did not take this link; making one that carries the app:", e);
    }
  }
  // Named by the build in the native app, where the page is the phone (site.ts).
  const site = currentSite();
  const named = site?.configured ? site : null;
  const origin = opts.origin ?? named?.origin ?? location.origin;
  const pathname = opts.pathname ?? named?.path ?? location.pathname;
  // Too long as it is: first without its pictures (a backdrop, sample photos) — the app and its sample
  // records still arrive, on plain grounds; then, still too long with its demo records (docs/24 §2's
  // limit), the app on its own, which opens empty, as it would for anyone who adds it.
  let link = inlineDemoLink(demo.zip, origin, pathname);
  if (!link && demo.pictures) link = inlineDemoLink((await demoPackageFor(app, { by: opts.by, pictures: false })).zip, origin, pathname);
  if (!link && demo.bare) link = inlineDemoLink(demo.bare, origin, pathname);
  if (!link) {
    const name = app.name;
    throw new Error(t`“${name}” is too big to fit in a link on its own. Send its package instead: in the Studio, Files → Save as a package.`);
  }
  shareEvent("demo-link-made");
  shareEvent("demo-link-inline");
  return { link, hosted: false };
}
