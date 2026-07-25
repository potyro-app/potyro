// Hybrid routing (KA-07): generate on-device (edge) for the offline, zero-marginal-cost path, and
// escalate to the cloud backend only when the edge repair loop hasn't converged within N attempts.
// Composes two ModelBackends behind the same interface, so the eval harness treats it like any other.

import type { GenPrompt, ModelBackend } from "./backend.js";

export class HybridBackend implements ModelBackend {
  readonly name: string;
  // Per-prompt repair attempt count, so escalation is scoped to a single prompt's loop.
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly edge: ModelBackend,
    private readonly cloud: ModelBackend,
    private readonly escalateAfter = 2,
  ) {
    this.name = `hybrid(${edge.name}->${cloud.name})`;
  }

  async generate(prompt: GenPrompt): Promise<string> {
    this.attempts.set(prompt.id, 0); // fresh loop for this prompt
    return this.edge.generate(prompt);
  }

  async repair(source: string, errors: string[], prompt: GenPrompt): Promise<string> {
    const attempt = (this.attempts.get(prompt.id) ?? 0) + 1;
    this.attempts.set(prompt.id, attempt);

    // First `escalateAfter` repairs stay on-device; beyond that, hand off to the cloud backend.
    const backend = attempt <= this.escalateAfter ? this.edge : this.cloud;
    if (!backend.repair) return source;
    return backend.repair(source, errors, prompt);
  }
}
