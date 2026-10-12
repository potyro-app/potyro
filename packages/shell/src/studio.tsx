// Studio — making an app is a conversation (#261).
//
// It opens on the conversation, full screen: what you want, the agent's questions when something is
// not clear, and a card for every version it makes. The app itself is opened from its card, as the
// app it will be — the whole screen on a phone, beside the conversation on a wide one — with the way
// back always on its bar. The code and the version history are behind it, in the menu.
//
// Every version is SAVED as it is made. The old Studio built a draft and waited for a Save button,
// so a closed tab or a reload lost both the app and what had been asked for it; with the
// conversation now kept (studio-chat.ts), an app that was not kept beside it would be the odd one
// out. History is the undo: an older card offers to go back to it. What is NOT saved is a version
// that fails the gates — it does not load, its structure is wrong, or it rewrote the app instead of
// editing it — which is held back on a card of its own, with what can be done about it.
//
// Everything here runs the person's own app trusted (CLAUDE.md rule 3); studio-preview.tsx builds it.

import { useCallback, useEffect, useRef, useState } from "react";
import { replayCase, type Case, type ReplayReport, type ReplayTarget } from "@potyro/runtime";
import { ActionMenu, type MenuEntry } from "@potyro/views";
import { hasBuiltInAI } from "@potyro/generator/backends";
import { listCases } from "./app-cases.js";
import { recordDiagnosis } from "./app-diagnoses.js";
import { CaseReport } from "./case-report.js";
import { duplicateUserApp, getUserApp, renameUserApp, saveUserApp, type UserApp } from "./user-apps.js";
import { loadTrustedModule } from "./trusted-loader.js";
import { confirmAndRemoveApp } from "./remove-app.js";
import { navigateTo } from "./router.js";
import { listVersions, type VersionOrigin } from "./app-history.js";
import { EngineSettings } from "./engine-settings.js";
import { engineLabel, engineReady } from "./engines.js";
import { useEngineConfig } from "./engine-store.js";
import { shellDialogs } from "./dialog.js";
import { adoptDraft, appendMessage, briefSince, clearChat, isDraftId, listMessages, newDraftId, threadItems, type ChatItem, type NewMessage } from "./studio-chat.js";
import { shapeOrEmpty, studioEngine, type Outcome } from "./studio-engine.js";
import { buildPreview, PreviewScreen, type Preview } from "./studio-preview.js";
import { ThreadView } from "./studio-thread-view.js";
import { modulesOf } from "./app-modules.js";
import { StudioTools, type ToolsTab } from "./studio-tools.js";

/** What "Write the code yourself" starts from when there is no app yet. */
const STARTER = `import { defineApp } from "potyro";

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

/** Wide enough for the conversation and the app side by side. Narrower, the app takes the screen. */
const SIDE_BY_SIDE = "(min-width: 1100px)";

function useWide(): boolean {
  const query = typeof matchMedia === "function" ? matchMedia(SIDE_BY_SIDE) : null;
  const [wide, setWide] = useState(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = (): void => setWide(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return wide;
}

/**
 * What a saved app is called after a change.
 *
 * The person's name wins: an app renamed in the launcher or here keeps what it was called, whatever
 * its source says. An app that was never renamed — still called what its source said — follows its
 * source, so "call the app Shopping" or editing `name:` by hand renames it.
 */
async function nameAfter(app: UserApp, nextDefined: string | undefined): Promise<string> {
  if (!nextDefined) return app.name;
  let before: string | undefined;
  try {
    before = (await loadTrustedModule(app.source, await modulesOf(app.id))).name;
  } catch {
    before = undefined;
  }
  return before === undefined || before === app.name ? nextDefined : app.name;
}

/** A version that was made and failed a gate, so it was not saved. */
interface Held {
  source: string;
  summary: string;
  /** What was asked, for the version's note if it is kept. */
  note: string;
  issues: string[];
  loss: string | null;
}

export interface StudioProps {
  onClose: () => void;
  /** What to start the box with — a launcher search that found nothing offers to create it (#85). */
  initialDescription?: string;
  /** The saved app to open on: "Studio — change this app" passes the one it was opened from. */
  initialAppId?: string;
  /** An unfinished conversation to pick up (the launcher's drafts). */
  initialDraftId?: string;
}

export function Studio({ onClose, initialDescription, initialAppId, initialDraftId }: StudioProps) {
  const opened = initialAppId ? getUserApp(initialAppId) : undefined;
  // The conversation's id is the app's once there is one, a draft's until then. A ref as well as
  // state: a turn runs across awaits, and the draft becomes an app in the middle of one.
  const [chatId, setChatIdState] = useState<string>(() => opened?.id ?? initialDraftId ?? newDraftId());
  const chatRef = useRef(chatId);
  const setChatId = (id: string): void => {
    chatRef.current = id;
    setChatIdState(id);
  };
  const [appId, setAppIdState] = useState<string | null>(opened?.id ?? null);
  const appRef = useRef(appId);
  const setAppId = (id: string | null): void => {
    appRef.current = id;
    setAppIdState(id);
  };
  /** The saved app's source — what a change is made to. Null until there is an app. */
  const [source, setSource] = useState<string | null>(opened?.source ?? null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const [items, setItems] = useState<ChatItem[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [held, setHeld] = useState<Held | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolsTab | null>(null);
  const [draftSource, setDraftSource] = useState(opened?.source ?? STARTER);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolsBusy, setToolsBusy] = useState(false);
  const [cases, setCases] = useState<Case[]>([]);
  const [caseReport, setCaseReport] = useState<ReplayReport | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [engineCfg, setEngineCfg] = useEngineConfig();
  const wide = useWide();
  const scrollRef = useRef<HTMLDivElement>(null);

  const label = engineLabel(engineCfg);
  const ready = engineReady(engineCfg);
  const busy = working !== null;
  const appName = (appId ? getUserApp(appId)?.name : undefined) ?? preview?.composed.runtime.definition.name ?? "Your app";
  const hasApp = appId !== null;

  /** Read the conversation back: its messages, and every version it does not already tell. */
  const refresh = useCallback(async (): Promise<void> => {
    const [messages, versions] = await Promise.all([listMessages(chatRef.current), appRef.current ? listVersions(appRef.current) : Promise.resolve([])]);
    setItems(threadItems(messages, versions));
  }, []);

  /** Add to the conversation. A message that could not be kept is said, never dropped quietly. */
  const say = async (message: NewMessage): Promise<void> => {
    try {
      await appendMessage(chatRef.current, message, new Date().toISOString());
    } catch (e) {
      setProblem(`This conversation could not be saved: ${e instanceof Error ? e.message : String(e)}`);
    }
    await refresh();
  };

  // Arriving: the conversation, and the app built so that Open has something to open.
  useEffect(() => {
    void refresh();
    if (opened) {
      void buildPreview(opened.source, opened.id).then(({ preview: built }) => {
        setPreview(built);
        if (wide) setPreviewOpen(true);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New messages arrive at the bottom; keep them in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items, working, held]);

  useEffect(() => {
    if (!appId) return setCases([]);
    let alive = true;
    void listCases(appId).then((c) => alive && setCases(c));
    return () => {
      alive = false;
    };
  }, [appId]);

  const engine = async () => studioEngine(engineCfg, (text) => setWorking(text ?? ""), await modulesOf(appRef.current ?? undefined));

  /**
   * Keep a version: save it, give the conversation its card, and — when this was the first — make
   * the draft the app's conversation.
   */
  const keep = async (next: string, built: Preview | null, summary: string, note: string, origin?: VersionOrigin): Promise<void> => {
    const existing = appRef.current ? getUserApp(appRef.current) : undefined;
    const defined = built?.composed.runtime.definition.name;
    const name = existing ? await nameAfter(existing, defined) : defined || note.split("\n")[0]!.slice(0, 40) || "Untitled app";
    const record = await saveUserApp({ id: existing?.id, name, source: next, note: note || undefined, rationale: summary || undefined, origin }, new Date().toISOString());
    const seq = (await listVersions(record.id))[0]?.seq;
    if (!existing) {
      if (isDraftId(chatRef.current)) await adoptDraft(chatRef.current, record.id);
      setChatId(record.id);
      setAppId(record.id);
      // Built on a scratch store while it had no id; its own data lives under that id from now on.
      setPreview((await buildPreview(next, record.id)).preview);
    } else {
      setPreview(built);
    }
    setSource(next);
    setDraftSource(next);
    setHeld(null);
    await say({ kind: "version", text: summary || (existing ? "Changed." : `Made “${name}”.`), seq, name });
    if (wide) setPreviewOpen(true);
  };

  /** A source arrived: check it, repair it once if its structure is wrong, then keep it or hold it. */
  const land = async (next: string, summary: string, note: string, loss: string | null): Promise<void> => {
    setWorking("Checking it…");
    let src = next;
    let said = summary;
    let lost = loss;
    let { preview: built, issues } = await buildPreview(src, appRef.current);
    if (issues.length && ready) {
      try {
        const fixed = await (await engine()).repair(src, issues);
        src = fixed.source;
        said = `${said} ${fixed.summary}`.trim();
        lost = lost ?? fixed.loss;
        ({ preview: built, issues } = await buildPreview(src, appRef.current));
      } catch {
        // The problems stand, and are said below.
      }
    }
    if (issues.length || lost) {
      setHeld({ source: src, summary: said, note, issues, loss: lost });
      setPreview(built ?? preview);
      await say({
        kind: "failure",
        text: lost
          ? `This change rewrote your app rather than editing it — it ${lost}. Nothing was saved; try a smaller, more specific change.`
          : `What came back has problems, so it was not saved:\n- ${issues.join("\n- ")}`,
      });
      return;
    }
    await keep(src, built, said, note);
  };

  const answer = async (outcome: Outcome, note: string): Promise<void> => {
    if (outcome.kind === "question") return say({ kind: "question", text: outcome.text });
    if (outcome.kind === "refusal") return say({ kind: "refusal", text: outcome.text });
    if (outcome.kind === "failed") return say({ kind: "failure", text: outcome.text });
    // The ladder's third rung (#132): what could not be done is a host gap, filed with the app's
    // diagnoses so Edit mode reads it back as already reported.
    if (outcome.kind === "source" && outcome.notDone?.length && appRef.current) {
      const now = new Date().toISOString();
      for (const part of outcome.notDone) void recordDiagnosis(appRef.current, { complaint: note, text: part }, now);
    }
    await land(outcome.source, outcome.summary, note, outcome.kind === "loss" ? outcome.loss : null);
  };

  /** One turn: what was asked joins the conversation, the box empties, and the answer lands under it. */
  const send = async (text = description): Promise<void> => {
    const asked = text.trim();
    if (!asked || busy || !ready) return;
    setDescription("");
    setProblem(null);
    setWorking("");
    try {
      await say({ kind: "ask", text: asked });
      // Everything said since the app last changed, so an answer reaches the model beside its question.
      const brief = briefSince(await listMessages(chatRef.current)) || asked;
      setHeld(null);
      const current = sourceRef.current;
      const modules = await modulesOf(appRef.current ?? undefined);
      const outcome = current !== null ? await (await engine()).modify(current, await shapeOrEmpty(current, modules), brief) : await (await engine()).create(brief);
      await answer(outcome, brief);
    } finally {
      setWorking(null);
    }
  };

  const fixHeld = async (): Promise<void> => {
    if (!held || busy) return;
    setWorking("");
    try {
      const fixed = await (await engine()).repair(held.source, held.issues);
      await land(fixed.source, `${held.summary} ${fixed.summary}`.trim(), held.note, fixed.loss);
    } catch (e) {
      await say({ kind: "failure", text: `Could not fix it: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setWorking(null);
    }
  };

  const keepHeld = async (): Promise<void> => {
    if (!held) return;
    const h = held;
    const go = await shellDialogs.confirm(
      h.loss ? `Keep it anyway? This version ${h.loss}.` : "Keep it anyway? It has problems, so parts of it may not work.",
      { detail: "You can go back to the version before from History.", ok: "Keep it" },
    );
    if (!go) return;
    await keep(h.source, preview, `${h.summary} Kept with problems.`.trim(), h.note);
  };

  /** An older card: put that version back, as a new version — nothing after it is lost. */
  const goBack = async (seq: number): Promise<void> => {
    const id = appRef.current;
    if (!id || busy) return;
    const version = (await listVersions(id)).find((v) => v.seq === seq);
    const app = getUserApp(id);
    if (!version || !app) return;
    if (!(await shellDialogs.confirm(`Go back to version ${seq}?`, { detail: "The versions after it stay in History.", ok: "Go back" }))) return;
    await saveUserApp({ id, name: app.name, source: version.source, origin: "restored", note: `went back to version ${seq}` }, new Date().toISOString());
    await afterRestore(version.source);
  };

  const afterRestore = async (restored: string): Promise<void> => {
    setSource(restored);
    setDraftSource(restored);
    setHeld(null);
    setPreview((await buildPreview(restored, appRef.current)).preview);
    await refresh();
  };

  // --- The code, by hand ------------------------------------------------------------------------

  const runDraft = async (): Promise<void> => {
    setToolsBusy(true);
    const { preview: built, issues } = await buildPreview(draftSource, appRef.current);
    setToolsBusy(false);
    if (built) setPreview(built);
    setToolsError(issues.length ? `Invalid app structure:\n- ${issues.join("\n- ")}` : null);
    if (!issues.length && built) {
      setTools(null);
      setPreviewOpen(true);
    }
  };

  const saveDraft = async (): Promise<void> => {
    setToolsBusy(true);
    const { preview: built, issues } = await buildPreview(draftSource, appRef.current);
    setToolsBusy(false);
    if (issues.length) {
      setToolsError(`Invalid app structure:\n- ${issues.join("\n- ")}`);
      // Confirm rather than block: an author may still want to park work in progress.
      if (!(await shellDialogs.confirm(`This app has structure problems:\n\n${issues.join("\n")}\n\nSave anyway?`))) return;
    }
    setToolsError(null);
    await keep(draftSource, built, "Changed by hand, in the code.", "edited the code by hand", "edited");
  };

  const replay = async (c: Case): Promise<void> => {
    if (!preview) return;
    const runtime = preview.composed.runtime;
    // Read only: replaying an action step must never write into data someone is looking at.
    const target: ReplayTarget = { definition: runtime.definition, query: async (_entity, pageId) => (await runtime.queryPage(pageId)).rows };
    setCaseReport(await replayCase(target, c));
  };

  const startOver = (): void => {
    setChatId(newDraftId());
    setAppId(null);
    setSource(null);
    setDraftSource(STARTER);
    setPreview(null);
    setPreviewOpen(false);
    setHeld(null);
    setItems([]);
    setDescription("");
  };

  const deleteDraft = async (): Promise<void> => {
    if (!(await shellDialogs.confirm("Delete this conversation?", { detail: "Nothing was made from it yet, so there is no app to keep.", ok: "Delete", destructive: true }))) return;
    await clearChat(chatRef.current);
    startOver();
  };

  // --- The app itself: rename, copy, delete — here, where you are working on it ------------------

  const [, renamed] = useState(0);
  const rename = async (): Promise<void> => {
    const app = appRef.current ? getUserApp(appRef.current) : undefined;
    if (!app) return;
    const next = await shellDialogs.prompt("Rename app", { default: app.name });
    if (!next?.trim()) return;
    renameUserApp(app.id, next, new Date().toISOString());
    renamed((n) => n + 1);
  };

  /** A copy to work on, opened straight away: in here a copy is something you made in order to change it. */
  const duplicate = async (): Promise<void> => {
    const copy = appRef.current ? await duplicateUserApp(appRef.current, new Date().toISOString()) : null;
    if (!copy) return;
    setChatId(copy.id);
    setAppId(copy.id);
    setSource(copy.source);
    setDraftSource(copy.source);
    setHeld(null);
    setPreview((await buildPreview(copy.source, copy.id)).preview);
    await refresh();
  };

  const remove = async (): Promise<void> => {
    const app = appRef.current ? getUserApp(appRef.current) : undefined;
    if (!app || !(await confirmAndRemoveApp(app))) return;
    // The app it was opened from is gone: home, not back to it.
    onClose();
    navigateTo({ kind: "home" });
  };

  const menu: MenuEntry[] = [
    { key: "code", label: hasApp ? "See the code" : "Write the code yourself", icon: "⌘", onSelect: () => setTools("source") },
    { key: "history", label: "History", icon: "⟲", hint: cases.length ? `${cases.length} reported` : undefined, onSelect: () => setTools("history") },
    { key: "model", label: "Model settings", icon: "⚙", hint: label, onSelect: () => setSettingsOpen(true) },
    ...(hasApp
      ? ([
          "separator",
          { key: "rename", label: "Rename", icon: "✎", onSelect: () => void rename() },
          { key: "duplicate", label: "Duplicate", icon: "⧉", hint: "the app, not its data", onSelect: () => void duplicate(), disabled: busy },
        ] as MenuEntry[])
      : []),
    "separator",
    { key: "new", label: "Start a new app", icon: "＋", onSelect: startOver, disabled: busy },
    ...(hasApp ? [{ key: "delete", label: `Delete ${appName}`, danger: true, onSelect: () => void remove() } as const] : []),
    ...(!hasApp && items.length ? [{ key: "delete", label: "Delete this conversation", danger: true, onSelect: () => void deleteDraft() } as const] : []),
  ];

  const canOpen = preview !== null && (hasApp || held !== null);
  const showPreview = previewOpen && preview !== null;

  return (
    <div className="k-studio" role="dialog" aria-label="App studio" data-preview={showPreview || undefined}>
      <div className="k-studio-chat">
        <header className="k-studio-bar">
          <button type="button" className="k-studio-close" aria-label="Close studio" onClick={onClose}>
            ✕
          </button>
          <div className="k-studio-title">
            <span className="k-studio-eyebrow">Studio</span>
            <strong className="k-studio-name">{hasApp ? appName : "New app"}</strong>
          </div>
          {canOpen && !showPreview ? (
            <button type="button" className="k-studio-open" onClick={() => setPreviewOpen(true)}>
              Preview <span aria-hidden>▸</span>
            </button>
          ) : null}
          <ActionMenu label="Studio menu" entries={menu} buttonClassName="k-studio-more" />
        </header>

        <div className="k-studio-scroll" ref={scrollRef}>
          <div className="k-studio-column">
            <ThreadView
              items={items}
              app={appId ? { id: appId, name: appName } : null}
              working={working}
              held={held ? { name: appName, why: held.loss ? "Rewrote the app instead of editing it." : `${held.issues.length} problem${held.issues.length === 1 ? "" : "s"} with it.`, canFix: held.issues.length > 0 && ready } : null}
              onOpen={() => setPreviewOpen(true)}
              onGoBack={(seq) => void goBack(seq)}
              onFix={() => void fixHeld()}
              onKeep={() => void keepHeld()}
              onLook={() => setPreviewOpen(true)}
              onSuggest={(s) => setDescription(s)}
              existing={hasApp}
            />
            {problem ? <p className="k-form-error k-studio-problem">{problem}</p> : null}
          </div>
        </div>

        <footer className="k-composer">
          <div className="k-composer-box">
            <textarea
              id="k-studio-desc"
              className="k-composer-input"
              aria-label="Describe the app"
              placeholder={hasApp ? "Ask for a change…" : "Describe the app you want…"}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends on a keyboard; a phone's Enter is a new line, and its send button is right there.
                if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              className="k-composer-send"
              aria-label={hasApp ? "Modify the app" : "Create the app"}
              title={ready ? `Send to ${label}` : `${label} needs an API key — open Model settings`}
              disabled={!description.trim() || busy || !ready}
              onClick={() => void send()}
            >
              <span aria-hidden>↑</span>
            </button>
          </div>
          <div className="k-composer-meta">
            <button type="button" className="k-composer-engine" aria-label="Model settings" title="Choose which model writes and edits your app" onClick={() => setSettingsOpen(true)}>
              ⚙ {label}
            </button>
            {!ready ? <span className="k-composer-warn">needs an API key</span> : null}
          </div>
        </footer>
      </div>

      {showPreview ? (
        <PreviewScreen
          preview={preview}
          title={appName}
          version={items.reduce<number | undefined>((v, i) => (i.type === "version" && i.current ? i.seq : v), undefined)}
          unsaved={held !== null}
          onBack={() => setPreviewOpen(false)}
          onSource={() => setTools("source")}
        />
      ) : null}

      {tools ? (
        <StudioTools
          initialTab={tools}
          source={draftSource}
          onSourceChange={setDraftSource}
          onRun={runDraft}
          onSave={saveDraft}
          error={toolsError}
          busy={toolsBusy}
          app={appId ? { id: appId, name: appName } : null}
          cases={cases}
          onReplay={(c) => void replay(c)}
          onRestored={(restored) => {
            setTools(null);
            void afterRestore(restored);
          }}
          onClose={() => setTools(null)}
        />
      ) : null}
      {caseReport ? <CaseReport report={caseReport} onClose={() => setCaseReport(null)} /> : null}
      {settingsOpen ? (
        <EngineSettings
          config={engineCfg}
          onChange={setEngineCfg}
          onClose={() => setSettingsOpen(false)}
          hasWebGPU={typeof navigator !== "undefined" && "gpu" in navigator}
          hasBuiltIn={hasBuiltInAI()}
        />
      ) : null}
    </div>
  );
}
