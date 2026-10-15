// What a plant photo is read into, and how the app turns that into a finding it can stand behind.
//
// The model looks and says what is likely, with how sure it is. The app decides the rest the same
// way every time: a watering interval in range, a health that never forgets a disease, a check-up in
// days that follow the health. It never turns "probably" into "is" — see words.ts for how it speaks.

import type { AiValue } from "potyro";
import { COMPARED, healthOf, isKind, isLight, isSerious, isSure, KINDS, LIGHTS, SURE, waterEvery, type Health, type Kind, type Light, type Sure, type Trend } from "./care.js";

/** Checked by the host before the app sees it: every `oneOf` is one of its options, a missing text `null`. */
export const DIAGNOSIS = {
  isPlant: "boolean",
  clear: "boolean",
  plant: { common: "text?", latin: "text?", sure: { oneOf: SURE } },
  problem: {
    kind: { oneOf: KINDS },
    name: "text?",
    sure: { oneOf: SURE },
    signs: ["text"],
    check: ["text"],
    todo: ["text"],
    serious: "boolean",
  },
  care: { waterEveryDays: "number?", light: { oneOf: LIGHTS, optional: true }, watch: ["text"] },
  trend: { oneOf: COMPARED, optional: true },
  trendNote: "text?",
} as const;

export type DiagnosisAnswer = AiValue<typeof DIAGNOSIS>;

const RULES = [
  "isPlant: false when there is no plant or leaf in the photo. clear: false when it is too blurry, dark or far away to judge.",
  "plant.common: its everyday name. plant.latin: its botanical name. plant.sure: how sure you are which plant it is.",
  "problem.kind: none when it looks healthy; overwatering; underwatering; light (too little or too much); pests; nutrients; disease (fungus, rot, virus); temperature (cold, draughts, heat); unsure when the photo cannot tell.",
  "problem.name: the problem in a few plain words (Too much water, Spider mites); null when there is none. problem.sure: low unless the signs are clear; never high from one sign or a poor photo.",
  "problem.signs: what in the photo points to it, 1 to 3 short points. problem.check: 2 to 4 things the person can look at or feel to be surer (the soil a finger deep, the underside of leaves, the roots, the drainage hole). problem.todo: 2 to 4 simple things to do, gentlest first.",
  "problem.serious: true when the plant could die soon or the problem could spread to other plants.",
  "care.waterEveryDays: how often a plant like this usually needs water indoors, in days. care.light: low, medium, bright (bright but indirect) or sun (direct sun). care.watch: 1 to 3 things to keep an eye on.",
  "Write for someone who is not a gardener. A photo cannot be sure: never say anything is certain. No chemicals beyond mild soapy water for pests.",
];

/** What the model is told for a first look. Model-facing, so English (#297). */
export function firstInstructions(): string {
  return ["A photo of a house or garden plant, or of one of its leaves. Say what plant it most likely is and what, if anything, is wrong with it.", ...RULES, "trend and trendNote: null."].join("\n");
}

/**
 * A check-up: the earlier photo first, today's second, and the one line the app kept about the earlier
 * look — its date and what it seemed to be. That line is the only part of a record that is sent.
 */
export function followUpInstructions(previous: { on: Date; said: string } | null): string {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const earlier = previous
    ? `The first image is the same plant on ${iso(previous.on)}, when it looked like: ${previous.said}. The second image is today's.`
    : "There is no earlier photo of it.";
  return [
    "A check-up photo of a house or garden plant that was looked at before. Say what is wrong with it now, judged from today's photo, and whether it is better or worse.",
    earlier,
    ...RULES,
    "trend: better, same or worse than the earlier photo; unsure when the photos cannot be compared. trendNote: one sentence on what changed.",
  ].join("\n");
}

/** A finding the app keeps: the model's look, normalised, with what the app decides from it. */
export interface Finding {
  plantName: string;
  latin: string;
  plantSure: Sure;
  kind: Kind;
  problem: string;
  sure: Sure;
  signs: string[];
  check: string[];
  todo: string[];
  serious: boolean;
  light: Light | null;
  waterEvery: number | null;
  watch: string[];
  trend: Trend;
  trendNote: string;
  health: Health;
}

const clean = (list: readonly (string | null)[] | null | undefined, max: number): string[] =>
  (list ?? [])
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .slice(0, max);

/** The answer, as a finding — or why there is none: no plant in the photo, or a photo too poor to judge. */
export function toFinding(answer: DiagnosisAnswer, followUp: boolean): Finding | "not a plant" | "unclear" {
  if (!answer.isPlant) return "not a plant";
  if (!answer.clear) return "unclear";
  const p = answer.problem;
  const kind: Kind = isKind(p.kind) ? p.kind : "unsure";
  const sure: Sure = isSure(p.sure) ? p.sure : "low";
  const serious = isSerious(kind, p.serious === true);
  const trend: Trend = followUp ? (answer.trend ?? "unsure") : "first";
  const light = isLight(answer.care.light) ? answer.care.light : null;
  const suggested = answer.care.waterEveryDays;
  return {
    plantName: (answer.plant.common ?? "").trim(),
    latin: (answer.plant.latin ?? "").trim(),
    plantSure: isSure(answer.plant.sure) ? answer.plant.sure : "low",
    kind,
    problem: kind === "none" ? "" : (p.name ?? "").trim(),
    sure,
    signs: clean(p.signs, 3),
    check: clean(p.check, 4),
    todo: clean(p.todo, 4),
    serious,
    light,
    waterEvery: suggested == null ? null : waterEvery(suggested, light ?? "medium"),
    watch: clean(answer.care.watch, 3),
    trend,
    trendNote: followUp ? (answer.trendNote ?? "").trim() : "",
    health: healthOf(kind, sure, serious, trend),
  };
}

/** "• one\n• two" — a list as the record keeps it, one point per line. */
export const bullets = (list: readonly string[]): string => list.map((s) => `• ${s}`).join("\n");
