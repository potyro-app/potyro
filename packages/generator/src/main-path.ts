// Where the feature the request is ABOUT sits in the app that was made (#78).
//
// Asked for "an app where I take a photo of a wine bottle and it extracts the details", a first
// version put the scan on the saved record's page, behind a plain "Add bottle" form: the point of the
// app was the last thing the person found. Compile, validate and the smoke run all pass such an app.
// This is the create eval's scenario for it: requests that name a photo or a scan as the point, and a
// structural check of where the code that takes the picture is reachable from.
//
// ON THE MAIN PATH means one of:
//   - `form-fill`          the main kind of record has a `fill` button that does it (docs/04 "A form's
//                          fill"): the record STARTS from the photo;
//   - `first-page-action`  the first page's primary action does it: the button named by the page's
//                          `primaryAction` or `add`, or the first of its `actions`;
//   - `first-page-view`    the first page is the app's own view and that view does it.
// Anything else is where the request's point should not be the only way in: `first-page-button` (a
// later button of the first page), `elsewhere` (a saved record's action, another page, another kind
// of record), or `absent`.
//
// "Does it" is read from the source, never run: the function's own text and the text of every
// top-level function or const it names, however far down, matched against the scenario's `uses`. So
// a `run: scanLabel` whose camera call is three helpers away is found, and an `icon: "camera"` on a
// button that takes no picture is not. Code in another module of the app is not seen: the create
// eval's apps are one file.
//
// Nothing here calls a model. `eval:cli -- --corpus main-path` does, and costs money: run it only
// when the owner asks.

import type { GenPrompt } from "./backend.js";
import { readSourceWords, type SourceWords } from "./source-words.js";

export interface MainPathPrompt extends GenPrompt {
  /** What the request names as the point of the app, in a few words, for the report. */
  feature: string;
  /** What the code of that feature must reach: a case-insensitive regex source over function text. */
  uses: string;
}

/** Taking a picture: the camera capability, however it was reached (`ctx.caps.camera`, `const { camera } = ctx.caps`). */
const TAKES_PICTURE = "\\bcamera\\b|\\.capture\\s*\\(";

/**
 * Requests where a photo or a scan is the point. AUTHOR-WRITTEN in a person's register, like the wild
 * prompts (`source: "authored"` there); the first is the request #78 was opened on, word for word.
 * Few on purpose: each is a paid create when the eval runs.
 */
export const MAIN_PATH_PROMPTS: MainPathPrompt[] = [
  {
    id: "wine-label-photo",
    description: "an app where I take a photo of a wine bottle and it extracts the details",
    tags: ["main-path", "camera", "ai"],
    feature: "a photo of the bottle fills in its details",
    uses: TAKES_PICTURE,
  },
  {
    id: "receipt-photo-expenses",
    description: "I want to snap a picture of a receipt and have it saved as an expense with the shop, the date and the total filled in for me.",
    tags: ["main-path", "camera", "ai"],
    feature: "a photo of a receipt becomes an expense",
    uses: TAKES_PICTURE,
  },
  {
    id: "business-card-scan",
    description: "Scan business cards at conferences: I point the phone at a card and get a contact with the name, company, email and phone, plus where I met them.",
    tags: ["main-path", "camera", "ai"],
    feature: "scanning a card makes a contact",
    uses: TAKES_PICTURE,
  },
  {
    id: "plant-photo-identify",
    description: "Something for my plants where I photograph a new plant and it tells me what it is and how often to water it, and keeps it in a list.",
    tags: ["main-path", "camera", "ai"],
    feature: "a photo of a plant adds it, identified",
    uses: TAKES_PICTURE,
  },
  {
    id: "livros-foto-capa",
    description: "Quero um app pra minha estante: eu tiro uma foto da capa do livro e ele preenche o título e o autor, e depois eu marco se já li.",
    tags: ["main-path", "camera", "ai"],
    language: "pt-BR",
    feature: "a photo of the cover fills in the book",
    uses: TAKES_PICTURE,
  },
];

export type Where = "form-fill" | "first-page-action" | "first-page-view" | "first-page-button" | "elsewhere" | "absent";

export interface MainPathCheck {
  /** The best place the feature was found. */
  where: Where;
  onMainPath: boolean;
  /** The kind of record the first page shows; the first one declared when the page names none. */
  mainEntity: string | null;
  /** Every place the feature's code is reachable from, for the report: `bottle.fill[0]`, `bottle.actions.scan`, `pages[1].actions[0]`. */
  found: string[];
}

const ON_MAIN_PATH: readonly Where[] = ["form-fill", "first-page-action", "first-page-view"];
/** Best first: the place a report names when the feature is in several. */
const ORDER: readonly Where[] = ["form-fill", "first-page-action", "first-page-view", "first-page-button", "elsewhere", "absent"];

type Data = Record<string, unknown>;
interface Node {
  type: string;
  start: number;
  end: number;
  [k: string]: unknown;
}
const isData = (v: unknown): v is Data => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const nodesIn = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : []);

/** Every top-level function and const of the module, by name, as text. */
function declarations(sw: SourceWords): Map<string, string> {
  const out = new Map<string, string>();
  const program = (sw.ast as unknown as { program?: { body?: unknown } }).program;
  for (const top of nodesIn(program?.body)) {
    const node = top.type === "ExportNamedDeclaration" || top.type === "ExportDefaultDeclaration" ? (top.declaration as Node | undefined) : top;
    if (!node) continue;
    const text = sw.source.slice(node.start, node.end);
    if (node.type === "FunctionDeclaration") {
      const name = (node.id as { name?: string } | null)?.name;
      if (name) out.set(name, text);
    } else if (node.type === "VariableDeclaration") {
      for (const d of nodesIn(node.declarations)) {
        const name = (d.id as { name?: string } | undefined)?.name;
        // Not the app itself: `const app = defineApp({...})` would make everything reach everything.
        if (name && !(d.start <= sw.root.start && sw.root.end <= d.end)) out.set(name, sw.source.slice(d.start, d.end));
      }
    }
  }
  return out;
}

/** A piece of code and everything it names among the module's own functions and consts, however far down. */
function reach(text: string, known: Map<string, string>): string {
  const seen = new Set<string>();
  const queue = [text];
  let all = "";
  while (queue.length) {
    const next = queue.pop()!;
    all += `\n${next}`;
    for (const [name] of next.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const body = known.get(name);
      if (body !== undefined && !seen.has(name)) {
        seen.add(name);
        queue.push(body);
      }
    }
  }
  return all;
}

/**
 * Where the feature sits in an app, read from its source. Null when the source cannot be read as an
 * app (no `defineApp({...})`, or it does not parse): the eval's other gates say that.
 */
export async function featurePlacement(source: string, uses: string | RegExp): Promise<MainPathCheck | null> {
  const sw = await readSourceWords(source);
  if (!sw) return null;
  const pattern = typeof uses === "string" ? new RegExp(uses, "i") : uses;
  const known = declarations(sw);
  /** Does the code at `path` — a function, or the name of one — do it? */
  const does = (path: string): boolean => {
    const node = sw.nodes.get(path) ?? sw.nodes.get(`${path}#prop`);
    return node ? pattern.test(reach(sw.source.slice(node.start, node.end), known)) : false;
  };

  const entities = isData(sw.data.entities) ? sw.data.entities : {};
  const pages = Array.isArray(sw.data.pages) ? sw.data.pages : [];
  const first = isData(pages[0]) ? pages[0] : null;
  const firstView = first && isData(first.view) ? first.view : null;
  const firstLayoutItem = first && isData(first.layout) && Array.isArray(first.layout.items) && isData(first.layout.items[0]) ? first.layout.items[0] : null;
  const shown = [firstView?.entity, isData(firstLayoutItem?.view) ? firstLayoutItem.view.entity : firstLayoutItem?.entity].find((e): e is string => typeof e === "string" && e in entities);
  const mainEntity = shown ?? Object.keys(entities)[0] ?? null;

  const places: Array<{ where: Where; at: string }> = [];
  for (const [entity, def] of Object.entries(entities)) {
    if (!isData(def)) continue;
    if (Array.isArray(def.fill)) {
      def.fill.forEach((_f, i) => {
        if (does(`entities.${entity}.fill.${i}.run`)) places.push({ where: entity === mainEntity ? "form-fill" : "elsewhere", at: `${entity}.fill[${i}]` });
      });
    }
    if (isData(def.actions)) {
      for (const key of Object.keys(def.actions)) {
        // A record's action needs a saved record: the place #78 says must not be the only one.
        if (does(`entities.${entity}.actions.${key}`)) places.push({ where: "elsewhere", at: `${entity}.actions.${key}` });
      }
    }
  }
  pages.forEach((page, p) => {
    if (!isData(page)) return;
    const actions = Array.isArray(page.actions) ? page.actions : [];
    const primary = new Set<number>([0, ...[page.primaryAction, page.add].filter((n): n is number => typeof n === "number")]);
    actions.forEach((_a, i) => {
      if (!does(`pages.${p}.actions.${i}.run`)) return;
      places.push({ where: p !== 0 ? "elsewhere" : primary.has(i) ? "first-page-action" : "first-page-button", at: `pages[${p}].actions[${i}]` });
    });
    const view = isData(page.view) ? page.view : null;
    if (view?.type === "custom" && (does(`pages.${p}.view.render`) || does(`pages.${p}.view.mount`))) {
      places.push({ where: p === 0 ? "first-page-view" : "elsewhere", at: `pages[${p}].view` });
    }
  });

  const where = ORDER.find((w) => places.some((pl) => pl.where === w)) ?? "absent";
  return { where, onMainPath: ON_MAIN_PATH.includes(where), mainEntity, found: places.map((pl) => pl.at) };
}

export interface MainPathSummary {
  /** Apps that could be read at all. */
  checked: number;
  onMainPath: number;
  where: Record<Where, number>;
}

/** The scenario's line in a report: how many apps have the feature on the main path, and where the rest have it. */
export function summarizeMainPath(checks: ReadonlyArray<MainPathCheck | null>): MainPathSummary {
  const where: Record<Where, number> = { "form-fill": 0, "first-page-action": 0, "first-page-view": 0, "first-page-button": 0, elsewhere: 0, absent: 0 };
  const read = checks.filter((c): c is MainPathCheck => c !== null);
  for (const c of read) where[c.where] += 1;
  return { checked: read.length, onMainPath: read.filter((c) => c.onMainPath).length, where };
}
