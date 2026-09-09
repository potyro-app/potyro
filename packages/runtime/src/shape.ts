// What a candidate DESTROYED, compared with the app as it stood.
//
// Lives in runtime rather than the shell because two different callers need the same judgement:
// the shell's verification gate (a "fix" must not pass by deleting the feature) and the generator's
// modify guard and eval (a "modify" must not come back as a different app, and the eval counts how
// often it does). Neither may depend on the other, so the comparison sits below both. It is pure
// structure over a definition - no runtime, no store, no model.

/** The shape both the original app and a candidate expose that we compare — structural, so this
 *  needs no runtime and no schema import. */
export interface AppShape {
  pages: Array<{ id: string; view: { type: string; entity?: string } }>;
  /** Optional so the pages-only checks in tests keep compiling; every real definition has it. */
  entities?: Record<string, unknown>;
}

/**
 * What the candidate DESTROYED, or null if it destroyed nothing.
 *
 * Only removals and substitutions count. Adding a page is how a genuine fix for "tapping a city
 * should open a map" looks, so additions are free; dropping the map, or turning it into a form, is
 * the failure mode this exists to stop.
 */
export function structuralLoss(before: AppShape, after: AppShape): string | null {
  // Entities first: "it deleted my app" is usually the DATA model gone, with the pages that showed
  // it following. Naming the entity is more useful to a person (and to a retry prompt) than naming
  // the pages that depended on it.
  const lostEntities = Object.keys(before.entities ?? {}).filter((e) => !(after.entities && e in after.entities));
  if (lostEntities.length) {
    const list = lostEntities.map((e) => `"${e}"`).join(", ");
    return `removes the ${list} ${lostEntities.length === 1 ? "entity" : "entities"} the app already had — a change may add to the data model, never drop part of it`;
  }
  for (const page of before.pages) {
    if (!after.pages.some((p) => p.id === page.id)) {
      return `removes the "${page.id}" page (${page.view.type}) instead of fixing it — a change may add pages, never drop one the app already had`;
    }
  }
  return null;
}

/**
 * View-type substitutions the candidate makes — reported, NOT blocked.
 *
 * This used to fail the verdict, and it was wrong within one attempt. The rule came from a real
 * incident (a broken map replaced by a plain list — the feature deleted to make the case pass) and I
 * generalised it to "any view type change is a regression". The very next candidate changed a
 * hand-written `custom` view that hung into the built-in `map` view, which is exactly the right
 * repair, and the guard rejected it. Ranking view types by capability is not something this code can
 * do: `map → list` is a gutting and `custom → map` is a fix, and they are the same shape.
 *
 * So the render decides whether it WORKS (that is what `observe` is for), and the person decides
 * whether the substitution is what they wanted — which they can only do if they are told it happened.
 */
export function viewSubstitutions(before: AppShape, after: AppShape): string[] {
  const out: string[] = [];
  for (const page of before.pages) {
    const now = after.pages.find((p) => p.id === page.id);
    if (now && now.view.type !== page.view.type) {
      out.push(`the "${page.id}" page changes from a ${page.view.type} view to a ${now.view.type} view`);
    }
  }
  return out;
}

