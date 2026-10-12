// The release's corpus, loaded when a tool first needs it (#262). A dynamic import, so the bundler
// gives it a chunk of its own: served from the app's own origin and cached like every other chunk,
// never on the first screen's critical path, and no network beyond the app itself.

import type { Corpus } from "./corpus.js";

let pending: Promise<Corpus> | undefined;

export function loadCorpus(): Promise<Corpus> {
  pending ??= import("./corpus.generated.js").then(
    (m) => m.CORPUS,
    (e: unknown) => {
      pending = undefined; // a failed chunk load is retried next time, not remembered
      throw e;
    },
  );
  return pending;
}
