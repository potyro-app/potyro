// Referential integrity (phase 2 of validation, after `structureSchema`): every relation, binding,
// group, view column and quick action names something the app declares. Split out of validate.ts,
// which holds the Zod shape (phase 1).

import type { AppDefinition, EntityDef, View } from "./types/app.js";
import type { Field } from "./types/fields.js";
import { plainWords } from "./words-schema.js";

/** Top-level field keys + computed keys available on an entity for binding references. */
function boundKeys(entity: EntityDef): Set<string> {
  const keys = new Set<string>(Object.keys(entity.fields));
  for (const k of Object.keys(entity.computed ?? {})) keys.add(k);
  // Identity/timestamp fields are always addressable.
  keys.add("id");
  keys.add("createdAt");
  keys.add("updatedAt");
  return keys;
}

function checkFieldRelations(
  entityName: string,
  fields: Record<string, Field>,
  entityNames: Set<string>,
  issues: string[],
  path = "",
): void {
  for (const [key, field] of Object.entries(fields)) {
    const here = path ? `${path}.${key}` : key;
    if (field.type === "relation") {
      if (!entityNames.has(field.to)) {
        issues.push(`entity "${entityName}" field "${here}" is a relation to unknown entity "${field.to}"`);
      }
    } else if (field.type === "list") {
      checkFieldRelations(entityName, field.of, entityNames, issues, here);
    }
  }
}

/** Every group names fields (or computed) the entity has, and names each once: a form that shows a
 *  field twice would save whichever copy was edited last. The message names the offender (#100). */
function checkGroups(entityName: string, entity: EntityDef, issues: string[]): void {
  const known = boundKeys(entity);
  const seen = new Map<string, string>();
  for (const [i, group] of (entity.groups ?? []).entries()) {
    const where = `entity "${entityName}" group ${group.title ? `"${plainWords(group.title)}"` : `#${i + 1}`}`;
    for (const key of group.fields) {
      if (!known.has(key)) issues.push(`${where} names unknown field/computed "${key}"`);
      const earlier = seen.get(key);
      if (earlier !== undefined) issues.push(`${where} lists "${key}" again — it is already in ${earlier}`);
      else seen.set(key, where);
    }
  }
}

/** Referential integrity across the whole definition. */
export function checkReferences(def: AppDefinition): string[] {
  const issues: string[] = [];
  const entityNames = new Set(Object.keys(def.entities));

  // relations point at real entities
  for (const [name, entity] of Object.entries(def.entities)) {
    checkFieldRelations(name, entity.fields, entityNames, issues);
    checkGroups(name, entity, issues);
  }

  const ensureEntity = (entity: string, where: string): EntityDef | null => {
    const e = def.entities[entity];
    if (!e) issues.push(`${where} references unknown entity "${entity}"`);
    return e ?? null;
  };

  const ensureKey = (entity: EntityDef, entityName: string, key: string, where: string): void => {
    if (!boundKeys(entity).has(key)) {
      issues.push(`${where} references unknown field/computed "${key}" on entity "${entityName}"`);
    }
  };

  // pages / views — a page's own view, and every item of its layout (#105)
  const views: Array<{ v: View; where: string }> = [];
  for (const page of def.pages) {
    if (page.layout) {
      page.layout.items.forEach((item, i) => views.push({ v: item.view, where: `page "${page.id}" layout item ${i + 1}${item.title ? ` ("${plainWords(item.title)}")` : ""}` }));
    } else views.push({ v: page.view, where: `page "${page.id}" view` });
  }
  for (const { v, where } of views) {
    const entity = ensureEntity(v.entity, where);
    if (!entity) continue;

    const checkBinding = (b: unknown, label: string): void => {
      if (typeof b === "string") ensureKey(entity, v.entity, b, `${where} ${label}`);
    };

    switch (v.type) {
      case "list":
      case "gallery": {
        if (v.display) {
          checkBinding(v.display.primary, "display.primary");
          checkBinding(v.display.secondary, "display.secondary");
          if (v.display.media) ensureKey(entity, v.entity, v.display.media, `${where} display.media`);
          for (const b of v.display.badges ?? []) ensureKey(entity, v.entity, b, `${where} display.badges`);
        }
        checkBinding(v.group, "group");
        if (v.collapsible && v.group === undefined) issues.push(`${where} collapsible folds the group headings, so it needs \`group\``);
        break;
      }
      case "table": {
        for (const c of v.display?.columns ?? []) ensureKey(entity, v.entity, c, `${where} display.columns`);
        checkBinding(v.group, "group");
        if (v.collapsible && v.group === undefined) issues.push(`${where} collapsible folds the group headings, so it needs \`group\``);
        break;
      }
      case "detail": {
        for (const s of v.sections ?? []) {
          for (const fld of s.fields) ensureKey(entity, v.entity, fld, `${where} section "${plainWords(s.title)}"`);
        }
        break;
      }
      case "calendar": {
        checkBinding(v.date, "date");
        checkBinding(v.title, "title");
        checkBinding(v.color, "color");
        break;
      }
      case "map": {
        ensureKey(entity, v.entity, v.geo, `${where} geo`);
        checkBinding(v.title, "title");
        checkBinding(v.color, "color");
        break;
      }
      case "steps": {
        ensureKey(entity, v.entity, v.list, `${where} list`);
        break;
      }
      case "board": {
        // The columns ARE an enum's options: a board over a free-text field would have a column per
        // spelling, and a drop would write a value the field never offered.
        const col = entity.fields[v.column];
        if (!col) issues.push(`${where} column names unknown field "${v.column}" on entity "${v.entity}"`);
        else if (col.type !== "enum") issues.push(`${where} column "${v.column}" must be an enum field, not ${col.type}`);
        else {
          for (const c of v.columns ?? []) {
            if (!col.options.includes(c)) issues.push(`${where} columns names "${c}", which is not an option of "${v.column}" (${col.options.join(", ")})`);
          }
        }
        if (v.display) {
          checkBinding(v.display.primary, "display.primary");
          checkBinding(v.display.secondary, "display.secondary");
          if (v.display.media) ensureKey(entity, v.entity, v.display.media, `${where} display.media`);
          for (const b of v.display.badges ?? []) ensureKey(entity, v.entity, b, `${where} display.badges`);
        }
        break;
      }
      case "timeline": {
        // A string `date` must be a date field: a text field would sort "10 Sep" before "9 Sep".
        if (typeof v.date === "string") {
          const f = entity.fields[v.date];
          if (!f && !entity.computed?.[v.date]) issues.push(`${where} date names unknown field "${v.date}" on entity "${v.entity}"`);
          else if (f && f.type !== "datetime") issues.push(`${where} date "${v.date}" must be a datetime field, not ${f.type}`);
        }
        if (v.color !== undefined) {
          const c = entity.fields[v.color];
          if (!c || c.type !== "enum") issues.push(`${where} color "${v.color}" must be an enum field — its options' colours are the dots`);
        }
        if (v.display) {
          checkBinding(v.display.primary, "display.primary");
          checkBinding(v.display.secondary, "display.secondary");
          if (v.display.media) ensureKey(entity, v.entity, v.display.media, `${where} display.media`);
          for (const b of v.display.badges ?? []) ensureKey(entity, v.entity, b, `${where} display.badges`);
        }
        break;
      }
      case "stats": {
        for (const item of v.items) if (item.field) ensureKey(entity, v.entity, item.field, `${where} stat "${plainWords(item.label)}"`);
        break;
      }
      case "checklist": {
        // `done` must be something a tick can flip: a boolean, or an enum with a `doneValue` it has.
        const done = entity.fields[v.done];
        if (!done) issues.push(`${where} done names unknown field "${v.done}" on entity "${v.entity}"`);
        else if (done.type === "boolean") {
          if (v.doneValue !== undefined) issues.push(`${where} doneValue is for an enum \`done\`; "${v.done}" is a boolean`);
        } else if (done.type === "enum") {
          if (v.doneValue === undefined) issues.push(`${where} done "${v.done}" is an enum, so \`doneValue\` must say which option means done`);
          else if (!done.options.includes(v.doneValue)) {
            issues.push(`${where} doneValue "${v.doneValue}" is not an option of "${v.done}" (${done.options.join(", ")})`);
          }
        } else issues.push(`${where} done "${v.done}" must be a boolean or enum field, not ${done.type}`);
        checkBinding(v.text, "text");
        checkBinding(v.detail, "detail");
        checkBinding(v.group, "group");
        break;
      }
      case "custom":
        break;
    }
  }

  // reminders
  for (const r of def.reminders ?? []) {
    ensureEntity(r.entity, `reminder "${r.id}"`);
  }

  // the scope names a real entity
  if (def.scope) ensureEntity(def.scope.entity, "scope");

  // quick actions target a real entity (and its prefill keys are real fields)
  for (const qa of def.quickActions ?? []) {
    const e = ensureEntity(qa.entity, `quickAction "${qa.id}"`);
    if (e) for (const key of Object.keys(qa.prefill ?? {})) ensureKey(e, qa.entity, key, `quickAction "${qa.id}" prefill`);
  }

  return issues;
}
