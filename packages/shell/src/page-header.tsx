// A page's header: what the page is, how many things are on it, what they add up to, and — when the
// app names one — the one thing the page is for, as a button nobody can miss.
//
// It replaces a bare title (wide) and nothing at all (phone), which left a list of two recipes as two
// rows at the top of an empty screen with no sense of whose page it was. Everything in it is the
// app's own data or words: the page's title and `description`, the view's count (told by the view,
// never queried again), the page's `summary` figures, its `primaryAction`, and its `background` —
// a soft glow of the app's colour by default, or a picture from the app's files behind the words.

import { useLingui } from "@lingui/react/macro";
import type { PotyroRuntime } from "@potyro/runtime";
import { backdropImage, backdropKind, backdropOf, pageOf, usePictureUrl } from "@potyro/views";
import type { Backdrop } from "potyro";
import { SummaryStrip } from "./summary-strip.js";

export interface PageCta {
  label: string;
  icon?: string;
  onRun: () => void;
  busy?: boolean;
}

interface PageHeaderProps {
  runtime: PotyroRuntime;
  pageId: string;
  params: Record<string, unknown>;
  title: string;
  icon: string;
  /** How many records the page's view shows; undefined while it loads, or for a layout. */
  count: number | undefined;
  cta?: PageCta;
  /** A sub-page's way back (wide screens; the phone's top bar has its own). */
  onBack?: () => void;
}

export function PageHeader({ runtime, pageId, params, title, icon, count, cta, onBack }: PageHeaderProps) {
  const { t } = useLingui();
  const def = runtime.definition as typeof runtime.definition & { theme?: { background?: Backdrop } };
  const page = pageOf(def, pageId) as ({ description?: string; background?: Backdrop } & (typeof def.pages)[number]) | undefined;
  const backdrop = backdropOf(def, page);
  const photo = usePictureUrl(runtime.ctx, backdropImage(def, page));
  const kind = backdropKind(backdrop);
  return (
    <header className="k-page-hero" data-backdrop={kind} data-photo={photo ? "true" : undefined}>
      {kind === "image" ? (
        <span className="k-page-hero-photo" aria-hidden>
          {photo ? <img src={photo} alt="" decoding="async" /> : null}
        </span>
      ) : null}
      <div className="k-page-hero-body">
        <div className="k-page-hero-top">
          {onBack ? (
            <button type="button" className="k-topbar-btn k-topbar-back k-page-back" aria-label={t`Back`} onClick={onBack}>
              ‹
            </button>
          ) : (
            <span className="k-page-hero-icon" aria-hidden>
              {icon}
            </span>
          )}
          <h2 className="k-page-title" data-k-page={pageId}>
            {title}
          </h2>
          {count !== undefined ? (
            <span className="k-page-count" aria-label={t({ message: `${count} shown`, comment: "How many records the page shows, read after its title" })}>
              {count}
            </span>
          ) : null}
        </div>
        {page?.description ? (
          <p className="k-page-desc" data-k-wording>
            {page.description}
          </p>
        ) : null}
        <SummaryStrip runtime={runtime} pageId={pageId} params={params} />
        {cta ? (
          <button type="button" className="k-cta" onClick={cta.onRun} disabled={cta.busy} aria-busy={cta.busy || undefined} data-k-wording>
            {cta.icon ? (
              <span className="k-cta-icon" aria-hidden>
                {cta.icon}
              </span>
            ) : null}
            <span>{cta.label}</span>
            <span className="k-cta-arrow" aria-hidden>
              →
            </span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
