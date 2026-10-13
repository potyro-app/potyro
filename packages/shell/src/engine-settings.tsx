// The settings modal behind the engine button: pick which model answers, and give it what it needs.
//
// Everything about reaching a model lives here, so the controls column can be one prompt box and one
// button. Each engine's own settings sit under it and only under it — a key field that belongs to a
// provider you are not using is noise you have to read past every time.

import { useEffect, useRef } from "react";
import { OPENROUTER_MODELS, WEBLLM_MODELS } from "@potyro/generator/backends";
import { ENGINES, canInvestigate, engineLabel, type Engine, type EngineConfig } from "./engines.js";
import { canGenerate } from "./generate-client.js";
import { ThinkingSettings } from "./thinking-settings.js";

interface EngineSettingsProps {
  config: EngineConfig;
  onChange: (next: EngineConfig) => void;
  onClose: () => void;
  hasWebGPU: boolean;
  hasBuiltIn: boolean;
}

const GROUPS = ["On this machine", "Cloud"] as const;

export function EngineSettings({ config, onChange, onClose, hasWebGPU, hasBuiltIn }: EngineSettingsProps) {
  const set = (patch: Partial<EngineConfig>): void => onChange({ ...config, ...patch });

  // Choosing an engine reveals ITS settings underneath it, which on a short window opens below the
  // fold — you tick OpenRouter and the key field it just asked you for is off screen.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [config.engine]);

  // An engine the browser cannot run is shown, disabled, with the reason — hiding it makes the
  // Studio look different on different machines with nothing to explain why.
  const unavailable = (id: Engine): string | null => {
    if (id === "cli" && !canGenerate()) return "only while the dev server runs";
    if (id === "edge" && !hasWebGPU) return "needs a WebGPU browser";
    if (id === "builtin" && !hasBuiltIn) return "not available in this browser";
    return null;
  };

  return (
    <div className="k-modal-scrim" onClick={onClose}>
      <div className="k-modal k-engines" role="dialog" aria-label="Model settings" onClick={(e) => e.stopPropagation()}>
        <header className="k-modal-head">
          <div>
            <h2 className="k-modal-title">Model</h2>
            <p className="k-muted">Which model writes and edits your app. Keys stay in this tab and are never saved.</p>
          </div>
          <button type="button" className="k-add" aria-label="Close model settings" onClick={onClose}>
            Done ✕
          </button>
        </header>

        <div className="k-engine-list" role="radiogroup" aria-label="Engine" ref={listRef}>
          {GROUPS.map((group) => (
            <section key={group} className="k-engine-group">
              <h3 className="k-field-label">{group}</h3>
              {ENGINES.filter((e) => e.group === group).map((e) => {
                const why = unavailable(e.id);
                const active = config.engine === e.id;
                return (
                  <div key={e.id} className="k-engine-row" data-active={active}>
                    <label className="k-engine-pick">
                      <input
                        type="radio"
                        name="engine"
                        value={e.id}
                        checked={active}
                        disabled={Boolean(why)}
                        onChange={() => set({ engine: e.id })}
                      />
                      <span className="k-engine-name">{e.label}</span>
                      {why ? <span className="k-muted k-engine-why">{why}</span> : null}
                      <span className="k-muted k-engine-blurb">{e.blurb}</span>
                      {/* Honest about the one thing this engine can't do yet — not alarming, since
                          every engine here still writes and edits apps fine; see engines.ts. */}
                      {canInvestigate(e.id) ? null : (
                        <span className="k-muted k-engine-note">
                          Writes and edits apps; cannot investigate a reported problem step by step.
                        </span>
                      )}
                    </label>

                    {/* Settings belong to their engine, and appear only when it is the one selected. */}
                    {active && e.id === "anthropic" ? (
                      <input
                        className="k-input"
                        aria-label="Anthropic API key"
                        type="password"
                        placeholder="sk-ant-…"
                        value={config.anthropicKey}
                        onChange={(ev) => set({ anthropicKey: ev.target.value })}
                      />
                    ) : null}

                    {active && e.id === "openrouter" ? (
                      <div className="k-engine-fields">
                        <input
                          className="k-input"
                          aria-label="OpenRouter API key"
                          type="password"
                          placeholder="sk-or-…"
                          value={config.openrouterKey}
                          onChange={(ev) => set({ openrouterKey: ev.target.value })}
                        />
                        <select
                          className="k-input"
                          aria-label="OpenRouter model"
                          value={config.openrouterModel}
                          onChange={(ev) => set({ openrouterModel: ev.target.value })}
                        >
                          {OPENROUTER_MODELS.map((m) => (
                            <option key={m.id} value={m.id} title={m.note}>
                              {m.label} · {m.price} /M
                            </option>
                          ))}
                        </select>
                        <p className="k-muted">
                          {OPENROUTER_MODELS.find((m) => m.id === config.openrouterModel)?.note ?? ""}
                        </p>
                      </div>
                    ) : null}

                    {/* How hard it thinks (#280): only where a client sends it. */}
                    {active && e.canThink ? <ThinkingSettings config={config} onChange={onChange} /> : null}

                    {active && e.id === "edge" ? (
                      <select
                        className="k-input"
                        aria-label="On-device model"
                        value={config.edgeModel}
                        onChange={(ev) => set({ edgeModel: ev.target.value })}
                      >
                        {WEBLLM_MODELS.map((m) => (
                          <option key={m.id} value={m.id} title={m.note}>
                            {m.label} · {m.download}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <footer className="k-modal-foot">
          <span className="k-muted">
            Creating and modifying both use <strong>{engineLabel(config)}</strong>.
          </span>
        </footer>
      </div>
    </div>
  );
}
