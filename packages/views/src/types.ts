import type { KartaRuntime } from "@karta/runtime";
import type { View } from "karta";
import type { ComponentType } from "react";

/** Props every built-in view component receives from the shell. */
export interface BuiltinViewProps {
  runtime: KartaRuntime;
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

export interface DisplayCell {
  primary?: string;
  secondary?: string;
  mediaUrl?: string;
  badges?: string[];
}

export interface ViewRegistration {
  type: View["type"];
  component: ComponentType<BuiltinViewProps>;
}
