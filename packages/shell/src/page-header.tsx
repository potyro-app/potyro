// What sits above a page's view: as little as possible.
//
// It used to be a header card — the page's icon and title (already in the app bar and the tab),
// its description, a count, boxes of figures and a big button, often over a photo — and on a phone
// it pushed the list the person came for below the fold, on every visit. A shopping list is used in
// a shop: the first item belongs right under the app bar.
//
// So: the page's figures, as one line ("8 left · 5 in the basket"), and nothing else. The page's
// frequent action is a bar at the bottom (page-primary.tsx). Its description belongs where pages are
// listed, not on the page. A `background` picture is the page's ground — faded behind the top of the
// page, under the content — never a block that takes height.

import type { PotyroRuntime } from "@potyro/runtime";
import { backdropImage, pageOf, usePictureUrl } from "@potyro/views";
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
}

export function PageHeader({ runtime, pageId, params }: PageHeaderProps) {
  const def = runtime.definition as typeof runtime.definition & { theme?: { background?: Backdrop } };
  const page = pageOf(def, pageId) as ({ background?: Backdrop } & (typeof def.pages)[number]) | undefined;
  const photo = usePictureUrl(runtime.ctx, backdropImage(def, page));
  return (
    <>
      {photo ? (
        <span className="k-page-ground" aria-hidden>
          <img src={photo} alt="" decoding="async" draggable={false} />
        </span>
      ) : null}
      <div className="k-page-figures">
        <SummaryStrip runtime={runtime} pageId={pageId} params={params} />
      </div>
    </>
  );
}
