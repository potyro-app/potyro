// The OpenAI-compatible endpoint's own settings (#121): where it is, its key if it takes one, which
// model, and a button that asks the server before anything is spent on it. The key is held like the
// other engines' keys (engine-store.ts): in this tab only, unless the person asks this device to
// remember the endpoint (remember-key.tsx), when all three go into the device's vault.

import { useId, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { EndpointSetting, EngineConfig } from "./engines.js";
import { checkEndpoint, type EndpointCheck } from "./endpoint-check.js";
import { RememberKey } from "./remember-key.js";

export function EndpointSettings({ config, onChange }: { config: EngineConfig; onChange: (next: EngineConfig) => void }) {
  const { t } = useLingui();
  // Without React's colons: an id is also read as a CSS selector (happy-dom reads `list` that way).
  const listId = `k-endpoint-models-${useId().replace(/:/g, "")}`;
  const [state, setState] = useState<{ kind: "idle" } | { kind: "testing" } | { kind: "done"; result: EndpointCheck }>({ kind: "idle" });
  /**
   * The models the server listed at the last test that reached it. Kept apart from the result, which
   * any edit clears: typing in the model field is when the list is wanted, and the datalist filters
   * itself by what is typed. Only another address or key makes it someone else's list.
   */
  const [models, setModels] = useState<string[]>([]);
  /** Which test is the current one. Every edit moves it on, so a test still running when one is made is ignored. */
  const run = useRef(0);
  const setting = config.endpoint;
  const set = (patch: Partial<EndpointSetting>): void => {
    onChange({ ...config, endpoint: { ...setting, ...patch } });
    // A result is about the settings it was made with; once they change it says nothing true, and a
    // test still running is about the settings before this edit.
    run.current += 1;
    if (state.kind !== "idle") setState({ kind: "idle" });
    if (patch.baseUrl !== undefined || patch.key !== undefined) setModels([]);
  };
  const test = async (): Promise<void> => {
    const id = ++run.current;
    setState({ kind: "testing" });
    const result = await checkEndpoint(setting);
    if (run.current !== id) return;
    setState({ kind: "done", result });
    if (result.ok) setModels(result.models);
  };
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
      <RememberKey kind="endpoint" hasKey={setting.baseUrl.trim().length > 0} />
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
