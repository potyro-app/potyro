// May this app use AI (docs/23), on this device?
//
// Three answers: "on" (the person allowed it, or it is their own app and has used it), "off" (they
// turned it off in Edit tile) and nothing (never asked). The person's choice, per device, like Ask's
// switch (ask-setting.ts) — localStorage under `potyro:<feature>:<appId>`, never `ctx.storage`, which
// the app itself can write and which syncs across a space.

export type AiStanding = "on" | "off";

const key = (appId: string): string => `potyro:ai:${appId}`;

export function aiStanding(appId: string): AiStanding | undefined {
  try {
    const v = globalThis.localStorage?.getItem(key(appId));
    return v === "on" || v === "off" ? v : undefined;
  } catch {
    return undefined;
  }
}

export function setAiStanding(appId: string, standing: AiStanding | undefined): void {
  try {
    if (standing) globalThis.localStorage?.setItem(key(appId), standing);
    else globalThis.localStorage?.removeItem(key(appId));
  } catch {
    // Storage refused: a sealed app asks again next time, which errs on the person's side.
  }
}
