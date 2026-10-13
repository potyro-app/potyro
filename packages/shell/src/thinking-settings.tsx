// How hard the model thinks (#280), under the engine it belongs to in Model settings.
//
// Four levels in the person's words, each with what it costs — thinking is paid for like the answer,
// so "more" is never free — and, apart from them, the loop's own escalation: think hard for the one
// try after a change kept being turned back (docs/19 F6). The two are separate switches so each can
// be measured on its own; the level defaults to off and the escalation to on.

import type { ReasoningLevel } from "@potyro/generator/backends";
import { thinkingFor, withThinking, type EngineConfig } from "./engines.js";

const LEVELS: ReadonlyArray<{ id: ReasoningLevel; label: string; hint: string }> = [
  { id: "off", label: "Off", hint: "Fastest and cheapest. Enough for most changes." },
  { id: "low", label: "Low", hint: "Thinks a little first. A bit slower; costs a little more." },
  { id: "medium", label: "Medium", hint: "Thinks it through. Slower; a change can cost a few times more." },
  { id: "high", label: "High", hint: "Thinks hard. Slowest and costs the most, but may get hard changes right." },
];

export function ThinkingSettings({ config, onChange }: { config: EngineConfig; onChange: (next: EngineConfig) => void }) {
  const t = thinkingFor(config);
  return (
    <div className="k-thinking">
      <div className="k-thinking-levels" role="radiogroup" aria-label="How hard it thinks">
        <span className="k-field-label k-thinking-title">How hard it thinks</span>
        {LEVELS.map((l) => (
          <label key={l.id} className="k-thinking-level" data-active={t.level === l.id}>
            <input
              type="radio"
              name="thinking-level"
              value={l.id}
              checked={t.level === l.id}
              onChange={() => onChange(withThinking(config, { level: l.id }))}
            />
            <span className="k-thinking-name">{l.label}</span>
            <span className="k-muted k-thinking-hint">{l.hint}</span>
          </label>
        ))}
        <p className="k-muted k-thinking-cost">
          Thinking is paid for like the answer, at the output price shown above, so each level costs more per change than the one before it.
        </p>
      </div>
      <label className="k-thinking-stuck">
        <input type="checkbox" checked={t.escalate} onChange={(e) => onChange(withThinking(config, { escalate: e.target.checked }))} />
        <span>
          <span className="k-thinking-name">Think hard when stuck</span>
          <span className="k-muted k-thinking-hint">
            When a change keeps being turned back, the next try thinks hard. It costs more only on changes that were going badly.
          </span>
        </span>
      </label>
    </div>
  );
}
