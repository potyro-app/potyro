// A record shared on its own (docs/24 §12): the pure parts.
//
// ## The unit
//
// An app's space shares everything in it: a shopping list is the unit. A document is not — a
// person shares ONE document, and Etherpad's link is a pad's. An entity declared `share: "record"`
// makes each of its records the unit: the record lives in a cojson group of its own, which
// `extend`s the app's space group (so the app's members are its members, with their roles), and
// whoever its link lets in is a member of that group and nothing else of the app's.
//
// ## What follows a record
//
// The records that point at it — a document's comments, through their `relation` to it — are made
// in the record's group and listed ON the record, in a map the record's own group owns (`KIDS`),
// never in the space's index: a person who only has the document must see its comments, and the
// space's index is the space's. Reading a child entity unions the space's index with every visible
// shared record's list; writing a child whose parent is reachable puts it there.
//
// ## Access
//
// A group answers `myRole()`: the record's maker is its admin (and may invite), the app's members
// have what they have in the app, whoever came in by a link has what the link granted.

import type { Field } from "potyro";

/** The key on a shared record's map that holds its list of the records that point at it. */
export const KIDS = "\u0004kids";

/** A child's key in that list: the entity, then the record id. `\u0000` is in no entity name. */
export const kidKey = (entity: string, id: string): string => `${entity}\u0000${id}`;

/** The record id a key in that list names for `entity`, or `null` when it is another entity's. */
export function kidId(entity: string, key: string): string | null {
  const prefix = `${entity}\u0000`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/**
 * child entity -> the shared entity its records belong to and the relation field naming it. A
 * record of such an entity that names a shared record goes with it; one that names none stays in
 * the space. An entity pointing at two shared entities follows the first declared.
 */
export function childrenOf(schema: Record<string, Record<string, Field>>, shared: ReadonlySet<string>): Map<string, { parent: string; field: string }> {
  const out = new Map<string, { parent: string; field: string }>();
  for (const [entity, fields] of Object.entries(schema)) {
    if (shared.has(entity)) continue;
    for (const [key, field] of Object.entries(fields)) {
      if (field.type === "relation" && !field.many && shared.has(field.to)) {
        out.set(entity, { parent: field.to, field: key });
        break;
      }
    }
  }
  return out;
}

/** cojson's roles as what a person may do: look, change, or also invite. */
export function roleToAccess(role: string | undefined): "reader" | "writer" | "admin" {
  if (role === "admin") return "admin";
  if (role === "writer" || role === "writeOnly" || role === "manager") return "writer";
  return "reader";
}
