import type { MessageDescriptor } from "@lingui/core";
import { fmt, i18n } from "@potyro/i18n";
import { msg, plural } from "@lingui/core/macro";
import { sandboxRunner, type SandboxRunner } from "./sandbox-runner.js";
// What a shared app reached for that the sealed box does not have, in words a person can read (#271).
//
// Which names those are depends on the box (sandbox-runner.ts). The browser realm (#272) is a Worker
// with the browser's own built-ins — `Intl`, `URL`, `TextEncoder`, timers, `crypto` — and no page: an
// app or a library that touches `window` or `document` while it loads still fails there, and custom
// views of shared apps stay off. QuickJS, the fallback, is not a browser at all: no `Intl`, no
// `window`, no `TextEncoder`, no timers. Either way an app that touches what is missing fails with
// "'Intl' is not defined", or, reached through `globalThis`, "cannot read property 'DateTimeFormat' of
// undefined". Neither says anything to someone who just wants to add an app a friend sent them. This
// turns those into the feature's name in plain words, so the card can say "uses a feature shared apps
// don't have yet: a full web page (document)" and offer to run it as theirs instead.
//
// Only names the box really lacks are recognised. An unknown name that is "not defined" is far more
// often the app's own mistake, which running it as yours would not fix — that is not this.

/** What it is called in code → what it is for, in plain words (descriptors: said in the language of the moment it is shown). */
const FEATURES: ReadonlyArray<readonly [names: readonly string[], words: MessageDescriptor]> = [
  [["Intl"], msg`date and number formatting`],
  [
    [
      "window", "document", "self", "navigator", "location", "localStorage", "sessionStorage", "indexedDB", "HTMLElement", "Element",
      "Node", "getComputedStyle", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame", "Image", "HTMLCanvasElement",
      "OffscreenCanvas", "ResizeObserver", "MutationObserver", "IntersectionObserver", "customElements", "devicePixelRatio",
    ],
    msg`a full web page`,
  ],
  [["TextEncoder", "TextDecoder"], msg`turning text into bytes`],
  [["URL", "URLSearchParams"], msg`reading web addresses`],
  [["crypto"], msg`secure random numbers`],
  [["setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask", "setImmediate"], msg`timers`],
  [["fetch", "XMLHttpRequest", "WebSocket", "EventSource"], msg`going online on its own`],
  [["structuredClone"], msg`copying data`],
  [["atob", "btoa"], msg`base64 text`],
  [["performance"], msg`precise timing`],
  [["Blob", "File", "FileReader"], msg`files in memory`],
  [["WebAssembly"], msg`compiled code (WebAssembly)`],
  [["Worker", "SharedWorker"], msg`background work`],
  [["AbortController", "AbortSignal"], msg`cancelling work`],
  [["WeakRef", "FinalizationRegistry"], msg`weak references`],
  [["Event", "EventTarget", "CustomEvent"], msg`events`],
];

/** Members whose owner is the missing global, as they show up in "cannot read property 'X' of undefined". */
const MEMBERS_OF: Record<string, string> = Object.fromEntries(
  ["DateTimeFormat", "NumberFormat", "Collator", "PluralRules", "RelativeTimeFormat", "ListFormat", "Segmenter", "DisplayNames", "Locale", "supportedValuesOf"].map((m) => [m, "Intl"]),
);

const WORDS = new Map<string, MessageDescriptor>(FEATURES.flatMap(([names, words]) => names.map((n) => [n, words] as const)));

/**
 * What a Worker in the realm does not have: the page. `self`, `navigator`, `location`, `indexedDB` and
 * `OffscreenCanvas` are a Worker's own, and everything else in FEATURES is a built-in it shares with
 * the browser — so only these can be "not defined" there for want of a feature.
 */
const REALM_LACKS = new Set([
  "window", "document", "localStorage", "sessionStorage", "HTMLElement", "Element", "Node", "getComputedStyle", "matchMedia",
  "requestAnimationFrame", "cancelAnimationFrame", "Image", "HTMLCanvasElement", "ResizeObserver", "MutationObserver",
  "IntersectionObserver", "customElements", "devicePixelRatio",
]);

export interface MissingFeature {
  /** The name in code: `Intl`. */
  name: string;
  /** What it is for, with the name: "date and number formatting (Intl)". */
  words: string;
}

const feature = (name: string, runner: SandboxRunner): MissingFeature | undefined => {
  if (runner === "realm" && !REALM_LACKS.has(name)) return undefined;
  const descriptor = WORDS.get(name);
  if (!descriptor) return undefined;
  const words = i18n._(descriptor);
  return { name, words: words.includes(`(${name})`) ? words : `${words} (${name})` };
};

const messageOf = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/**
 * The feature an error says is missing, if it is one the sealed box lacks. Reads a ReferenceError
 * ("'Intl' is not defined", "Intl is not defined"), a TypeError on a member of a missing global
 * ("cannot read property 'DateTimeFormat' of undefined", "Cannot read properties of undefined
 * (reading 'DateTimeFormat')") and a call of one ("Intl.DateTimeFormat is not a constructor").
 */
export function missingFeature(error: unknown, runner: SandboxRunner = sandboxRunner()): MissingFeature | undefined {
  const text = messageOf(error);
  const notDefined = /'?([A-Za-z_$][\w$]*)'? is not defined/.exec(text);
  if (notDefined) {
    const found = feature(notDefined[1]!, runner);
    if (found) return found;
  }
  const member = /cannot read propert(?:y|ies) '?([\w$]+)'? of (?:undefined|null)/i.exec(text) ?? /of (?:undefined|null) \(reading '([\w$]+)'\)/i.exec(text);
  if (member) {
    const owner = MEMBERS_OF[member[1]!];
    if (owner) return feature(owner, runner);
  }
  const called = /([\w$.]+) is not a (?:function|constructor)/.exec(text);
  if (called) {
    for (const part of called[1]!.split(".")) {
      const found = feature(part === "globalThis" ? "" : part, runner) ?? (MEMBERS_OF[part] ? feature(MEMBERS_OF[part]!, runner) : undefined);
      if (found) return found;
    }
  }
  return undefined;
}

/** Every missing feature among these errors, each once, in the order they first appear. */
export function missingFeatures(errors: readonly unknown[], runner: SandboxRunner = sandboxRunner()): MissingFeature[] {
  const seen = new Map<string, MissingFeature>();
  for (const e of errors) {
    const found = missingFeature(e, runner);
    if (found && !seen.has(found.words)) seen.set(found.words, found);
  }
  return [...seen.values()];
}

/** The sentence for the card: "It uses a feature shared apps don't have yet: date and number formatting (Intl)." */
export function describeMissing(features: readonly (MissingFeature | string)[]): string {
  if (!features.length) return "";
  const words = fmt.list(features.map((f) => (typeof f === "string" ? f : f.words)));
  return plural(features.length, {
    one: `It uses a feature shared apps don’t have yet: ${words}.`,
    other: `It uses features shared apps don’t have yet: ${words}.`,
  });
}
