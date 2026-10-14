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
import { getUserApp, lockToRestore, renameUserApp, saveUserApp, setUserAppTrusted, type UserApp } from "./user-apps.js";
import { loadTrustedModule } from "./trusted-loader.js";
import { confirmAndRemoveApp } from "./remove-app.js";
import { navigateTo } from "./router.js";
import { listVersions, type VersionOrigin } from "./app-history.js";
import { EngineSettings } from "./engine-settings.js";
import { engineLabel, engineReady } from "./engines.js";
import { useEngineConfig } from "./engine-store.js";
import { shellDialogs } from "./dialog.js";
import { followChat, syncChat } from "./chat-sync.js";
import { adoptDraft, appendMessage, briefSince, clearChat, earlierConversation, isDraftId, listMessages, newDraftId, threadItems, type ChatItem, type NewMessage } from "./studio-chat.js";
import { shapeOrEmpty, studioEngine, type Outcome } from "./studio-engine.js";
import { buildPreview, PreviewScreen, type Preview } from "./studio-preview.js";
import { PointGlyph } from "./point-mode.js";
import { pointContext, type Pointed } from "./point-target.js";
import { ThreadView } from "./studio-thread-view.js";
import { duplicateApp, modulesOf } from "./app-modules.js";
import { describeLibrary } from "./package-libraries.js";
import { keepLibraryFiles, librariesToFetch, prepareStudioLibraries, type StudioLibraries } from "./studio-libraries.js";
import { StudioTools, type ToolsTab } from "./studio-tools.js";
import { ownName, shownName } from "./app-words.js";
import { languagePrefs } from "./locale.js";
import { platformAsk, useStudioRequests } from "./studio-requests.js";

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
    before = ownName(await loadTrustedModule(app.source, await modulesOf(app.id)));
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
  /** Its libraries, already fetched with the person's say-so (#266). */
  libraries: StudioLibraries | null;
}

export interface StudioProps {
  onClose: () => void;
  /** What to start the box with — a launcher search that found nothing offers to create it (#85). */
  initialDescription?: string;
  /** The saved app to open on: "Studio — change this app" passes the one it was opened from. */
  initialAppId?: string;
  /** An unfinished conversation to pick up (the launcher's drafts). */
  initialDraftId?: string;
  /** A part of the app already pointed at — edit mode's "More changes…" on a label (#284). */
  initialPoint?: Pointed;
}

export function Studio({ onClose, initialDescription, initialAppId, initialDraftId, initialPoint }: StudioProps) {
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
  // Point mode (#284): pointing is the preview taking taps instead of the app; `point` is the part
  // the next message is about, shown on the box until it is sent or taken off.
  const [pointing, setPointing] = useState(false);
  const [point, setPoint] = useState<Pointed | null>(initialPoint ?? null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
  const savedName = appId ? getUserApp(appId)?.name : undefined;
  // The name the person reads (#302): their own for it, or the source's in their language.
  const appName = preview ? shownName(savedName, preview.composed.runtime.core.app.definition, languagePrefs()) : (savedName ?? "Your app");
  const hasApp = appId !== null;

  /** Read the conversation back: its messages, and every version it does not already tell. */
  const refresh = useCallback(async (): Promise<void> => {
    const [messages, versions] = await Promise.all([listMessages(chatRef.current), appRef.current ? listVersions(appRef.current) : Promise.resolve([])]);
    setItems(threadItems(messages, versions));
  }, []);

  /** The conversation from your other devices, and this one's sent to them (#283). Never in the way. */
  const follow = useCallback(async (): Promise<void> => {
    const id = appRef.current;
    if (id && (await syncChat(id))) await refresh();
  }, [refresh]);
  // ...and live while it is open: what you say on another device shows up here (#283).
  useEffect(() => (appId ? followChat(appId, () => void refresh()) : undefined), [appId, refresh]);

  /** Add to the conversation. A message that could not be kept is said, never dropped quietly. */
  const say = async (message: NewMessage): Promise<void> => {
    try {
      await appendMessage(chatRef.current, message, new Date().toISOString());
    } catch (e) {
      setProblem(`This conversation could not be saved: ${e instanceof Error ? e.message : String(e)}`);
    }
    await refresh();
    void follow();
  };

  // Requests to the Potyro team (#263): the cards' review and send, and the ones kept for later.
  const requests = useStudioRequests({
    chatId: () => chatRef.current,
    source: () => sourceRef.current,
    appName: () => (appRef.current ? getUserApp(appRef.current)?.name : undefined),
    say,
    refresh,
  });

  // Arriving: the conversation, and the app built so that Open has something to open.
  useEffect(() => {
    void refresh().then(follow);
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
  const keep = async (
    next: string,
    built: Preview | null,
    summary: string,
    note: string,
    origin?: VersionOrigin,
    libraries?: StudioLibraries | null,
    extra: Pick<NewMessage, "platform"> = {},
  ): Promise<void> => {
    const existing = appRef.current ? getUserApp(appRef.current) : undefined;
    // Saved in the app's OWN language: a translated app keeps one stored name, and each device shows
    // the source's name in its own language around it (#302).
    const defined = built ? ownName(built.composed.runtime.core.app.definition) : undefined;
    const name = existing ? await nameAfter(existing, defined) : defined || note.split("\n")[0]!.slice(0, 40) || "Untitled app";
    // A library's bytes are in the app's folder before its record names them, so no open finds one missing.
    if (existing && libraries?.files.length) await keepLibraryFiles(existing, libraries.files);
    const record = await saveUserApp(
      { id: existing?.id, name, source: next, lock: libraries?.lock, note: note || undefined, rationale: summary || undefined, origin },
      new Date().toISOString(),
    );
    if (!existing && libraries?.files.length) await keepLibraryFiles(record, libraries.files);
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
    await say({ kind: "version", text: summary || (existing ? "Changed." : `Made “${name}”.`), seq, name, ...extra });
    if (wide) setPreviewOpen(true);
  };

  /**
   * The libraries a version imports (#266), the way Add an app does it: what will be fetched is said
   * first — "fetches chart.js 4.4.1 from esm.sh" — and fetched once, now, only if the person agrees.
   * Null for an app with none; a sentence when the version cannot be kept as it is.
   */
  const librariesFor = async (src: string): Promise<StudioLibraries | null | string> => {
    const have = await modulesOf(appRef.current ?? undefined);
    const { lines, issues } = await librariesToFetch(src, have);
    if (issues.length) return `Not saved: ${issues[0]}`;
    if (lines.length) {
      const go = await shellDialogs.confirm(lines.length === 1 ? "Fetch the library this version uses?" : "Fetch the libraries this version uses?", {
        detail: `${lines.map((l) => describeLibrary(l)).join("\n")}\n\nOnce, now, and kept with the app: after that it works without the internet.`,
        ok: "Fetch",
      });
      if (!go) return `Not saved: it uses ${lines.map((l) => l.label).join(", ")}, which ${lines.length === 1 ? "was" : "were"} not fetched.`;
    }
    try {
      const libraries = await prepareStudioLibraries(src, have);
      const fetched = libraries?.fetched.map((l) => describeLibrary(l, { done: true })) ?? [];
      if (fetched.length) await say({ kind: "event", text: `${fetched.join("; ").replace(/^f/, "F")}.` });
      return libraries;
    } catch (e) {
      return `Not saved: ${e instanceof Error ? e.message : String(e)}`;
    }
  };

  /** A source arrived: check it, repair it once if its structure is wrong, then keep it or hold it. */
  const land = async (next: string, summary: string, note: string, loss: string | null, extra: Pick<NewMessage, "platform"> = {}): Promise<void> => {
    setWorking("Checking it…");
    let src = next;
    let said = summary;
    let lost = loss;
    const first = await librariesFor(src);
    if (typeof first === "string") return say({ kind: "failure", text: first });
    let libraries = first;
    let { preview: built, issues } = await buildPreview(src, appRef.current, libraries?.modules);
    if (issues.length && ready) {
      try {
        const fixed = await (await engine()).repair(src, issues);
        src = fixed.source;
        said = `${said} ${fixed.summary}`.trim();
        lost = lost ?? fixed.loss;
        const again = await librariesFor(src);
        if (typeof again === "string") return say({ kind: "failure", text: again });
        libraries = again;
        ({ preview: built, issues } = await buildPreview(src, appRef.current, libraries?.modules));
      } catch {
        // The problems stand, and are said below.
      }
    }
    if (issues.length || lost) {
      setHeld({ source: src, summary: said, note, issues, loss: lost, libraries });
      setPreview(built ?? preview);
      await say({
        kind: "failure",
        text: lost
          ? `This change rewrote your app rather than editing it — it ${lost}. Nothing was saved; try a smaller, more specific change.`
          : `What came back has problems, so it was not saved:\n- ${issues.join("\n- ")}`,
        ...extra,
      });
      return;
    }
    await keep(src, built, said, note, undefined, libraries, extra);
  };

  const answer = async (outcome: Outcome, note: string): Promise<void> => {
    if (outcome.kind === "question") return say({ kind: "question", text: outcome.text });
    if (outcome.kind === "refusal") return say({ kind: "refusal", text: outcome.text });
    // What Potyro itself lacks (#263): the request rides on what the agent says, for the card.
    if (outcome.kind === "platform") return say({ kind: "refusal", text: outcome.text, ...platformAsk(outcome.request) });
    if (outcome.kind === "failed") return say({ kind: "failure", text: outcome.text, ...(outcome.detail ? { detail: outcome.detail } : {}), ...platformAsk(outcome.platformRequest) });
    // The ladder's third rung (#132): what could not be done is a host gap, filed with the app's
    // diagnoses so Edit mode reads it back as already reported.
    if (outcome.kind === "source" && outcome.notDone?.length && appRef.current) {
      const now = new Date().toISOString();
      for (const part of outcome.notDone) void recordDiagnosis(appRef.current, { complaint: note, text: part }, now);
    }
    await land(outcome.source, outcome.summary, note, outcome.kind === "loss" ? outcome.loss : null, outcome.kind === "source" ? platformAsk(outcome.platformRequest) : {});
  };

  /** One turn: what was asked joins the conversation, the box empties, and the answer lands under it. */
  const send = async (text = description): Promise<void> => {
    const asked = text.trim();
    if (!asked || busy || !ready) return;
    const about = point;
    setDescription("");
    setPoint(null);
    setPointing(false);
    setProblem(null);
    setWorking("");
    try {
      await say({ kind: "ask", text: asked, ...(about ? { point: { label: about.label, words: about.words } } : {}) });
      // Everything said since the app last changed, so an answer reaches the model beside its question;
      // and what was said before that, for the loop's recap of earlier versions (#279).
      const said = await listMessages(chatRef.current);
      const brief = briefSince(said) || asked;
      const earlier = appRef.current ? earlierConversation(said, await listVersions(appRef.current)) : [];
      setHeld(null);
      const current = sourceRef.current;
      const modules = await modulesOf(appRef.current ?? undefined);
      // What was pointed at goes beside the request: in words, and as the lines of the app that hold it.
      const context = about && current !== null ? await pointContext(current, about) : undefined;
      const outcome =
        current !== null ? await (await engine()).modify(current, await shapeOrEmpty(current, modules), brief, context, earlier) : await (await engine()).create(brief);
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
    await keep(h.source, preview, `${h.summary} Kept with problems.`.trim(), h.note, undefined, h.libraries);
  };

  /** An older card: put that version back, as a new version — nothing after it is lost. */
  const goBack = async (seq: number): Promise<void> => {
    const id = appRef.current;
    if (!id || busy) return;
    const version = (await listVersions(id)).find((v) => v.seq === seq);
    const app = getUserApp(id);
    if (!version || !app) return;
    if (!(await shellDialogs.confirm(`Go back to version ${seq}?`, { detail: "The versions after it stay in History.", ok: "Go back" }))) return;
    await saveUserApp({ id, name: app.name, source: version.source, lock: lockToRestore(version, app), origin: "restored", note: `went back to version ${seq}` }, new Date().toISOString());
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

  /** The libraries the hand-written code imports, fetched for Run and reused by Save of the same code. */
  const draftLibraries = useRef<{ source: string; libraries: StudioLibraries | null } | null>(null);
  const librariesForDraft = async (): Promise<StudioLibraries | null | string> => {
    if (draftLibraries.current?.source === draftSource) return draftLibraries.current.libraries;
    const libraries = await librariesFor(draftSource);
    if (typeof libraries !== "string") draftLibraries.current = { source: draftSource, libraries };
    return libraries;
  };

  const runDraft = async (): Promise<void> => {
    setToolsBusy(true);
    const libraries = await librariesForDraft();
    if (typeof libraries === "string") {
      setToolsBusy(false);
      return setToolsError(libraries);
    }
    const { preview: built, issues } = await buildPreview(draftSource, appRef.current, libraries?.modules);
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
    const libraries = await librariesForDraft();
    if (typeof libraries === "string") {
      setToolsBusy(false);
      return setToolsError(libraries);
    }
    const { preview: built, issues } = await buildPreview(draftSource, appRef.current, libraries?.modules);
    setToolsBusy(false);
    if (issues.length) {
      setToolsError(`Invalid app structure:\n- ${issues.join("\n- ")}`);
      // Confirm rather than block: an author may still want to park work in progress.
      if (!(await shellDialogs.confirm(`This app has structure problems:\n\n${issues.join("\n")}\n\nSave anyway?`))) return;
    }
    setToolsError(null);
    await keep(draftSource, built, "Changed by hand, in the code.", "edited the code by hand", "edited", libraries);
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
    const copy = appRef.current ? await duplicateApp(appRef.current, new Date().toISOString()) : null;
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
  /** The previewed app runs sealed and the person said, in the trust dialog, to let it run as theirs. */
  const promotePreview = (): void => {
    const app = appRef.current ? getUserApp(appRef.current) : undefined;
    if (!app) return;
    setUserAppTrusted(app.id, true, new Date().toISOString());
    void buildPreview(app.source, app.id).then(({ preview: built }) => built && setPreview(built));
  };

  /** Point mode from the box: open the app, already pointing. */
  const startPointing = (): void => {
    setPreviewOpen(true);
    setPointing(true);
  };
  /** A part was picked: it goes on the box, and on a phone the chat comes back to say what about it. */
  const picked = (p: Pointed): void => {
    setPoint(p);
    setPointing(false);
    if (!wide) setPreviewOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

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
              requests={requests}
            />
            {problem ? <p className="k-form-error k-studio-problem">{problem}</p> : null}
          </div>
        </div>

        <footer className="k-composer">
          <div className="k-composer-box" data-pointed={point ? true : undefined}>
            {point ? (
              <div className="k-composer-point">
                <span className="k-point-chip" title={`About ${point.words}`}>
                  <PointGlyph />
                  <span className="k-point-chip-label">{point.label}</span>
                  <button type="button" className="k-point-chip-x" aria-label={`Stop pointing at ${point.label}`} onClick={() => setPoint(null)}>
                    ✕
                  </button>
                </span>
              </div>
            ) : null}
            <textarea
              ref={inputRef}
              id="k-studio-desc"
              className="k-composer-input"
              aria-label="Describe the app"
              placeholder={point ? "What should be different about it?" : hasApp ? "Ask for a change…" : "Describe the app you want…"}
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
            {canOpen && hasApp ? (
              <button type="button" className="k-composer-point-btn" aria-pressed={pointing} title="Tap a part of the app to talk about it" onClick={startPointing}>
                <PointGlyph /> Point at the app
              </button>
            ) : null}
          </div>
        </footer>
      </div>

      {showPreview ? (
        <PreviewScreen
          preview={preview}
          title={appName}
          version={items.reduce<number | undefined>((v, i) => (i.type === "version" && i.current ? i.seq : v), undefined)}
          unsaved={held !== null}
          onBack={() => {
            setPointing(false);
            setPreviewOpen(false);
          }}
          onSource={() => setTools("source")}
          pointing={pointing}
          onPoint={() => setPointing(true)}
          onPointCancel={() => setPointing(false)}
          onPicked={picked}
          onPromote={promotePreview}
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
