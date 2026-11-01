// An app's quick actions: the create triggers in the action bar, the sidebar and the grid home.
//
// Declared, they are the app's own. Omitted, the shell offers an "Add: <Entity>" per top-level
// entity — never "New <Entity>", which would have to agree with the noun (docs/20 Q3). A declared
// EMPTY list is the app saying "none": its records are made by its own screens (a kept picture, a
// live feed's quake), and a bare form for one would make a record that means nothing (#484).

/** A declared quick action (mirrors potyro's QuickAction; kept structural to avoid a hard dep here). */
export interface QuickActionDef {
  id: string;
  label: string;
  icon?: string;
  entity: string;
  mode?: "auto" | "form" | "menu" | "instant";
  open?: boolean;
  openPage?: string;
  prefill?: Record<string, unknown>;
}

/** The quick actions to offer, before the per-person filter (who may add which entity). */
export function quickActionsOf(
  declared: readonly QuickActionDef[] | undefined,
  entities: readonly string[],
  addLabel: (entity: string) => string,
): QuickActionDef[] {
  if (declared) return [...declared];
  return entities.map((e) => ({ id: `new-${e}`, label: addLabel(e), entity: e, mode: "auto", open: true }));
}

/** Whether the app adds records by hand at all: `quickActions: []` says it does not. */
export const addsByHand = (declared: readonly unknown[] | undefined): boolean => declared?.length !== 0;
