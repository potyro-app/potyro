// Studio — the full-screen surface for creating, previewing, saving, and re-opening apps. Replaces
// the cramped modal (user feedback): the live app is the default, large, interactive stage; the
// source hides behind a toggle; generated apps SAVE to a local "My Apps" library and re-open with a
// durable per-app store, so they're actually usable — not preview-only. Everything an app does here
// runs UNTRUSTED in the QuickJS isolate, the same safe path a shared app takes.

import { useEffect, useRef, useState } from "react";
import { MemoryStore, type Store } from "@karta/store";
import { createWebCapabilities } from "@karta/capabilities";
import { replayCase, type Case, type ReplayReport, type ReplayTarget, type AppShape } from "@karta/runtime";
import { caseLabel, listCases } from "./app-cases.js";
import { recordDiagnosis } from "./app-diagnoses.js";
import { modifyLoopRefusal, startModify } from "./start-modify.js";
import { CaseReport } from "./case-report.js";
import { validateDefinition } from "./validate-app.js";
import {
  createClaudeBackend,
  createOpenRouterBackend,
  createWebLLMBackend,
  createGeminiNanoBackend,
  hasBuiltInAI,
  SYSTEM_PROMPT,
  buildUserMessage,
  buildRepairInstruction,
  buildModifyMessage,
  extractSource,
  looksLikeApp,
} from "@karta/generator/backends";
import { createAppBundler } from "./app-bundler.js";
import { createSandboxLoader } from "./isolate-bridge.js";
import { compose, type Composed } from "./compose.js";
import { loadTrustedModule } from "./trusted-loader.js";
import type { Provenance } from "@karta/host";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { PickerHost } from "./picker.js";
import { generateViaCli } from "./generate-client.js";
import { openStore } from "./open-store.js";
import { listUserApps, saveUserApp, removeUserApp, type UserApp } from "./user-apps.js";
import { History } from "./history.js";
import { EngineSettings } from "./engine-settings.js";
import { engineLabel, engineReady } from "./engines.js";
import { useEngineConfig } from "./engine-store.js";
import { CodeEditor } from "./code-editor.js";
import { shellDialogs } from "./dialog.js";
import { App } from "./App.js";
import { guardedModify } from "@karta/generator/backends";
import { Toaster } from "./toaster.js";

const CLI_TIMEOUT_MS = 300_000; // matches the dev endpoint's own cap
const POLL_MS = 1_500;

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
  // Every generate/modify in the Studio is a real step in how the app came to be, but until Save
  // there is no app id to hang history on — so the steps were simply dropped and only the final
  // source survived. They accumulate here and are flushed into the app's history on save, in order.
  const [drafts, setDrafts] = useState<Array<{ source: string; note?: string }>>([]);
  const [tab, setTab] = useState<"preview" | "source" | "history">("preview");
  /**
   * How many times a PERSON has picked a tab.
   *
   * A build ends by showing the preview, which is right when the build is why you are here and
   * wrong the moment you went to read the code while it ran — `openSaved` fires `buildPreview`
   * with `void`, so opening an app and immediately clicking Source put you back on Preview a
   * second later, with nothing to explain it. Comparing this count across the await tells the two
   * apart: nobody chose, so choose for them; somebody chose, so leave it alone.
   *
   * A ref, not state: it must be readable at the far side of an await without re-rendering, and
   * nothing renders from it.
   */
  const tabPicks = useRef(0);
  const pickTab = (next: "preview" | "source" | "history"): void => {
    tabPicks.current += 1;
    setTab(next);
  };
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  // Which model answers, and everything it needs, as ONE value (engines.ts) — held in the module-
  // level store (engine-store.ts), not local state, so App.tsx can read the same choice to gate
  // "Fix this". Keys live in memory for the tab's lifetime and are never persisted — they are the
  // user's own.
  const [engineCfg, setEngineCfg] = useEngineConfig();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [savedApps, setSavedApps] = useState<UserApp[]>(() => listUserApps());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const buildRef = useRef(0);

  // Cases reported against the currently open saved app — reloaded whenever it changes, since the
  // whole point is to see what someone reported without leaving the Studio to go look for it.
  const [cases, setCases] = useState<Case[]>([]);
  const [caseReport, setCaseReport] = useState<ReplayReport | null>(null);
  useEffect(() => {
    if (!currentId) {
      setCases([]);
      return;
    }
    let alive = true;
    void listCases(currentId).then((c) => {
      if (alive) setCases(c);
    });
    return () => {
      alive = false;
    };
  }, [currentId]);

  const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
  const hasBuiltIn = hasBuiltInAI();
  const engine = engineCfg.engine;
  /** Named in the UI and in every progress line, so a request is never anonymous. */
  const label = engineLabel(engineCfg);
  const ready = engineReady(engineCfg);
  /**
   * Is there an app to modify, as opposed to an empty page to fill?
   *
   * Derived, not tracked: `currentId` means one was opened from My Apps, and a source that has moved
   * off STARTER means one was generated or hand-written. New draft restores both, so the single
   * action goes back to "Create" exactly when the page is genuinely empty again.
   */
  const hasApp = currentId !== null || source !== STARTER;
  const canDescribe = description.trim().length > 0 && !genBusy;
  const appName = preview?.composed.runtime.definition.name;

  // Build (or rebuild) the live app from `source` and VALIDATE its structure. Returns the validation
  // issues (empty = valid). Drafts use an ephemeral MemoryStore; a saved app (storeNamespace) uses its
  // durable store so its data persists across opens. Runs untrusted in the isolate.
  /**
   * The app's shape as it stood when a MODIFY was requested, and what that modify destroyed.
   *
   * "Fix this" has a verification gate; "Modify the app" had none — and the same failure landed
   * here on the first real use: a change request ("when the map is open and I tap New Place, let me
   * pick a point") came back as a brand new app with the person's entities and pages gone. The
   * prompt already says "edit this source, do not replace it with a different app"; a fast model
   * ignored it, and nothing checked. Instructions are not a gate.
   *
   * This does not block — the result still lands in the editor where it can be inspected, and
   * nothing is saved until the person presses Save. It makes the loss VISIBLE, which is what was
   * missing: a rewritten app looks fine in a preview until you notice half your app is gone.
   */
  const [modifyLoss, setModifyLoss] = useState<string | null>(null);
  /** How the last change arrived — "Applied 3 edits", or that the model sent the whole file. */
  const [modifyNote, setModifyNote] = useState<string | null>(null);

  const buildPreview = async (src: string, storeNamespace: string | null): Promise<string[]> => {
    setBusy(true);
    setError(null);
    // Read BEFORE the first await — see `tabPicks`. Anything after this point is a race with the
    // person using the app.
    const picksBefore = tabPicks.current;
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
      if (tabPicks.current === picksBefore) setTab("preview");
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

  // `run` returns the next source, or null when it already reported its outcome (a NOT-IN-APP
  // verdict is not a failure to generate; it is an answer, shown as one).
  const withGen = async (label: string, run: () => Promise<string | null>, autoRepair = true, note?: string): Promise<void> => {
    setGenBusy(true);
    setError(null);
    // Every generating path funnels through here, so this is the one place that can guarantee the
    // modify notes describe THIS generation. They used to survive a create and a New draft, so a
    // "Applied 3 edits" — or worse, a loss warning about an app that is no longer on screen — stayed
    // pinned under a freshly generated app it had nothing to do with. Cleared before `run`, so
    // anything the run itself reports (below, and in `repairSource`) still stands.
    setModifyLoss(null);
    setModifyNote(null);
    try {
      const next = await run();
      if (next === null) return;
      setSource(next);
      let issues = await buildPreview(next, currentId);
      // The model sometimes emits a structurally-invalid app (e.g. a wrong list shape). Feed the
      // validator's errors back once and rebuild — so you get a working app, not broken UI.
      if (autoRepair && issues.length) {
        setProgress("Fixing structure… (the model gets one more round, up to three calls)");
        const fixed = await repairSource(next, issues);
        setSource(fixed);
        issues = await buildPreview(fixed, currentId);
        setDrafts((d) => [...d, { source: fixed, note: note ?? label }]);
      } else {
        setDrafts((d) => [...d, { source: next, note: note ?? label }]);
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
  const runCli = async (prompt: string, verb = "Generating"): Promise<string> => {
    const source = extractSource(
      await generateViaCli({ system: SYSTEM_PROMPT, prompt, onProgress: (secs) => setProgress(`${verb} via ${label}… ${secs}s`) }),
    );
    // A reply that is not an app must say so here. Passing prose to the bundler reports a syntax
    // error in the middle of an English sentence, which reads as a broken tool rather than a model
    // that answered in the wrong shape.
    if (!looksLikeApp(source)) {
      throw new Error("the model replied with an explanation instead of an app. Try again, or rephrase.");
    }
    return source;
  };

  // 2) On-device via WebLLM (WebGPU) — offline once the model is cached.
  const edgeBackend = () =>
    createWebLLMBackend({
      model: engineCfg.edgeModel,
      initProgressCallback: (p) => setProgress((p as { text?: string })?.text ?? "Loading model…"),
    });

  // 3) Cloud with the user's own API key (in memory only): Anthropic direct, or any model OpenRouter
  // serves. Both speak the same ModelBackend contract and get the same generator prompt, so changing
  // engine changes the model and nothing else.
  const cloudBackend = () =>
    engineCfg.engine === "openrouter"
      ? createOpenRouterBackend({ apiKey: engineCfg.openrouterKey, model: engineCfg.openrouterModel })
      : createClaudeBackend({ apiKey: engineCfg.anthropicKey, dangerouslyAllowBrowser: true });

  /**
   * A cloud generation is one long POST that produces nothing until it is done — and OpenRouter
   * holds the connection open meanwhile, padding it with whitespace. With no visible clock that is
   * indistinguishable from a hang, which is exactly how the first OpenRouter runs read: a request
   * receiving "endless empty data" for a minute. The `claude -p` path already ticks; this gives the
   * cloud path the same heartbeat.
   */
  const ticking = async <T,>(text: string, work: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    setProgress(`${text}… 0s`);
    const timer = setInterval(() => setProgress(`${text}… ${Math.round((Date.now() - started) / 1000)}s`), 1000);
    try {
      return await work();
    } finally {
      clearInterval(timer);
    }
  };

  /** Tick the clock ourselves — unless the engine already reports its own elapsed time (claude -p). */
  const withTick = <T,>(verb: string, work: () => Promise<T>): Promise<T> =>
    engine === "cli" ? work() : ticking(`${verb} via ${label}`, work);

  // One raw model turn for the current engine, for a modify OR a repair (a repair is a modify whose
  // instruction is the validator's own words). Returns the model's REPLY: `guardedModify` reads it.
  const modifyAttempt = async (src: string, instr: string): Promise<string> => {
    const p = { id: "studio", description: instr };
    if (engine === "edge") return (await edgeBackend()).modify(src, instr, p);
    if (engine === "builtin") return (await createGeminiNanoBackend()).modify(src, instr, p);
    if (engine === "cli") {
      const prompt = ["The current app:", "```ts", src, "```", "", buildModifyMessage(instr)].join("\n");
      return generateViaCli({ system: SYSTEM_PROMPT, prompt, onProgress: (secs) => setProgress(`Modifying via ${label}… ${secs}s`) });
    }
    return (await cloudBackend()).modify(src, instr, p);
  };

  /** The shape a repair is judged against. A source that does not load has no shape to lose. */
  const shapeOrEmpty = async (src: string): Promise<AppShape> => {
    try {
      const app = await loadTrustedModule(src);
      return { pages: app.pages, entities: app.entities };
    } catch {
      return { pages: [], entities: {} };
    }
  };

  /**
   * ONE create path. Which model answers is `engineCfg`, chosen in the settings modal — it is no
   * longer implied by which of four buttons you pressed, which is what made an edit reach a
   * different engine than the one on screen.
   */
  const create = (): Promise<void> =>
    withGen(
      label,
      () =>
        withTick("Generating", async () => {
          if (engine === "cli") return runCli(buildUserMessage({ id: "studio", description }));
          if (engine === "edge") return (await edgeBackend()).generate({ id: "studio", description });
          if (engine === "builtin") return (await createGeminiNanoBackend()).generate({ id: "studio", description });
          return (await cloudBackend()).generate({ id: "studio", description });
        }),
      true,
      description.trim() || undefined,
    );

  // Repair a source given the validator's issues — through the SAME gate as a modify. Before this,
  // a repair asked for the whole file again, so a good edit followed by one validation slip
  // reintroduced the retyping the edit format exists to prevent.
  const repairSource = (src: string, issues: string[]): Promise<string> =>
    withTick("Fixing", async () => {
      const result = await guardedModify({
        attempt: (instr) => modifyAttempt(src, instr),
        shapeOf: shapeOrEmpty,
        before: await shapeOrEmpty(src),
        instruction: buildRepairInstruction(issues),
        source: src,
      });
      if (result.kind === "diagnosis") throw new Error(`the repair was declined: ${result.text}`);
      if (result.kind === "failed") throw new Error(`the repair could not be applied: ${result.reason}`);
      if (result.loss !== null) setModifyLoss(result.loss);
      setModifyNote((prev) => `${prev ? `${prev} ` : ""}Repaired with ${result.via === "edits" ? `${result.applied} edit${result.applied === 1 ? "" : "s"}` : "the whole file"}.`);
      return result.source;
    });

  // Adapt the CURRENT app with the agent (KA-07 "modify"): the description is read as a change to
  // apply, and the model sends SEARCH/REPLACE edits which `guardedModify` applies — so the lines it
  // does not mention cannot be damaged. Same engine as create, because there is now only one.
  const modify = (): Promise<void> => {
    const instruction = description.trim();
    if (!instruction || !preview) return Promise.resolve();
    // One model turn, returning the model's REPLY (not source): `guardedModify` reads it, and may
    // call this up to three times (a no-match retry, then a loss retry).
    const attempt = (instr: string): Promise<string> => modifyAttempt(source, instr);
    const def = preview.composed.runtime.definition;
    // No clearing here: `withGen` clears both before it calls `run`, and this modify's own note is
    // set inside that run.
    // A chat engine drives the modify LOOP (#131): the model can look declarations up and check a
    // candidate before sending it, every candidate must compile, validate and keep the app's shape,
    // and a refusal is only accepted after it has looked. Other engines keep the one-turn guard.
    if (!modifyLoopRefusal(engineCfg)) {
      return withGen(
        label,
        async () => {
          const result = await startModify({
            source,
            instruction,
            before: { pages: def.pages, entities: def.entities },
            engine: engineCfg,
            onStep: (step) => {
              if (step.kind === "thinking") setProgress(`Thinking via ${label}…`);
              else if (step.kind === "tool") setProgress(`${step.name}: ${step.detail.split("\n")[0]!.slice(0, 80)}`);
              else if (step.kind === "candidate") setProgress(step.passed ? "Candidate passed the check." : `Candidate rejected: ${step.detail.split("\n")[0]!.slice(0, 80)}`);
              else setProgress(`Asked to try again: ${step.detail.split("\n")[0]!.slice(0, 80)}`);
            },
          });
          if (result.kind === "diagnosis") {
            setModifyNote(`Not changed — the model says this is not the app's to change: ${result.text}`);
            return null;
          }
          if (result.kind === "question") {
            setModifyNote(`The model needs to know: ${result.text}`);
            return null;
          }
          if (result.kind === "failed" || result.kind === "stopped") {
            setError(`Not changed — ${result.kind === "failed" ? result.reason : "stopped"}`);
            return null;
          }
          const applied = result.via === "edits" ? `Applied ${result.applied} edit${result.applied === 1 ? "" : "s"}.` : "The model sent the whole file back instead of edits.";
          if (result.notDone?.length) {
            setModifyNote(`${applied} Not done yet: ${result.notDone.join("; ")}`);
            if (currentId) {
              const now = new Date().toISOString();
              for (const part of result.notDone) void recordDiagnosis(currentId, { complaint: instruction, text: part }, now);
            }
          } else {
            setModifyNote(applied);
          }
          return result.source;
        },
        true,
        instruction,
      );
    }
    return withGen(
      label,
      () =>
        withTick("Modifying", async () => {
          // THE GATE. Edits that do not match go back once with the failure named; a result that
          // dropped entities or pages goes back once with the loss named. Only if a retry ALSO fails
          // is it shown — and then `modifyLoss` says so loudly (below), never silently.
          const result = await guardedModify({
            attempt,
            shapeOf: async (src) => {
              const app = await loadTrustedModule(src);
              return { pages: app.pages, entities: app.entities };
            },
            before: { pages: def.pages, entities: def.entities },
            instruction,
            source,
          });
          if (result.kind === "diagnosis") {
            // An answer, not a failure. Edit mode renders one in neutral style for the same reason:
            // red reads as "retry me", which is how the same wrong edit gets asked for five times.
            setModifyNote(`Not changed — the model says this is not the app's to change: ${result.text}`);
            return null;
          }
          if (result.kind === "failed") {
            setError(`Not changed — ${result.reason}`);
            return null;
          }
          setModifyLoss(result.loss);
          const applied =
            result.via === "edits"
              ? `Applied ${result.applied} edit${result.applied === 1 ? "" : "s"}.`
              : "The model sent the whole file back instead of edits. Check that nothing else changed.";
          // The ladder's third rung (#132): the parts that could be done were, and the parts that
          // could not are said in full — each one is a host gap, so it is filed with the app's
          // diagnoses too, where Edit mode reads them back as "already reported as host-side".
          if (result.notDone?.length) {
            setModifyNote(`${applied} Not done yet: ${result.notDone.join("; ")}`);
            if (currentId) {
              const now = new Date().toISOString();
              for (const part of result.notDone) void recordDiagnosis(currentId, { complaint: instruction, text: part }, now);
            }
          } else {
            setModifyNote(applied);
          }
          return result.source;
        }),
      true,
      instruction,
    );
  };

  const fixWithAI = (): Promise<void> => {
    const lastError = error;
    if (!lastError) return Promise.resolve();
    // Split a multi-issue validation message back into individual problems for the repair prompt.
    const issues = lastError.replace(/^Invalid app structure:\n?/, "").split("\n- ").map((s) => s.replace(/^- /, "").trim()).filter(Boolean);
    // `autoRepair: false` — `repairSource` IS the repair round. Left on, a still-invalid result sent
    // it straight into a SECOND `repairSource`: up to six model calls behind progress text promising
    // three, and a doubled "Repaired with N edits. Repaired with M edits." note.
    return withGen("Fix", () => repairSource(source, issues.length ? issues : [lastError]), false);
  };

  // --- My Apps ----------------------------------------------------------------------------------

  const save = async (): Promise<void> => {
    // Saving an app the preview already flagged is how invalid apps reached My Apps and only
    // surfaced much later, once validation existed. Confirm rather than block: an author may still
    // want to park work in progress.
    if (error && !(await shellDialogs.confirm(`This app has structure problems:\n\n${error}\n\nSave anyway?`))) return;
    // The description that produced this source is what makes a version legible later ("add a
    // 5-star rating"), so it rides along instead of being dropped once the model has answered.
    // Replay the chain through `saveUserApp` rather than writing history directly: it is the only
    // path that writes source, so going around it is how an unaudited edit would slip in. Each call
    // records one version, and consecutive duplicates are dropped (the last draft is usually
    // identical to the current source).
    const chain = [...drafts, { source, note: description.trim() || undefined }];
    const steps = chain.filter((step, i) => i === 0 || step.source !== chain[i - 1]!.source);
    let id = currentId ?? undefined;
    let record = null as Awaited<ReturnType<typeof saveUserApp>> | null;
    for (const step of steps) {
      record = await saveUserApp(
        { id, name: appName ?? description, source: step.source, note: step.note },
        new Date().toISOString(),
      );
      id = record.id;
    }
    if (!record) return;
    setDrafts([]);
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

  const deleteSaved = async (app: UserApp): Promise<void> => {
    await removeUserApp(app.id);
    setSavedApps(listUserApps());
    if (currentId === app.id) setCurrentId(null);
  };

  /**
   * Replay against the OPEN preview's runtime — the same live data the case's steps refer to, read
   * only (no `runAction`): see App.tsx's `onStopRecording` for why replaying an action step must
   * never be wired to data someone is actively looking at.
   */
  const replayStudioCase = async (c: Case): Promise<void> => {
    if (!preview) return;
    const runtime = preview.composed.runtime;
    const target: ReplayTarget = {
      definition: runtime.definition,
      query: async (_entity, pageId) => (await runtime.queryPage(pageId)).rows,
    };
    setCaseReport(await replayCase(target, c));
  };

  // Reviewing / rolling back a saved app's versions from the Studio. A restore lands in the editor
  // and re-runs the preview, so you can keep working from the version you just brought back.
  const [historyFor, setHistoryFor] = useState<UserApp | null>(null);
  const onRestored = (restored: string): void => {
    const app = historyFor;
    setHistoryFor(null);
    if (!app) return;
    setSource(restored);
    setCurrentId(app.id);
    setSavedApps(listUserApps());
    void buildPreview(restored, app.id);
  };

  /**
   * Start over. This throws away the current app AND the session's edit chain, and a draft that was
   * never saved cannot be recovered from history — so it asks first. Nothing to lose (an untouched
   * starter) means nothing to confirm.
   */
  const newDraft = async (): Promise<void> => {
    if (
      hasApp &&
      !(await shellDialogs.confirm(
        currentId
          ? "Start a new draft?\n\nThe Studio goes back to the starter app. Saved changes stay in My Apps, but anything unsaved here is lost."
          : "Start a new draft?\n\nThis app has never been saved — starting over discards it, and it cannot be recovered.",
      ))
    ) {
      return;
    }
    setCurrentId(null);
    setDescription("");
    setDrafts([]);
    // Starting over does not go through `withGen`, so it has to clear these itself — otherwise the
    // discarded app's "Applied 3 edits" (or its loss warning) sits under the starter.
    setModifyLoss(null);
    setModifyNote(null);
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
          <div className="k-gen-run">
            {/* ONE action. Which model answers lives behind the engine button, not in this row —
                four generate buttons meant the engine was whatever you last pressed, which is how
                an edit could reach a different model than the one on screen. */}
            <button
              type="button"
              className="k-add k-primary-action k-gen-go"
              disabled={!canDescribe || !ready}
              title={
                ready
                  ? `${hasApp ? "Send the whole current source and your change" : "Write a new app"} to ${label}.`
                  : `${label} needs an API key — open Model settings.`
              }
              onClick={() => void (hasApp ? modify() : create())}
            >
              {genBusy ? "Working…" : hasApp ? "✎ Modify the app" : "✨ Create the app"}
            </button>
            <button
              type="button"
              className="k-add k-gen-engine"
              aria-label="Model settings"
              title="Choose which model writes and edits your app"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙ {label}
            </button>
          </div>
          {!ready ? (
            <p className="k-muted">
              {label} needs an API key — set one in <strong>Model settings</strong>.
            </p>
          ) : null}
          {progress ? <p className="k-muted k-studio-progress">{progress}</p> : null}
        </aside>

        {/* Secondary: saving and the saved list. Its own region so that on a phone it can sit
            BELOW the preview — the prompt and its one action are what a phone shows first (#80). */}
        <aside className="k-studio-side">
          <div className="k-studio-savebar">
            <button type="button" className="k-add k-primary-action" disabled={busy} onClick={() => void save()}>
              {currentId ? "Save changes" : "Save to My Apps"}
            </button>
            <button type="button" className="k-add" onClick={() => void newDraft()}>New draft</button>
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
                  <button type="button" className="k-myapp-del" aria-label={`History of ${a.name}`} title="History" onClick={() => setHistoryFor(a)}>⟲</button>
                  <button type="button" className="k-myapp-del" aria-label={`Delete ${a.name}`} onClick={() => void deleteSaved(a)}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="k-studio-stage">
          <div className="k-studio-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "preview"} className="k-tab" data-active={tab === "preview"} onClick={() => pickTab("preview")}>
              Preview
            </button>
            <button type="button" role="tab" aria-selected={tab === "source"} className="k-tab" data-active={tab === "source"} onClick={() => pickTab("source")}>
              Source
            </button>
            {/* History at the same altitude as the app itself. It used to be a button in the save
                bar that only appeared for an app already saved — so the record of what you had just
                asked for was unreachable precisely while you were still asking. */}
            <button type="button" role="tab" aria-selected={tab === "history"} className="k-tab" data-active={tab === "history"} onClick={() => pickTab("history")}>
              History
            </button>
            <span className="k-studio-tabs-spacer" />
            {tab === "source" ? (
              <button type="button" className="k-add k-primary-action" disabled={busy} onClick={() => void buildPreview(source, currentId)}>
                {busy ? "Building…" : "Run ▶"}
              </button>
            ) : null}
            {/* `error && (apiKey || true)` — the second half was always true, a leftover from when
                this needed a cloud key. The real condition is whether the chosen engine can run. */}
            {error ? (
              <button
                type="button"
                className="k-add"
                disabled={genBusy || !ready}
                title={ready ? `Ask ${label} to fix this` : `${label} needs an API key — open Model settings`}
                onClick={() => void fixWithAI()}
              >
                {genBusy ? "Fixing…" : "Fix with AI"}
              </button>
            ) : null}
          </div>

          {modifyLoss ? (
            // Louder than a validation error on purpose: an invalid app announces itself the moment
            // you look at the preview, whereas a REWRITTEN app previews perfectly — it is simply
            // somebody else's app. Nothing is saved yet; this is the moment to notice.
            <p className="k-form-error k-studio-error k-modify-loss">
              This change rewrote your app rather than editing it — it {modifyLoss}. It was sent back
              once with that named and did it again, so this is what the model gives for this request.
              Nothing has been saved: use History, or reopen the app from My Apps, to get back to what
              you had — or try a smaller, more specific change.
            </p>
          ) : null}
          {modifyNote ? <p className="k-muted k-modify-note">{modifyNote}</p> : null}
          {error ? <p className="k-form-error k-studio-error">{error}</p> : null}

          {tab === "preview" ? (
            <div className="k-studio-preview" aria-label="App preview">
              {busy && !preview ? (
                <p className="k-muted k-studio-building">Building…</p>
              ) : preview ? (
                <App key={preview.build} runtime={preview.composed.runtime} provenance={preview.provenance} toaster={preview.toaster} picker={preview.picker} />
              ) : null}
            </div>
          ) : tab === "source" ? (
            <CodeEditor className="k-studio-source" label="App source" value={source} onChange={setSource} />
          ) : (
            <div className="k-studio-history" aria-label="App history">
              {/* What people reported, above the session's own log — a case is evidence someone
                  handed you, not a step you took, so it reads first. */}
              {currentId && cases.length ? (
                <section className="k-cases-section">
                  <h3 className="k-field-label">Reported problems</h3>
                  <ul className="k-cases">
                    {cases.map((c) => (
                      <li key={c.id}>
                        <span className="k-case-title">{caseLabel(c)}</span>
                        <button
                          type="button"
                          className="k-add"
                          disabled={!preview}
                          title={preview ? "Replay this path against the running preview" : "Open the preview first"}
                          onClick={() => void replayStudioCase(c)}
                        >
                          Replay
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {/* This session first. Until an app is saved it has no version log, so the prompts you
                  just typed lived only in `drafts` and were invisible — the record started existing
                  at exactly the moment you no longer needed it most. */}
              {drafts.length ? (
                <section className="k-session">
                  <h3 className="k-field-label">This session · not saved yet</h3>
                  <ol className="k-session-list">
                    {[...drafts].reverse().map((d, i) => (
                      <li key={drafts.length - i}>
                        <span className="k-history-note">{d.note ?? "(no prompt recorded)"}</span>
                        <button
                          type="button"
                          className="k-add"
                          title="Put this version back in the editor"
                          onClick={() => {
                            setSource(d.source);
                            void buildPreview(d.source, currentId);
                            pickTab("preview");
                          }}
                        >
                          Restore
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
              {currentId ? (
                <History
                  appId={currentId}
                  appName={appName ?? "this app"}
                  embedded
                  onClose={() => pickTab("preview")}
                  onRestored={(restored) => {
                    setSource(restored);
                    setSavedApps(listUserApps());
                    void buildPreview(restored, currentId);
                    pickTab("preview");
                  }}
                />
              ) : drafts.length ? null : (
                <p className="k-muted">
                  Nothing yet. Create or modify an app and every step shows up here — the prompt you
                  typed, and the way back to it.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {historyFor ? (
        <History appId={historyFor.id} appName={historyFor.name} onClose={() => setHistoryFor(null)} onRestored={onRestored} />
      ) : null}
      {caseReport ? <CaseReport report={caseReport} onClose={() => setCaseReport(null)} /> : null}
      {settingsOpen ? (
        <EngineSettings
          config={engineCfg}
          onChange={setEngineCfg}
          onClose={() => setSettingsOpen(false)}
          hasWebGPU={hasWebGPU}
          hasBuiltIn={hasBuiltIn}
        />
      ) : null}
    </div>
  );
}

async function newMemoryStore(): Promise<Store> {
  const store = new MemoryStore();
  await store.open("studio-draft");
  return store;
}
