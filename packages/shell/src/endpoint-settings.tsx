// The OpenAI-compatible endpoint's own settings (#121): where it is, its key if it takes one, which
// model, and a button that asks the server before anything is spent on it. The key is held like the
// other engines' keys (engine-store.ts): in this tab only, never saved.

import { useId, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { EndpointSetting, EngineConfig } from "./engines.js";
import { checkEndpoint, type EndpointCheck } from "./endpoint-check.js";

export function EndpointSettings({ config, onChange }: { config: EngineConfig; onChange: (next: EngineConfig) => void }) {
  const { t } = useLingui();
  const listId = useId();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "testing" } | { kind: "done"; result: EndpointCheck }>({ kind: "idle" });
  const setting = config.endpoint;
  const set = (patch: Partial<EndpointSetting>): void => {
    onChange({ ...config, endpoint: { ...setting, ...patch } });
    // A result is about the settings it was made with; once they change it says nothing true.
    if (state.kind === "done") setState({ kind: "idle" });
  };
  const test = async (): Promise<void> => {
    setState({ kind: "testing" });
    setState({ kind: "done", result: await checkEndpoint(setting) });
  };
  const models = state.kind === "done" && state.result.ok ? state.result.models : [];
  return (
    <div className="k-engine-fields k-endpoint">
      <input
        className="k-input"
        aria-label={t`Endpoint address`}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        // i18n-ignore — an example address, not words
        placeholder="http://localhost:11434/v1"
        value={setting.baseUrl}
        onChange={(ev) => set({ baseUrl: ev.target.value })}
      />
      <input
        className="k-input"
        aria-label={t`Endpoint API key`}
        type="password"
        autoComplete="off"
        placeholder={t`Key, if the server needs one`}
        value={setting.key}
        onChange={(ev) => set({ key: ev.target.value })}
      />
      <input
        className="k-input"
        aria-label={t`Endpoint model`}
        autoComplete="off"
        spellCheck={false}
        // i18n-ignore — an example model name, not words
        placeholder="qwen3-coder"
        list={models.length ? listId : undefined}
        value={setting.model}
        onChange={(ev) => set({ model: ev.target.value })}
      />
      {models.length ? (
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      ) : null}
      <div className="k-endpoint-test">
        <button type="button" className="k-add" disabled={state.kind === "testing" || !setting.baseUrl.trim()} onClick={() => void test()}>
          {state.kind === "testing" ? <Trans comment="Button while it asks the server">Testing…</Trans> : <Trans>Test connection</Trans>}
        </button>
        {state.kind === "done" ? (
          <p className="k-endpoint-result" role="status" data-ok={state.result.ok}>
            {state.result.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
