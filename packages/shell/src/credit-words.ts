// Who made an app, in words (docs/24 §6): "By Ana · Remix of Groceries by Jo".
import { t } from "@lingui/core/macro";
import type { AppCredit } from "@potyro/store";

/** The remix half: "Remix of Groceries by Jo", or without a maker when they did not say. */
export function remixLine(of: AppCredit): string {
  const name = of.name;
  const by = of.by;
  return by
    ? t({ message: `Remix of ${name} by ${by}`, comment: "Who made the app a remix came from" })
    : t({ message: `Remix of ${name}`, comment: "The app a remix came from, when its maker did not say who they are" });
}

/** The whole line for a credit, or null when there is nothing to say. */
export function creditLine(credit: AppCredit | undefined): string | null {
  if (!credit) return null;
  const parts: string[] = [];
  if (credit.by) {
    const by = credit.by;
    parts.push(t({ message: `By ${by}`, comment: "Who made an app" }));
  }
  if (credit.remixOf) parts.push(remixLine(credit.remixOf));
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The credit a link to this app carries (docs/24 §6). A kept app is passed on as its maker's, never
 * as the person's who passes it on; a remix is theirs, and says what it remixed; anything else is theirs.
 */
export function creditToShare(app: { name: string; credit?: AppCredit; remixOf?: AppCredit }, by: string | undefined): AppCredit {
  if (app.credit && !app.remixOf) return app.credit;
  return { name: app.name, ...(by ? { by } : {}), ...(app.remixOf ? { remixOf: app.remixOf } : {}) };
}
