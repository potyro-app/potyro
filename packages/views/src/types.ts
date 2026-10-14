import type { PotyroRuntime } from "@potyro/runtime";
import type { View } from "potyro";
import type { ComponentType } from "react";

/** Props every built-in view component receives from the shell. */
export interface BuiltinViewProps {
  runtime: PotyroRuntime;
  pageId: string;
  params: Record<string, unknown>;
  /** Update a view-chrome param (e.g. the pantry picker) — re-runs the query. */
  setParam: (key: string, value: unknown) => void;
  navigate: (pageId: string, param?: Record<string, string>) => void;
  /** Open the generated editor for a record (provided by the shell). Enables the Edit button. */
  onEdit?: (entity: string, id: string) => void;
  /** Open the create form pre-filled — e.g. the map passes the point you tapped, so you place first
   *  and fill in details after, instead of opening a second map inside the form. */
  onCreate?: (entity: string, initial: Record<string, unknown>) => void;
}

export interface Badge {
  /** The value: what the badge is keyed and tinted by. */
  text: string;
  /** What it reads as, when that differs from the value — an enum or tags option's `labels` (#302). */
  label?: string;
  /** The enum field the value came from, when it came from one — it carries the colour map. */
  field?: { colors?: Record<string, string> };
}

export interface DisplayCell {
  primary?: string;
  secondary?: string;
  mediaUrl?: string;
  /** A badge is its text plus, for an enum value, the tint that value wears everywhere (#98). */
  badges?: Badge[];
}

export interface ViewRegistration {
  type: View["type"];
  component: ComponentType<BuiltinViewProps>;
}
