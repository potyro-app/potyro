// Studio — the full-screen surface for creating, previewing, saving, and re-opening apps. Replaces
// the cramped modal (user feedback): the live app is the default, large, interactive stage; the
// source hides behind a toggle; generated apps SAVE to a local "My Apps" library and re-open with a
// durable per-app store, so they're actually usable — not preview-only. Everything an app does here
// runs UNTRUSTED in the QuickJS isolate, the same safe path a shared app takes.

import { useEffect, useRef, useState } from "react";
import { MemoryStore, type Store } from "@karta/store";
import { createWebCapabilities } from "@karta/capabilities";
import { validateDefinition } from "./validate-app.js";
import {
  createClaudeBackend,
  createWebLLMBackend,
  createGeminiNanoBackend,
  hasBuiltInAI,
  WEBLLM_MODELS,
  SYSTEM_PROMPT,
  buildUserMessage,
  buildRepairMessage,
  buildModifyMessage,
  extractSource,
} from "@karta/generator/backends";
import { createAppBundler } from "./app-bundler.js";
import { createSandboxLoader } from "./isolate-bridge.js";
import { compose, type Composed } from "./compose.js";
import { loadTrustedModule } from "./trusted-loader.js";
import type { Provenance } from "@karta/host";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { PickerHost } from "./picker.js";
import { openStore } from "./open-store.js";
import { listUserApps, saveUserApp, removeUserApp, type UserApp } from "./user-apps.js";
import { App } from "./App.js";
import { Toaster } from "./toaster.js";

const CLI_TIMEOUT_MS = 300_000; // matches the dev endpoint's own cap

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
  build: number;
  picker: PickerHost;
  /** Which path actually ran — the isolate fallback is only taken if the trusted load throws. */
  provenance: Provenance;
}

export function Studio({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState(STARTER);
  const [tab, setTab] = useState<"preview" | "source">("preview");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [model, setModel] = useState("Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC");
  const [savedApps, setSavedApps] = useState<UserApp[]>(() => listUserApps());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [engine, setEngine] = useState<"cli" | "edge" | "builtin" | "cloud">("cli");
  const buildRef = useRef(0);

  const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
  const hasBuiltIn = hasBuiltInAI();
  const canDescribe = description.trim().length > 0 && !genBusy;
  const appName = preview?.composed.runtime.definition.name;

  // Build (or rebuild) the live app from `source` and VALIDATE its structure. Returns the validation
  // issues (empty = valid). Drafts use an ephemeral MemoryStore; a saved app (storeNamespace) uses its
  // durable store so its data persists across opens. Runs untrusted in the isolate.
  const buildPreview = async (src: string, storeNamespace: string | null): Promise<string[]> => {
    setBusy(true);
    setError(null);
    try {
      const store: Store = storeNamespace ? await openStore(`user:${storeNamespace}`) : await newMemoryStore();
      const toaster = new Toaster();
      const picker = new PickerHost();
      const base = {
        store,
        caps: createWebCapabilities(),
        ui: createUiBridge(toaster.push, picker),
        nav: createNavBridge(() => {}),
      };

      // TRUSTED by default: this is the user's own app (CLAUDE.md rule 3 — provenance decides
      // execution, and "trusted = user's own"). It also has to be direct for the preview to be
      // truthful: custom views never run untrusted (React is stubbed inside the isolate), so an
      // isolate preview silently renders every custom view as a blank panel.
      let composed: Composed;
      let provenance: Provenance = "trusted";
      try {
        composed = await compose({ provenance: "trusted", app: await loadTrustedModule(src), ...base });
      } catch {
        // A malformed app can't produce a KartaApp — fall back to the isolate so the user still
        // gets a preview plus the validation issues, rather than a hard failure.
        provenance = "untrusted";
        const bundle = await createAppBundler();
        composed = await compose({
          provenance: "untrusted",
          bundleCode: await bundle(src),
          ...base,
          loadIsolated: await createSandboxLoader(store),
        });
      }
      buildRef.current += 1;
      setPreview({ composed, toaster, build: buildRef.current, provenance, picker });
      setTab("preview");
      const issues = validateDefinition(composed.runtime.definition);
      if (issues.length) setError(`Invalid app structure:\n- ${issues.join("\n- ")}`);
      return issues;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTab("source");
      return [e instanceof Error ? e.message : String(e)];
    } finally {
      setBusy(false);
    }
  };

  // Show the starter app immediately on open — preview-first, nothing to click.
  useEffect(() => {
    void buildPreview(STARTER, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withGen = async (label: string, run: () => Promise<string>, autoRepair = true): Promise<void> => {
    setGenBusy(true);
    setError(null);
    try {
      const next = await run();
      setSource(next);
      let issues = await buildPreview(next, currentId);
      // The model sometimes emits a structurally-invalid app (e.g. a wrong list shape). Feed the
      // validator's errors back once and rebuild — so you get a working app, not broken UI.
      if (autoRepair && issues.length) {
        setProgress("Fixing structure…");
        const fixed = await repairSource(next, issues);
        setSource(fixed);
        issues = await buildPreview(fixed, currentId);
      }
    } catch (e) {
      setError(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
      setTab("source");
    } finally {
      setGenBusy(false);
      setProgress(null);
    }
  };

  // 1) Local `claude -p` via the dev server — no API key (reuses your Claude Code auth).
  // `system` is sent SEPARATELY so the dev endpoint passes it via --system-prompt-file, replacing
  // Claude Code's own agent prompt. Folding the contract into the user text left that prompt (and
  // its tools) active — a different setup from the one the eval harness measures.
  const runCli = async (prompt: string): Promise<string> => {
    const abort = new AbortController();
    // Without this a stalled generation surfaces as a bare "NetworkError" with nothing actionable.
    const timer = setTimeout(() => abort.abort(), CLI_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch("/__generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ system: SYSTEM_PROMPT, prompt }),
        signal: abort.signal,
      });
    } catch (e) {
      if (abort.signal.aborted) throw new Error(`timed out after ${CLI_TIMEOUT_MS / 1000}s — try a shorter description`);
      throw new Error(
        `couldn't reach the dev server's generator. Is \`pnpm dev\` still running? (${e instanceof Error ? e.message : String(e)})`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
    return extractSource(((await res.json()) as { text: string }).text);
  };
  const generateCli = (): Promise<void> => {
    setEngine("cli");
    return withGen("claude -p", () => runCli(buildUserMessage({ id: "studio", description })));
  };

  // 2) On-device via WebLLM (WebGPU) — offline once the model is cached.
  const edgeBackend = () =>
    createWebLLMBackend({ model, initProgressCallback: (p) => setProgress((p as { text?: string })?.text ?? "Loading model…") });
  const generateEdge = (): Promise<void> => {
    setEngine("edge");
    return withGen("On-device", async () => (await edgeBackend()).generate({ id: "studio", description }));
  };

  // 2b) Chrome built-in AI (Gemini Nano) — on-device, no download.
  const generateBuiltIn = (): Promise<void> => {
    setEngine("builtin");
    return withGen("Built-in", async () => {
      setProgress("Preparing Chrome built-in model…");
      return (await createGeminiNanoBackend()).generate({ id: "studio", description });
    });
  };

  // 3) Cloud with the user's own API key (in-memory only).
  const generateCloud = (): Promise<void> => {
    setEngine("cloud");
    return withGen("Cloud", async () => (await createClaudeBackend({ apiKey, dangerouslyAllowBrowser: true })).generate({ id: "studio", description }));
  };

  // Repair a source given a list of problems (validator issues or an error), via the current engine.
  const repairSource = async (src: string, issues: string[]): Promise<string> => {
    const p = { id: "studio", description };
    if (engine === "cloud") return (await createClaudeBackend({ apiKey, dangerouslyAllowBrowser: true })).repair(src, issues, p);
    if (engine === "edge") return (await edgeBackend()).repair(src, issues, p);
    if (engine === "builtin") return (await createGeminiNanoBackend()).repair(src, issues, p);
    const prompt = [SYSTEM_PROMPT, "", buildUserMessage(p), "", "The previous attempt:", "```ts", src, "```", "", buildRepairMessage(issues)].join("\n");
    return runCli(prompt);
  };

  // Adapt the CURRENT app with the agent (KA-07 "modify"): the description is read as a change to
  // apply, and the model returns the whole updated file — keeping the rest intact. Uses the same
  // engine you last generated with (defaults to claude -p).
  const modify = (): Promise<void> => {
    const instruction = description.trim();
    if (!instruction || !preview) return Promise.resolve();
    const p = { id: "studio", description: instruction };
    return withGen("Modify", async () => {
      if (engine === "cloud") return (await createClaudeBackend({ apiKey, dangerouslyAllowBrowser: true })).modify(source, instruction, p);
      if (engine === "edge") return (await edgeBackend()).modify(source, instruction, p);
      if (engine === "builtin") return (await createGeminiNanoBackend()).modify(source, instruction, p);
      const prompt = [SYSTEM_PROMPT, "", "The current app:", "```ts", source, "```", "", buildModifyMessage(instruction)].join("\n");
      return runCli(prompt);
    });
  };

  const fixWithAI = (): Promise<void> => {
    const lastError = error;
    if (!lastError) return Promise.resolve();
    // Split a multi-issue validation message back into individual problems for the repair prompt.
    const issues = lastError.replace(/^Invalid app structure:\n?/, "").split("\n- ").map((s) => s.replace(/^- /, "").trim()).filter(Boolean);
    return withGen("Fix", () => repairSource(source, issues.length ? issues : [lastError]));
  };

  // --- My Apps ----------------------------------------------------------------------------------

  const save = (): void => {
    // Saving an app the preview already flagged is how invalid apps reached My Apps and only
    // surfaced much later, once validation existed. Confirm rather than block: an author may still
    // want to park work in progress.
    if (error && !globalThis.confirm(`This app has structure problems:\n\n${error}\n\nSave anyway?`)) return;
    const record = saveUserApp({ id: currentId ?? undefined, name: appName ?? description, source }, new Date().toISOString());
    setCurrentId(record.id);
    setSavedApps(listUserApps());
    preview?.toaster.push(`Saved "${record.name}" to My Apps`);
    // Re-open on the durable store so edits made from here persist.
    void buildPreview(source, record.id);
  };

  const openSaved = (app: UserApp): void => {
    setSource(app.source);
    setDescription("");
    setCurrentId(app.id);
    void buildPreview(app.source, app.id);
  };

  const deleteSaved = (app: UserApp): void => {
    removeUserApp(app.id);
    setSavedApps(listUserApps());
    if (currentId === app.id) setCurrentId(null);
  };

  const newDraft = (): void => {
    setCurrentId(null);
    setDescription("");
    setSource(STARTER);
    void buildPreview(STARTER, null);
  };

  return (
    <div className="k-studio" role="dialog" aria-label="App studio">
      <header className="k-studio-bar">
        <div className="k-brand">
          <span className="k-logo" aria-hidden>◆</span>
          <strong>Studio</strong>
          {currentId ? <span className="k-muted">· {appName}</span> : <span className="k-muted">· new app</span>}
        </div>
        <button type="button" className="k-add" aria-label="Close studio" onClick={onClose}>
          Close ✕
        </button>
      </header>

      <div className="k-studio-body">
        <aside className="k-studio-controls">
          <label className="k-field-label" htmlFor="k-studio-desc">Describe an app — or a change to make</label>
          <textarea
            id="k-studio-desc"
            className="k-input k-studio-desc"
            aria-label="Describe the app"
            placeholder="Create: “a reading tracker with a rating”  ·  Modify: “add a 5-star rating field”"
            rows={4}
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
                onChange={(e) => setModel(e.target.value)}
              >
                {WEBLLM_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label} · {m.download}</option>
                ))}
              </select>
            </span>
            {hasBuiltIn ? (
              <button type="button" className="k-add" disabled={!canDescribe} title="Chrome's built-in Gemini Nano — on-device, no download" onClick={() => void generateBuiltIn()}>
                Built-in (Chrome)
              </button>
            ) : null}
          </div>
          <div className="k-gen-cloud">
            <input
              className="k-input"
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
          {preview ? (
            <div className="k-gen-modify">
              <button
                type="button"
                className="k-add k-primary-action"
                disabled={!canDescribe}
                title="Adapt the current app with the agent (keeps the rest; uses the engine you last generated with)"
                onClick={() => void modify()}
              >
                {genBusy ? "Working…" : "✎ Modify this app"}
              </button>
              <span className="k-muted">edits the running app</span>
            </div>
          ) : null}
          {progress ? <p className="k-muted k-studio-progress">{progress}</p> : null}

          <div className="k-studio-savebar">
            <button type="button" className="k-add k-primary-action" disabled={busy} onClick={save}>
              {currentId ? "Save changes" : "Save to My Apps"}
            </button>
            <button type="button" className="k-add" onClick={newDraft}>New draft</button>
          </div>

          <h4 className="k-myapps-title">My Apps</h4>
          {savedApps.length === 0 ? (
            <p className="k-muted">Nothing saved yet. Generate or edit an app, then <em>Save</em>.</p>
          ) : (
            <ul className="k-myapps">
              {savedApps.map((a) => (
                <li key={a.id} className="k-myapp-row" data-active={a.id === currentId}>
                  <button type="button" className="k-myapp-open" onClick={() => openSaved(a)}>
                    {a.name}
                  </button>
                  <button type="button" className="k-myapp-del" aria-label={`Delete ${a.name}`} onClick={() => deleteSaved(a)}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="k-studio-stage">
          <div className="k-studio-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "preview"} className="k-tab" data-active={tab === "preview"} onClick={() => setTab("preview")}>
              Preview
            </button>
            <button type="button" role="tab" aria-selected={tab === "source"} className="k-tab" data-active={tab === "source"} onClick={() => setTab("source")}>
              Source
            </button>
            <span className="k-studio-tabs-spacer" />
            {tab === "source" ? (
              <button type="button" className="k-add k-primary-action" disabled={busy} onClick={() => void buildPreview(source, currentId)}>
                {busy ? "Building…" : "Run ▶"}
              </button>
            ) : null}
            {error && (apiKey || true) ? (
              <button type="button" className="k-add" disabled={genBusy} onClick={() => void fixWithAI()}>
                {genBusy ? "Fixing…" : "Fix with AI"}
              </button>
            ) : null}
          </div>

          {error ? <p className="k-form-error k-studio-error">{error}</p> : null}

          {tab === "preview" ? (
            <div className="k-studio-preview" aria-label="App preview">
              {busy && !preview ? (
                <p className="k-muted k-studio-building">Building…</p>
              ) : preview ? (
                <App key={preview.build} runtime={preview.composed.runtime} provenance={preview.provenance} toaster={preview.toaster} picker={preview.picker} />
              ) : null}
            </div>
          ) : (
            <textarea
              className="k-input k-studio-source"
              aria-label="App source"
              value={source}
              spellCheck={false}
              onChange={(e) => setSource(e.target.value)}
            />
          )}
        </section>
      </div>
    </div>
  );
}

async function newMemoryStore(): Promise<Store> {
  const store = new MemoryStore();
  await store.open("studio-draft");
  return store;
}
