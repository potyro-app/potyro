import { expect, type Page, type Route } from "@playwright/test";

// Voice input's engines, mocked (docs/29 §7). No real recognizer and no real model is used:
//
//   - `fakeRecognizer` puts a SpeechRecognition the test speaks through into the page, before it
//     loads: `say(page, text, final)` is the person speaking, `endSpeech(page)` the engine deciding
//     they are done. `local: true` makes `SpeechRecognition.available()` answer "available", as
//     Chrome does where it has an on-device model; otherwise the words go "to Google" (Chrome's UA).
//   - `mockRelay` answers the free AI relay's /ai/health and /ai/complete, as the cloud engine's
//     transcription (Firefox, which has no SpeechRecognition), and keeps every request it got.

export async function fakeRecognizer(page: Page, o: { local?: boolean } = {}): Promise<void> {
  await page.addInitScript(
    ([local]) => {
      type Result = { isFinal: boolean; t: string };
      class FakeRecognition {
        lang = "";
        continuous = false;
        interimResults = false;
        maxAlternatives = 1;
        processLocally = false;
        onstart: (() => void) | null = null;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        results: Result[] = [];
        static available?: (o: unknown) => Promise<string>;
        start() {
          (window as unknown as { __rec: FakeRecognition }).__rec = this;
          setTimeout(() => this.onstart?.(), 30);
        }
        stop() {
          setTimeout(() => this.onend?.(), 30);
        }
        abort() {
          setTimeout(() => this.onend?.(), 0);
        }
        hear(t: string, isFinal: boolean) {
          const last = this.results[this.results.length - 1];
          if (last && !last.isFinal) this.results[this.results.length - 1] = { isFinal, t };
          else this.results.push({ isFinal, t });
          const results = this.results.map((r) => Object.assign([{ transcript: r.t }], { isFinal: r.isFinal }));
          this.onresult?.({ results });
        }
      }
      if (local) FakeRecognition.available = async () => "available";
      const w = window as unknown as Record<string, unknown>;
      w.SpeechRecognition = FakeRecognition;
      w.webkitSpeechRecognition = FakeRecognition;
    },
    [o.local === true] as const,
  );
}

/** The person says this: everything so far, or the newest piece of it. */
export async function say(page: Page, text: string, final = true): Promise<void> {
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __rec?: unknown }).__rec))).toBe(true);
  await page.evaluate(([t, f]) => (window as unknown as { __rec: { hear(t: string, f: boolean): void } }).__rec.hear(t, f), [text, final] as const);
}

/** The engine ends the listening by itself (a pause). */
export async function endSpeech(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __rec: { stop(): void } }).__rec.stop());
}

export interface RelayRequest {
  path: string;
  body: { system?: string; parts?: Array<{ type: string; text?: string; data?: string }> } | null;
}

/** The free AI relay, answering each /ai/complete with `text`. */
export async function mockRelay(page: Page, text: string): Promise<RelayRequest[]> {
  const got: RelayRequest[] = [];
  await page.route("**/ai/health", (route: Route) => {
    got.push({ path: "/ai/health", body: null });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/ai/complete", (route: Route) => {
    got.push({ path: "/ai/complete", body: route.request().postDataJSON() as RelayRequest["body"] });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, text, model: "mock", left: 99 }) });
  });
  return got;
}
