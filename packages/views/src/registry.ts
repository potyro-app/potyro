import type { ComponentType } from "react";
import type { View } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { GalleryView, ListView, TableView } from "./builtins.js";
import { DetailView } from "./detail.js";
import { CalendarView } from "./calendar.js";
import { StepsView } from "./steps.js";
import { MapView } from "./map.js";
import { CustomView } from "./custom.js";
import { AggregateView } from "./aggregate.js";
import { ChecklistView } from "./checklist.js";
import { BoardView } from "./board.js";
import { StatsView } from "./stats.js";
import { TimelineView } from "./timeline.js";
import { ChartView } from "./chart.js";

/** The default view registry (docs/05 view contract). Extendable by the shell. */
export const defaultRegistry: Record<View["type"], ComponentType<BuiltinViewProps>> = {
  list: ListView,
  gallery: GalleryView,
  table: TableView,
  detail: DetailView,
  custom: CustomView,
  calendar: CalendarView,
  map: MapView,
  steps: StepsView,
  checklist: ChecklistView,
  board: BoardView,
  timeline: TimelineView,
  stats: StatsView,
  chart: ChartView,
  aggregate: AggregateView,
};

export function resolveViewComponent(
  type: View["type"],
  registry: Partial<Record<View["type"], ComponentType<BuiltinViewProps>>> = {},
): ComponentType<BuiltinViewProps> {
  return registry[type] ?? defaultRegistry[type];
}
