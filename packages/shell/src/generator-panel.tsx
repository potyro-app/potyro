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
import { createClaudeBackend } from "@karta/generator/backends";
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

  // Generate the source with Claude. The API key is the user's own, kept only in-memory for this
  // local tool (dangerouslyAllowBrowser). Without a key + description the button stays disabled.
  const generate = async (): Promise<void> => {
    setGenBusy(true);
    setError(null);
    try {
      const backend = await createClaudeBackend({ apiKey, dangerouslyAllowBrowser: true });
      setSource(await backend.generate({ id: "panel", description }));
      setPreview(null);
    } catch (e) {
      setError(`Generate failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenBusy(false);
    }
  };

  // Ask the model to fix the current source given the last error (browser-native repair loop).
  const fixWithAI = async (): Promise<void> => {
    if (!error) return;
    setGenBusy(true);
    try {
      const backend = await createClaudeBackend({ apiKey, dangerouslyAllowBrowser: true });
      setSource(await backend.repair(source, [error], { id: "panel", description }));
    } catch (e) {
      setError(`Fix failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenBusy(false);
    }
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
          Describe an app (Claude fills the source), or paste/edit a Karta <code>.app.ts</code>, then preview it —
          it runs untrusted in the QuickJS isolate.
        </p>

        <div className="k-gen-generate">
          <input
            className="k-input"
            aria-label="Describe the app"
            placeholder="Describe an app… e.g. a reading tracker with progress"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <input
            className="k-input k-gen-key"
            aria-label="Anthropic API key"
            type="password"
            placeholder="sk-ant-… (your key, kept in memory)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            className="k-add k-primary-action"
            disabled={genBusy || !apiKey || description.trim().length === 0}
            onClick={() => void generate()}
          >
            {genBusy ? "Generating…" : "Generate"}
          </button>
        </div>

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
