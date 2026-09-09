// Pluggable model backend for the eval harness. Cloud (Claude, KA-05) and on-device (KA-07)
// backends implement this same interface so they report comparable numbers against one corpus.

export interface GenPrompt {
  id: string;
  /** The natural-language ask the model must turn into a single `.app.ts` source. */
  description: string;
  /** Surface areas this prompt exercises (fields/views/logic), for reporting. */
  tags?: string[];
}

export interface ModelBackend {
  readonly name: string;
  /** Turn a prompt into a single `.app.ts` source string. */
  generate(prompt: GenPrompt): Promise<string>;
  /** Optional structured-repair step: given the failing source + errors, return a fixed source.
   *  Backends without it simply don't get repair attempts (the harness records 0 repairs). */
  repair?(source: string, errors: string[], prompt: GenPrompt): Promise<string>;
  /** Optional edit step: given the current source + a natural-language change, return the model's
   *  REPLY as text — SEARCH/REPLACE edits, a whole file, or a `NOT-IN-APP:` verdict. It is not
   *  source: `guardedModify` (guarded-modify.ts) is what reads it and applies edits to the app. */
  modify?(source: string, instruction: string, prompt: GenPrompt): Promise<string>;
}

/**
 * A deterministic backend that returns canned sources by prompt id, so the harness runs and is
 * tested fully offline (no API key). Unknown ids yield a trivially-invalid source. An optional
 * `repairs` map lets tests exercise the repair loop.
 */
export class FixtureBackend implements ModelBackend {
  readonly name: string;
  constructor(
    private readonly sources: Record<string, string>,
    private readonly repairs?: Record<string, string>,
    name = "fixture",
  ) {
    this.name = name;
  }

  async generate(prompt: GenPrompt): Promise<string> {
    return this.sources[prompt.id] ?? "// no fixture for this prompt\nexport default {};\n";
  }

  async repair(_source: string, _errors: string[], prompt: GenPrompt): Promise<string> {
    return this.repairs?.[prompt.id] ?? _source;
  }
}
