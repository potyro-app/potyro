// The settings modal behind the engine button: pick which model answers, and give it what it needs.
//
// Everything about reaching a model lives here, so the controls column can be one prompt box and one
// button. Each engine's own settings sit under it and only under it — a key field that belongs to a
// provider you are not using is noise you have to read past every time.

import { useEffect, useRef, useState } from "react";
import type { SpeechWhere } from "@potyro/capabilities";
import { speechWhereWords } from "./app-speech.js";
import { studioVoiceWhere } from "./studio-voice.js";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";
import { OPENROUTER_MODELS, WEBLLM_MODELS } from "@potyro/generator/backends";
import { ENGINES, ENGINE_GROUPS, canInvestigate, engineLabel, type Engine, type EngineConfig } from "./engines.js";
import { canGenerate } from "./generate-client.js";
import { ThinkingSettings } from "./thinking-settings.js";
import { EndpointSettings } from "./endpoint-settings.js";
import { RememberKey } from "./remember-key.js";
import { freeOffered, leftWords, refusalText, stoppedNow, useFreeAi } from "./free-ai.js";
import { checkFreeEngine } from "./engine-store.js";
import { LegalLink } from "./legal-links.js";

/**
 * Where the microphone's words are made on this device (docs/29): voice uses none of the engines
 * above, and where it leaves the device it says so here as well as in its question.
 */
function VoiceNote() {
  const [where, setWhere] = useState<SpeechWhere | null>(null);
  useEffect(() => {
    let live = true;
    void studioVoiceWhere().then((w) => live && setWhere(w));
    return () => {
      live = false;
    };
  }, []);
  if (!where) return null;
  const words = speechWhereWords(where);
  return (
    <p className="k-muted k-voice-note" data-engine={where.engine}>
      {where.engine === "device" ? (
        <Trans comment="Model settings: where the microphone's words are made; {words} = 'On this device'">Voice: {words}. Nothing you say leaves it.</Trans>
      ) : (
        <Trans comment="Model settings: where the microphone's words are made; {words} names the service">Voice: {words}. What you say leaves your device.</Trans>
      )}
    </p>
  );
}

/**
 * The shortlists' notes, in the person's language. The lists live in the generator, which has no
 * catalog; a model added there without a note here shows the generator's English note.
 */
const MODEL_NOTES: Record<string, MessageDescriptor> = {
  "deepseek/deepseek-v4-flash-0731": msg`Cheap, fast, 1M context — start here`,
  "deepseek/deepseek-v4-pro-0813": msg`Stronger sibling, still ~50× cheaper than a frontier model`,
  "deepseek/deepseek-v3.2": msg`Previous generation, for a regression check`,
  "qwen/qwen3-coder": msg`Coder-tuned — the output is a structured .app.ts`,
  "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC": msg`Fastest, weakest — for low-end devices`,
  "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC": msg`Recommended balance`,
  "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC": msg`Best quality; larger download · non-commercial license`,
};

const usd = (n: string): string => fmt.number(Number(n), { style: "currency", currency: "USD", maximumFractionDigits: 2 });

interface EngineSettingsProps {
  config: EngineConfig;
  onChange: (next: EngineConfig) => void;
  onClose: () => void;
  hasWebGPU: boolean;
  hasBuiltIn: boolean;
}

export function EngineSettings({ config, onChange, onClose, hasWebGPU, hasBuiltIn }: EngineSettingsProps) {
  const { t } = useLingui();
  const set = (patch: Partial<EngineConfig>): void => onChange({ ...config, ...patch });
  const free = useFreeAi();
  const freeStop = stoppedNow(free);
  // Opening Model settings asks the free route again where it gave no answer, so Potyro is listed
  // once it can be reached.
  useEffect(() => {
    void checkFreeEngine({ again: true }).catch(() => {});
  }, []);

  // Choosing an engine reveals ITS settings underneath it, which on a short window opens below the
  // fold — you tick OpenRouter and the key field it just asked you for is off screen.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [config.engine]);

  // An engine the browser cannot run is shown, disabled, with the reason — hiding it makes the
  // Studio look different on different machines with nothing to explain why. `claude -p` is the one
  // exception: it is the dev server's route, a developer's tool, so a deployed site or a native build
  // never lists it at all (owner, 2026-10-30) — shown() below.
  const unavailable = (id: Engine): string | null => {
    if (id === "edge" && !hasWebGPU) return t`needs a WebGPU browser`;
    if (id === "builtin" && !hasBuiltIn) return t`not available in this browser`;
    return null;
  };
  /** Every engine but the dev server's own route, which exists only while `pnpm dev` runs. */
  // Potyro's free engine only while the relay's chat route serves (or while it is the one chosen).
  const shown = (id: Engine): boolean => (id === "cli" ? canGenerate() : id === "potyro" ? freeOffered(free) || config.engine === "potyro" : true);

  const label = engineLabel(config);
  const noteOf = (m: { id: string; note?: string }): string => {
    const d = MODEL_NOTES[m.id];
    return d ? t(d) : (m.note ?? "");
  };
  /** "$0.14/$0.28" (in/out per million tokens) in the active language's number format. */
  const priceOf = (price: string): string => {
    const both = /^\$([\d.]+)\/\$([\d.]+)$/.exec(price);
    if (both) {
      const input = usd(both[1]!);
      const output = usd(both[2]!);
      return t({ message: `${input}/${output} /M`, comment: "Model price: dollars in / dollars out, per million tokens (/M)" });
    }
    return price === "varies" ? t({ message: "varies", comment: "Model price: it depends on the provider" }) : price;
  };
  /** "~1 GB" in the active language's number format. */
  const sizeOf = (download: string): string => {
    const gb = /^~([\d.]+) GB$/.exec(download);
    return gb ? `~${fmt.number(Number(gb[1]), { style: "unit", unit: "gigabyte" })}` : download;
  };
  return (
    <div className="k-modal-scrim" onClick={onClose}>
      <div className="k-modal k-engines" role="dialog" aria-label={t`Model settings`} onClick={(e) => e.stopPropagation()}>
        <header className="k-modal-head">
          <div>
            <h2 className="k-modal-title">
              <Trans comment="Model settings title: which AI model is used">Model</Trans>
            </h2>
            <p className="k-muted">
              <Trans>Which model writes and edits your app. Keys stay in this tab unless you ask this device to remember one.</Trans>
            </p>
          </div>
          <button type="button" className="k-add" aria-label={t`Close model settings`} onClick={onClose}>
            <Trans comment="Closes the model settings">Done</Trans> ✕
          </button>
        </header>

        <div className="k-engine-list" role="radiogroup" aria-label={t({ message: "Engine", comment: "The list of model engines to choose from" })} ref={listRef}>
          {ENGINE_GROUPS.map((group) => (
            <section key={group.id} className="k-engine-group">
              <h3 className="k-field-label">{t(group.label)}</h3>
              {ENGINES.filter((e) => e.group === group.id && shown(e.id)).map((e) => {
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
                      <span className="k-engine-name">{t(e.label)}</span>
                      {why ? <span className="k-muted k-engine-why">{why}</span> : null}
                      <span className="k-muted k-engine-blurb">{t(e.blurb)}</span>
                      {/* Honest about the one thing this engine can't do yet — not alarming, since
                          every engine here still writes and edits apps fine; see engines.ts. */}
                      {canInvestigate(e.id) ? null : (
                        <span className="k-muted k-engine-note">
                          <Trans>Writes and edits apps; cannot investigate a reported problem step by step.</Trans>
                        </span>
                      )}
                    </label>

                    {/* Settings belong to their engine, and appear only when it is the one selected. */}
                    {active && e.id === "potyro" ? (
                      <p className="k-muted k-free-left" role="status">
                        {freeStop ? refusalText(freeStop.code) : free.left ? leftWords(free.left) : null}
                      </p>
                    ) : null}

                    {active && e.id === "anthropic" ? (
                      <div className="k-engine-fields">
                        <input
                          className="k-input"
                          aria-label={t`Anthropic API key`}
                          type="password"
                          // i18n-ignore — the shape of an Anthropic key, not words
                          placeholder="sk-ant-…"
                          value={config.anthropicKey}
                          onChange={(ev) => set({ anthropicKey: ev.target.value })}
                        />
                        <RememberKey kind="anthropic" hasKey={config.anthropicKey.trim().length > 0} />
                      </div>
                    ) : null}

                    {active && e.id === "openrouter" ? (
                      <div className="k-engine-fields">
                        <input
                          className="k-input"
                          aria-label={t`OpenRouter API key`}
                          type="password"
                          // i18n-ignore — the shape of an OpenRouter key, not words
                          placeholder="sk-or-…"
                          value={config.openrouterKey}
                          onChange={(ev) => set({ openrouterKey: ev.target.value })}
                        />
                        <RememberKey kind="openrouter" hasKey={config.openrouterKey.trim().length > 0} />
                        <select
                          className="k-input"
                          aria-label={t`OpenRouter model`}
                          value={config.openrouterModel}
                          onChange={(ev) => set({ openrouterModel: ev.target.value })}
                        >
                          {OPENROUTER_MODELS.map((m) => (
                            <option key={m.id} value={m.id} title={noteOf(m)}>
                              {m.label} · {priceOf(m.price)}
                            </option>
                          ))}
                        </select>
                        <p className="k-muted">
                          {(() => {
                            const chosen = OPENROUTER_MODELS.find((m) => m.id === config.openrouterModel);
                            return chosen ? noteOf(chosen) : "";
                          })()}
                        </p>
                      </div>
                    ) : null}

                    {active && e.id === "endpoint" ? <EndpointSettings config={config} onChange={onChange} /> : null}

                    {/* How hard it thinks (#280): only where a client sends it. */}
                    {active && e.canThink ? <ThinkingSettings config={config} onChange={onChange} /> : null}

                    {active && e.id === "edge" ? (
                      <select
                        className="k-input"
                        aria-label={t`On-device model`}
                        value={config.edgeModel}
                        onChange={(ev) => set({ edgeModel: ev.target.value })}
                      >
                        {WEBLLM_MODELS.map((m) => (
                          <option key={m.id} value={m.id} title={noteOf(m)}>
                            {m.label} · {sizeOf(m.download)}
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

        <VoiceNote />
        {/* What each choice sends, and to whom (#117): the privacy page's Studio section. */}
        <LegalLink section="studio" block>
          <Trans comment="Model settings: link to the privacy page's section on the Studio's models">What leaves your device with each choice</Trans>
        </LegalLink>

        <footer className="k-modal-foot">
          <span className="k-muted">
            <Trans>
              Creating and modifying both use <strong>{label}</strong>.
            </Trans>
          </span>
        </footer>
      </div>
    </div>
  );
}
