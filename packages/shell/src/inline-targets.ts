// Edit mode's DOM side: which text on screen came straight from the app's source.
//
// The source side (`textSites` in app-source.ts) lists every literal the app shows. This walks the
// rendered page and pairs text nodes with those literals, so edit mode can highlight exactly what it
// can change and nothing else — no ✎ on a region that turns out to have nothing behind it.
//
// Two kinds of pairing, most precise first:
//
//   - TAGGED. The built-in views mark a field label with `data-k-field="entity.key"` and the chrome
//     marks a page title with `data-k-page="id"`. Those need no text match at all, which also covers
//     a label the app never wrote down (the key, humanized) — renaming it inserts one.
//   - LITERAL. Anything else whose text equals a display literal — a custom view's JSX, a tab, a
//     quick action. Inside a built-in view (`data-k-view`) only what the view marks `data-k-wording`
//     qualifies — a section title, an empty-state line, an action's label — because everything else
//     there is records, and a record's text can read exactly like one of the app's words.

import { humanizeKey } from "@potyro/views";
import type { AppShape, EntityShape, FieldShape, PageShape, TextSite } from "./app-source.js";

export type InlineTarget =
  | { kind: "text"; node: Text; text: string; sites: TextSite[] }
  | { kind: "field"; node: Text; text: string; entity: EntityShape; field: FieldShape }
  | { kind: "page"; node: Text; text: string; page: PageShape };

/** What the shell draws itself, not the app: its menus, tools, chat, and the edit UI. Point mode
 *  (#284) leaves these out too — they are not the app's, so there is nothing of the app to point at. */
export const SHELL_PARTS = [
  "[data-k-noedit]",
  '[role="menu"]',
  ".k-tools",
  ".k-recbar",
  ".k-chat-host",
  ".k-topbar-name",
  ".k-brand",
  ".k-sidebar-heading",
  ".k-modal:not(.k-sheet)",
].join(",");

/** …and, for edit mode, the controls and code whose text is not words on the screen. */
const NOT_THE_APP = [
  SHELL_PARTS,
  "input",
  "textarea",
  "select",
  "script",
  "style",
].join(",");

/** Text the way JSX renders it and `textSites` reports it: whitespace runs as one space, trimmed. */
export const normalizeText = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Where the app is on screen: the topmost sheet when one is open (views portal them to <body>,
 * stacked in DOM order), otherwise the chrome. Only one root, because the page behind a sheet still
 * lays out under it — marking it too would let a tap on the sheet land on a label hidden beneath.
 */
export function appRoots(doc: Document = document): Element[] {
  const sheets = doc.querySelectorAll(".k-sheet");
  const top = sheets[sheets.length - 1] ?? doc.querySelector(".k-app-chrome");
  return top ? [top] : [];
}

export function collectTargets(roots: readonly Element[], sites: readonly TextSite[], shape: AppShape): InlineTarget[] {
  const byText = new Map<string, TextSite[]>();
  for (const site of sites) byText.set(site.text, [...(byText.get(site.text) ?? []), site]);

  const out: InlineTarget[] = [];
  const seen = new Set<Node>();
  for (const root of roots) {
    const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const node = n as Text;
      if (seen.has(node)) continue;
      seen.add(node);
      const target = targetFor(node, byText, shape);
      if (target) out.push(target);
    }
  }
  return out;
}

function targetFor(node: Text, byText: Map<string, TextSite[]>, shape: AppShape): InlineTarget | null {
  const el = node.parentElement;
  if (!el || el.closest(NOT_THE_APP)) return null;
  const text = normalizeText(node.data);
  if (!text) return null;

  const pageEl = el.closest("[data-k-page]");
  if (pageEl) {
    const page = shape.pages.find((p) => p.id === pageEl.getAttribute("data-k-page"));
    // A title the app computes is code; overwriting it with a literal would quietly drop that.
    if (page && !page.titleOpaque) return { kind: "page", node, text, page };
  }

  const fieldEl = el.closest("[data-k-field]");
  if (fieldEl) {
    const [entityKey, key] = (fieldEl.getAttribute("data-k-field") ?? "").split(".");
    const entity = shape.entities.find((e) => e.key === entityKey);
    const field = entity?.fields.find((f) => f.key === key);
    // Only the label itself — a form row also holds help text, an error, the control's own words.
    // A translated label shows one of its languages (#302): any of them is the label.
    const isLabel = text === (field?.label ?? humanizeKey(field?.key ?? "")) || Object.values(field?.labels ?? {}).includes(text);
    if (entity && field && !entity.blocked && !field.labelOpaque && isLabel) {
      return { kind: "field", node, text, entity, field };
    }
  }

  // Inside a built-in view (or a strip or sheet the shell draws from records) text is DATA unless
  // the view marked it as the app's wording. Failing this way round is the point: a view that
  // forgets a tag offers less, where the opposite default offered a record called "Milk".
  const view = el.closest("[data-k-view]");
  if (view && !el.closest("[data-k-wording]")) return null;
  if (el.closest("[data-k-value]")) return null;
  const sites = byText.get(text);
  return sites ? { kind: "text", node, text, sites } : null;
}

/** Two targets are the same thing to change — so a rename patches every place it shows. */
export function sameThing(a: InlineTarget, b: InlineTarget): boolean {
  if (a.kind === "text" && b.kind === "text") return a.text === b.text;
  if (a.kind === "field" && b.kind === "field") return a.entity.key === b.entity.key && a.field.key === b.field.key;
  if (a.kind === "page" && b.kind === "page") return a.page.id === b.page.id;
  return false;
}
