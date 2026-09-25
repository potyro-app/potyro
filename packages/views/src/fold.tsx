// A heading that folds what is under it (#108): a group in a list, a section on a record page.
//
// The heading is a real button with `aria-expanded`, and what it controls is a region it names, so a
// screen reader hears "Restaurant, 3, expanded". Folded content is not rendered at all, which is
// what takes its rows out of the tab order. Whether it is open is remembered on this device, per
// page — the same place the layout folds (#105) keep theirs.

import { useId, useState, type ReactNode } from "react";

const read = (key: string): boolean | null => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : v === "open";
  } catch {
    return null;
  }
};
const write = (key: string, open: boolean): void => {
  try {
    localStorage.setItem(key, open ? "open" : "closed");
  } catch {
    /* a browser that blocks storage still folds; it just forgets */
  }
};

/** Open-or-folded, remembered under `key`; `initiallyOpen` until the person says otherwise. */
export function useFold(key: string, initiallyOpen: boolean): [boolean, () => void] {
  const [open, setOpen] = useState<boolean>(() => read(key) ?? initiallyOpen);
  const toggle = (): void => {
    setOpen((was) => {
      write(key, !was);
      return !was;
    });
  };
  return [open, toggle];
}

export const foldKey = (appId: string, pageId: string, part: string): string => `karta:fold:${appId}:${pageId}:${part}`;

export interface FoldProps {
  /** Where the open/folded state is remembered. */
  storageKey: string;
  title: ReactNode;
  /** Shown after the title, quieter: how many rows are under it. */
  count?: number;
  /** Folding is on; without it the heading is just a heading. */
  collapsible: boolean;
  initiallyOpen?: boolean;
  /** "group" for a list's group heading, "section" for a record page's section. */
  variant: "group" | "section";
  children: ReactNode;
}

export function Fold({ storageKey, title, count, collapsible, initiallyOpen = true, variant, children }: FoldProps) {
  const [openState, toggle] = useFold(storageKey, initiallyOpen);
  const open = collapsible ? openState : true;
  const regionId = useId();
  const headingText = (
    <>
      {collapsible ? (
        <span className="k-fold-chevron" aria-hidden>
          ▾
        </span>
      ) : null}
      {/* A record page's section is titled by the app; a list's group heading is a record's value. */}
      <span className="k-fold-title" data-k-wording={variant === "section" || undefined}>
        {title}
      </span>
      {count !== undefined ? <span className="k-fold-count">{count}</span> : null}
    </>
  );
  return (
    <div className={`k-fold k-fold-${variant}`} data-open={open ? "true" : "false"}>
      {collapsible ? (
        <button type="button" className="k-fold-head" aria-expanded={open} aria-controls={open ? regionId : undefined} onClick={toggle}>
          {headingText}
        </button>
      ) : (
        <div className="k-fold-head" role="heading" aria-level={variant === "section" ? 3 : 2}>
          {headingText}
        </div>
      )}
      {open ? (
        <div id={regionId} role="region" aria-label={typeof title === "string" ? title : undefined} className="k-fold-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}
