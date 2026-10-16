// What an app declares, read from its source WITHOUT running it: its entities' literal fields (the
// Data panel's definition) and its languages (#302). Split out of app-source.ts.

import { asArray, findDefinition, keyOf, literalLanguages, literalOf, literalString, literalWords, load, parseModule, propValue, type JsonLiteral, type Node } from "./source-ast.js";

/** One entity's declared data shape: the literal parts of each field, and nothing that would run. */
export interface DeclaredEntity {
  /** A string, or a translation map (#302). */
  label?: string | Record<string, string>;
  displayField?: string;
  editableBy?: string;
  /** Field key → the field's literal properties (`type`, `options`, `to`, `currency`…). A property
   *  written as anything but a literal — `default: () => …` — is left out, never evaluated. */
  fields: Record<string, Record<string, JsonLiteral>>;
  /** Fields declared as something this can't read (a helper call, a shared const). */
  opaque: string[];
}


/**
 * The entities an app declares, read from its source WITHOUT running it.
 *
 * The data panel needs each field's type to show and edit a stored value, and the app that declared
 * it may be someone else's: evaluating the module to find out would run untrusted code with the
 * shell's authority. The fields are plain data (docs/03), so the literal parts are all there is to
 * know — anything computed is skipped rather than guessed.
 */
/** The app's own language and the ones it carries, read without running it (#302). */
export async function declaredLanguages(source: string): Promise<{ language?: string; languages?: string[] }> {
  const t = await load();
  const ast = t ? parseModule(t, source) : null;
  return ast ? literalLanguages(findDefinition(ast)) : {};
}

export async function declaredEntities(source: string): Promise<Record<string, DeclaredEntity> | null> {
  const t = await load();
  if (!t) return null;
  const ast = parseModule(t, source);
  if (!ast) return null;
  const def = findDefinition(ast);
  const entitiesNode = propValue(def, "entities");
  if (entitiesNode?.type !== "ObjectExpression") return null;

  const out: Record<string, DeclaredEntity> = {};
  for (const ep of asArray(entitiesNode.properties)) {
    if (ep.type !== "ObjectProperty" || ep.computed === true) continue;
    const name = keyOf(ep);
    if (!name) continue;
    const entityNode = ep.value as Node;
    const fields: DeclaredEntity["fields"] = {};
    const opaque: string[] = [];
    const fieldsNode = propValue(entityNode, "fields");
    for (const fp of fieldsNode?.type === "ObjectExpression" ? asArray(fieldsNode.properties) : []) {
      const key = fp.type === "ObjectProperty" && fp.computed !== true ? keyOf(fp) : undefined;
      if (!key) continue;
      const value = literalOf(fp.value as Node);
      if (value && typeof value === "object" && !Array.isArray(value) && typeof value.type === "string") fields[key] = value;
      else opaque.push(key);
    }
    const label = literalWords(propValue(entityNode, "label"));
    const displayField = literalString(propValue(entityNode, "displayField"));
    const editableBy = literalString(propValue(entityNode, "editableBy"));
    out[name] = {
      fields,
      opaque,
      ...(label ? { label } : {}),
      ...(displayField ? { displayField } : {}),
      ...(editableBy ? { editableBy } : {}),
    };
  }
  return out;
}

/** The app's declared `id`, read without running it: which app it is when it has no line of its own (app-link.ts). */
export async function declaredAppId(source: string): Promise<string | undefined> {
  const t = await load();
  const ast = t ? parseModule(t, source) : null;
  return ast ? literalString(propValue(findDefinition(ast), "id")) : undefined;
}
