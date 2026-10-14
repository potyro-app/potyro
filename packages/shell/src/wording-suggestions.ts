// "Something reads wrong? Suggest a better wording" (#300) — what is sent, and how the screen is read.
//
// Five of Potyro's six languages are model drafts (#297). The person reading one knows best where it
// reads wrong, so You → Language lets them pick the words — among the ones on the screen behind the
// panel, or by searching — write theirs, and send it. It goes the way a platform request goes
// (#263, platform-requests.ts): the relay files it as a GitHub issue, labelled `translation`, and
// until the relay is deployed it waits on this device and is sent later.
//
// What travels: the wording, the words it would replace, their English, the message's id and the
// language. No app, no records, nothing about the person.

import { REQUEST_FORMAT, LIMITS, type PlatformRequestPayload } from "@potyro/platform-requests";
import type { CatalogMessage } from "@potyro/i18n";
import { deviceId, newRequestId, sendPlatformRequest, type SendResult } from "./platform-requests.js";

/** Longest suggestion a person may write: a label or a sentence, never an essay. */
export const WORDING_MAX = 500;

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The suggestion exactly as it will be sent. The title and body are for the team, in English. */
export function wordingRequest(message: CatalogMessage, wording: string, language: string): PlatformRequestPayload {
  const head = `Wording (${language}): “`; // i18n-ignore — the team's issue title, not shown in the app
  const room = LIMITS.title - head.length - 1;
  return {
    format: REQUEST_FORMAT,
    kind: "translation",
    id: newRequestId(),
    device: deviceId(),
    title: `${head}${clip(oneLine(message.seen ?? message.text), room)}”`,
    body: [
      `Suggested: ${clip(oneLine(wording), WORDING_MAX)}`,
      `Now: ${clip(oneLine(message.seen ?? message.text), 600)}`,
      `English: ${clip(oneLine(message.english), 600)}`,
      `Message: ${message.id}`,
    ].join("\n"),
    structure: "",
    language,
  };
}

/** Send it, or keep it on this device to send later — the platform requests' outbox, with no conversation. */
export function sendWording(payload: PlatformRequestPayload, opts: { fetch?: typeof fetch } = {}): Promise<SendResult> {
  return sendPlatformRequest(payload, "", opts);
}

/** Words in an attribute: a box's placeholder is seen; a label, a tooltip or an alt text is heard or hovered. */
const SEEN_ATTRIBUTES = ["placeholder"] as const;
const HEARD_ATTRIBUTES = ["aria-label", "title", "alt"] as const;

/**
 * The text on screen, as the catalog matcher reads it. The screen behind `panel` (the panel the
 * form sits in) comes first, then the panel's own: what the person came to correct is usually
 * behind it. In each, what is seen comes first, in the screen's order — each element that holds
 * words of its own, as its whole text (a message with bold inside is still one text), and a box's
 * placeholder — then what is only heard or hovered: accessible names, tooltips, alt texts. Nothing
 * inside `skip`, the suggestion form itself.
 */
export function screenTexts(root: Element, skip?: Element | null, panel?: Element | null): string[] {
  const behind = { seen: new Set<string>(), heard: new Set<string>() };
  const within = { seen: new Set<string>(), heard: new Set<string>() };
  const add = (to: Set<string>, v: string | null): void => {
    const text = v ? oneLine(v) : "";
    if (text && text.length <= 600) to.add(text);
  };
  const visit = (el: Element, inPanel: boolean): void => {
    if (skip && (el === skip || skip.contains(el))) return;
    const here = inPanel || el === panel;
    const to = here ? within : behind;
    for (const a of SEEN_ATTRIBUTES) add(to.seen, el.getAttribute(a));
    for (const a of HEARD_ATTRIBUTES) add(to.heard, el.getAttribute(a));
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) add(to.seen, el.textContent);
    for (const child of el.children) visit(child, here);
  };
  visit(root, false);
  return [...new Set([...behind.seen, ...within.seen, ...behind.heard, ...within.heard])];
}
