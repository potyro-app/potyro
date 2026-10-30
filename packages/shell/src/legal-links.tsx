// The privacy page and the terms of use, linked where people decide something about their data (#117,
// docs/legal/README.md "Where the app must link them").
//
// Only when this build has them. The pages are built from docs/legal by packages/legal/src/vite.mjs,
// and only once no text there still waits for a placeholder; the same step sets
// `VITE_POTYRO_LEGAL`. Until then every link here renders nothing, so no build points at a page it
// does not serve. The pages are English for now; a link opens beside Potyro, so nothing in the app
// is left behind.

import type { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { currentSite, type Site } from "./site.js";

/**
 * The sections of the privacy page the app sends people to: the anchor each heading gets on the page
 * (GitHub's, from docs/legal/privacy.md). test/legal-links.test.ts fails when a heading changes.
 */
export const PRIVACY_SECTIONS = {
  sync: "sync-sharing-with-people-and-backup",
  links: "links-anyone-can-try",
  ai: "ai-inside-apps-and-the-free-allowance",
  voice: "voice",
  studio: "building-apps-in-the-studio-and-ask",
  requests: "requests-and-wording-suggestions-to-the-potyro-team",
  rights: "your-rights",
} as const;

export type PrivacySection = keyof typeof PRIVACY_SECTIONS;
export type LegalPage = "privacy" | "terms";

export interface LegalEnv {
  /** `import.meta.env.VITE_POTYRO_LEGAL`: "1" when this build has the pages. */
  built?: string;
  site: Site | null;
}

function currentEnv(): LegalEnv {
  return { built: import.meta.env?.VITE_POTYRO_LEGAL, site: currentSite() };
}

/** Where a page (and a section of the privacy page) is on this site, or null when there is none to link. Pure. */
export function legalHref(page: LegalPage, section?: PrivacySection, env: LegalEnv = currentEnv()): string | null {
  if (env.built !== "1" || !env.site) return null;
  const anchor = page === "privacy" && section ? `#${PRIVACY_SECTIONS[section]}` : "";
  return `${env.site.origin}${env.site.path}${page}${anchor}`;
}

/**
 * A link to the privacy page (at a section) or the terms, in a new tab; nothing when the build has no
 * pages. `block` puts it on a line of its own, so a screen that shows it has no empty line without it.
 */
export function LegalLink({ page = "privacy", section, children, block }: { page?: LegalPage; section?: PrivacySection; children: ReactNode; block?: boolean }) {
  const href = legalHref(page, section);
  if (!href) return null;
  const link = (
    <a className="k-legal-link" href={href} target="_blank" rel="noopener" data-legal={page} data-section={section}>
      {children}
    </a>
  );
  return block ? <p className="k-legal-note">{link}</p> : link;
}

/** Privacy and Terms of use side by side, for the You panel. Nothing when the build has no pages. */
export function LegalLinks() {
  const { t } = useLingui();
  if (!legalHref("privacy")) return null;
  return (
    <nav className="k-legal-links" aria-label={t({ message: "Privacy and terms", comment: "The links to Potyro's privacy page and terms of use" })}>
      <LegalLink page="privacy">
        <Trans comment="Link to Potyro's privacy page">Privacy</Trans>
      </LegalLink>
      <LegalLink page="terms">
        <Trans comment="Link to Potyro's terms of use">Terms of use</Trans>
      </LegalLink>
    </nav>
  );
}
