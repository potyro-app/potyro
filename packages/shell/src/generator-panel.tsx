// "Create an app" panel: paste or edit a Karta `.app.ts`, then preview it live. The source is
// bundled on demand (app-bundler) and run UNTRUSTED in the QuickJS-WASM isolate — the same safe path
// a shared or AI-generated app takes. This is the visible capstone of the runtime-execution work:
// arbitrary app logic runs in the browser without any trust in the source.
//
// In-panel AI generation (cloud/edge → fills the source) is a follow-up: it needs a browser-safe
// generator entrypoint (the eval harness's scorer is Node-only). The bundle → isolate → render
// pipeline below is the shared foundation both that and shared-app import build on.

import { useState } from "react";
import { MemoryStore } from "@karta/store";
import { createWebCapabilities } from "@karta/capabilities";
import {
  createClaudeBackend,
  createWebLLMBackend,
  createGeminiNanoBackend,
  hasBuiltInAI,
  WEBLLM_MODELS,
  SYSTEM_PROMPT,
  buildUserMessage,
  buildRepairMessage,
  extractSource,
} from "@karta/generator/backends";
import { createAppBundler } from "./app-bundler.js";
import { createSandboxLoader } from "./isolate-bridge.js";
import { compose, type Composed } from "./compose.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { App } from "./App.js";
import { Toaster } from "./toaster.js";

const STARTER = `import { defineApp } from "karta";

export default defineApp({
  id: "my-app",
  name: "My App",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        done: { type: "boolean", default: false },
      },
    },
  },
  pages: [
    { id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } },
  ],
});
`;

interface Preview {
  composed: Composed;
  toaster: Toaster;
}

export function GeneratorPanel({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState(STARTER);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [model, setModel] = useState("Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC");

  const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
  const hasBuiltIn = hasBuiltInAI();
  const canDescribe = description.trim().length > 0 && !genBusy;

  const withGen = async (label: string, run: () => Promise<string>): Promise<void> => {
    setGenBusy(true);
    setError(null);
    try {
      setSource(await run());
      setPreview(null);
    } catch (e) {
      setError(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenBusy(false);
      setProgress(null);
    }
  };

  // 1) Local `claude -p` via the dev server — no API key, uses your existing Claude Code auth.
  // The prompt (the generator's contract + few-shot) is built here; the dev endpoint just shells out.
  const runCli = async (prompt: string): Promise<string> => {
    const res = await fetch("/__generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    return extractSource((await res.json()).text as string);
  };

  const generateCli = (): Promise<void> =>
    withGen("claude -p", () => runCli(`${SYSTEM_PROMPT}\n\n${buildUserMessage({ id: "panel", description })}`));

  // 2) On-device via WebLLM (WebGPU) — fully offline once the model is cached.
  const generateEdge = (): Promise<void> =>
    withGen("On-device", async () => {
      const backend = await createWebLLMBackend({
        model,
        initProgressCallback: (p) => setProgress((p as { text?: string })?.text ?? "Loading model…"),
      });
      return backend.generate({ id: "panel", description });
    });

  // 2b) Chrome built-in AI (Gemini Nano) — on-device with no weight download (ships in the browser).
  const generateBuiltIn = (): Promise<void> =>
    withGen("Built-in", async () => {
      setProgress("Preparing Chrome built-in model…");
      const backend = await createGeminiNanoBackend();
      return backend.generate({ id: "panel", description });
    });

  // 3) Cloud with the user's own API key (in-memory only, this local tool).
  const generateCloud = (): Promise<void> =>
    withGen("Cloud", async () => {
      const backend = await createClaudeBackend({ apiKey, dangerouslyAllowBrowser: true });
      return backend.generate({ id: "panel", description });
    });

  // Feed the last error back to fix the source. Uses cloud when a key is set, else `claude -p`.
  const fixWithAI = (): Promise<void> => {
    const lastError = error;
    if (!lastError) return Promise.resolve();
    return withGen("Fix", async () => {
      if (apiKey) {
        const backend = await createClaudeBackend({ apiKey, dangerouslyAllowBrowser: true });
        return backend.repair(source, [lastError], { id: "panel", description });
      }
      const prompt = [
        SYSTEM_PROMPT,
        "",
        buildUserMessage({ id: "panel", description }),
        "",
        "The previous attempt:",
        "```ts",
        source,
        "```",
        "",
        buildRepairMessage([lastError]),
      ].join("\n");
      return runCli(prompt);
    });
  };

  const runPreview = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const bundle = await createAppBundler();
      const bundleCode = await bundle(source);
      const store = new MemoryStore();
      await store.open("preview");
      const toaster = new Toaster();
      const ui = createUiBridge(toaster.push);
      const nav = createNavBridge(() => {});
      const loadIsolated = await createSandboxLoader(store);
      const composed = await compose({
        provenance: "untrusted",
        bundleCode,
        store,
        caps: createWebCapabilities(),
        ui,
        nav,
        loadIsolated,
      });
      setPreview({ composed, toaster });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k-modal-scrim" onClick={onClose}>
      <div className="k-modal k-gen-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Create an app</h3>
        <p className="k-muted">
          Describe an app (the model fills the source), or paste/edit a Karta <code>.app.ts</code>, then preview it —
          it runs untrusted in the QuickJS isolate.
        </p>

        <input
          className="k-input"
          aria-label="Describe the app"
          placeholder="Describe an app… e.g. a reading tracker with progress"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="k-gen-sources">
          <button type="button" className="k-add k-primary-action" disabled={!canDescribe} onClick={() => void generateCli()}>
            {genBusy ? "Generating…" : "Generate (claude -p)"}
          </button>
          <span className="k-gen-edge">
            <button
              type="button"
              className="k-add"
              disabled={!canDescribe || !hasWebGPU}
              title={hasWebGPU ? "Runs a small model on-device (WebGPU)" : "Needs a WebGPU browser"}
              onClick={() => void generateEdge()}
            >
              On-device
            </button>
            <select
              className="k-input k-gen-model"
              aria-label="On-device model"
              value={model}
              disabled={!hasWebGPU || genBusy}
              title={WEBLLM_MODELS.find((m) => m.id === model)?.note}
              onChange={(e) => setModel(e.target.value)}
            >
              {WEBLLM_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {m.download}
                </option>
              ))}
            </select>
          </span>
          {hasBuiltIn ? (
            <button
              type="button"
              className="k-add"
              disabled={!canDescribe}
              title="Chrome's built-in Gemini Nano — on-device, no download"
              onClick={() => void generateBuiltIn()}
            >
              Built-in (Chrome)
            </button>
          ) : null}
          <input
            className="k-input k-gen-key"
            aria-label="Anthropic API key"
            type="password"
            placeholder="or paste sk-ant-… for cloud"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button type="button" className="k-add" disabled={!canDescribe || !apiKey} onClick={() => void generateCloud()}>
            Cloud
          </button>
        </div>
        {progress ? <p className="k-muted">{progress}</p> : null}

        <textarea
          className="k-input k-gen-source"
          aria-label="App source"
          value={source}
          spellCheck={false}
          rows={14}
          onChange={(e) => setSource(e.target.value)}
        />
        {error ? <p className="k-form-error">{error}</p> : null}
        <div className="k-form-actions">
          <button type="button" className="k-add" onClick={onClose}>
            Close
          </button>
          {error && apiKey ? (
            <button type="button" className="k-add" disabled={genBusy} onClick={() => void fixWithAI()}>
              {genBusy ? "Fixing…" : "Fix with AI"}
            </button>
          ) : null}
          <button type="button" className="k-add k-primary-action" disabled={busy} onClick={() => void runPreview()}>
            {busy ? "Building…" : "Preview"}
          </button>
        </div>
        {preview ? (
          <div className="k-gen-preview" aria-label="Preview">
            <App runtime={preview.composed.runtime} provenance="untrusted" toaster={preview.toaster} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
