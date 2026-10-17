// Firefox's prefs for what Chromium is granted by name (e2e/engines.ts says why). Its own file
// because playwright.config.ts reads it, and the config must not load the test fixtures.

/**
 * `dom.events.testing.asyncClipboard` is Firefox's own switch for tests:
 * `navigator.clipboard.readText()` answers without the paste menu a person would be shown. The media
 * pair is Firefox's fake camera and microphone, handed over without the permission doorhanger.
 */
export const FIREFOX_PREFS: Record<string, boolean> = {
  "dom.events.asyncClipboard.readText": true,
  "dom.events.testing.asyncClipboard": true,
  "media.navigator.streams.fake": true,
  "media.navigator.permission.disabled": true,
};
