// Studio — making an app is a conversation (#261).
//
// It opens on the conversation, full screen: what you want, the agent's questions when something is
// not clear, and a card for every version it makes. The app itself is opened from its card, as the
// app it will be — under the Studio's bar on a phone, beside the conversation on a wide one — with
// Close and the way back always on that bar (#489). The code and the version history are behind it, in the menu.
//
// Every version is SAVED as it is made. The old Studio built a draft and waited for a Save button,
// so a closed tab or a reload lost both the app and what had been asked for it; with the
// conversation now kept (studio-chat.ts), an app that was not kept beside it would be the odd one
// out. History is the undo: an older card offers to go back to it. What is NOT saved is a version
// that fails the gates — it does not load, its structure is wrong, or it rewrote the app instead of
// editing it — which is held back on a card of its own, with what can be done about it.
//
// Everything here runs the person's own app trusted (CLAUDE.md rule 3); studio-preview.tsx builds it.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { AppLock, PackagedFile } from "@potyro/store";
import { fmt } from "@potyro/i18n";
import { replayCase, type Case, type ReplayReport, type ReplayTarget } from "@potyro/runtime";
import { ActionMenu, type MenuEntry } from "@potyro/views";
import { hasBuiltInAI } from "@potyro/generator/backends";
import { listCases } from "./app-cases.js";
import { recordDiagnosis } from "./app-diagnoses.js";
import { CaseReport } from "./case-report.js";
import { getUserApp, renameUserApp, saveUserApp, setUserAppTrusted, type UserApp } from "./user-apps.js";
import { restoreVersion } from "./restore-version.js";
import { NEW_MODULE } from "./code-files.js";
import { newLine } from "./app-line.js";
import { loadTrustedModule } from "./trusted-loader.js";
import { confirmAndRemoveApp } from "./remove-app.js";
import { navigateTo } from "./router.js";
import { listVersions, type VersionOrigin } from "./app-history.js";
import { EngineSettings } from "./engine-settings.js";
import { engineLabel, engineLeft, engineReady, isCloud } from "./engines.js";
import { canGenerate } from "./generate-client.js";
import { checkFreeEngine, useEngineConfig } from "./engine-store.js";
import { freeNotNow, useFreeAi } from "./free-ai.js";
import { FreePanel } from "./free-panel.js";
import { leaveForGallery as leaveFor } from "./gallery-link.js";
import { forgetKeptIdea, keepIdea, keptIdea } from "./kept-idea.js";
import { shellDialogs } from "./dialog.js";
import { followChat, syncChat } from "./chat-sync.js";
import { adoptDraft, appendMessage, briefSince, clearChat, earlierConversation, isDraftId, listMessages, newDraftId, threadItems, type ChatItem, type NewMessage } from "./studio-chat.js";
import { shapeOrEmpty, studioEngine, type Outcome } from "./studio-engine.js";
import { buildPreview, PreviewScreen, type Preview } from "./studio-preview.js";
import { PointGlyph } from "./point-mode.js";
import { pointContext, type Pointed } from "./point-target.js";
import { ThreadView } from "./studio-thread-view.js";
import { duplicateApp, keepCode, modulesOf, moduleTextsFor, ownModuleCode, withEditedModules, withOwnModules } from "./app-modules.js";
import type { ModuleSource } from "./package-modules.js";
import { describeLibrary } from "./package-libraries.js";
import { keepLibraryFiles, librariesToFetch, prepareStudioLibraries, type StudioLibraries } from "./studio-libraries.js";
import { StudioTools, type ToolsTab } from "./studio-tools.js";
import { ownName, shownName } from "./app-words.js";
import { languagePrefs } from "./locale.js";
import { platformAsk, useStudioRequests } from "./studio-requests.js";
import { useVoice, VoiceButton, VoiceStrip } from "./voice-input.js";
import { withHeard } from "./studio-voice.js";
import { remixLine } from "./credit-words.js";
import { remixSuggestions } from "./remix-suggestions.js";
import { I } from "./icons.js";
import { cor, HORAS, varsBoth } from "@potyro/design";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { ShareSheet } from "./share-sheet.js";
import { getEntry, updateEntry } from "./launcher-store.js";
import { hueColour } from "./tile-identity.js";
import type { Appearance } from "./app-theme.js";
import { tracoOf } from "./app-colour.js";
import type { AppSeed } from "./app-seed.js";
import { fixedLanding, keptAnyway, seedToSave, type Held, type OwnEdit } from "./studio-held.js";

/** The eleven hours an app may wear (DESIGN.md §10); 12 o'clock is Potyro's own and stays empty. */
const HOURS = HORAS.filter((h) => h.hora !== 12);
/** The platform wears rosa only (DESIGN.md §10): opened from inside an app, the Studio takes its own colour back. */
const ROSA = varsBoth(cor("rosa"));
const HOUR_NAMES: Record<string, MessageDescriptor> = {
  vermelho: msg({ message: "Red", comment: "An hour of the colour clock" }),
  laranja: msg({ message: "Orange", comment: "An hour of the colour clock" }),
  amarelo: msg({ message: "Yellow", comment: "An hour of the colour clock" }),
  lima: msg({ message: "Lime", comment: "An hour of the colour clock" }),
  verde: msg({ message: "Green", comment: "An hour of the colour clock" }),
  menta: msg({ message: "Mint", comment: "An hour of the colour clock" }),
  ciano: msg({ message: "Cyan", comment: "An hour of the colour clock" }),
  azul: msg({ message: "Blue", comment: "An hour of the colour clock" }),
  anil: msg({ message: "Indigo", comment: "An hour of the colour clock" }),
  roxo: msg({ message: "Purple", comment: "An hour of the colour clock" }),
  magenta: msg({ message: "Magenta", comment: "An hour of the colour clock" }),
};

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

/**
 * The Studio's bar, measured onto the Studio as `--k-studio-bar-h`: on a phone the opened app stands
 * under it (#489), so its Close and its tabs stay where they were — the bar's height follows the
 * text size and the phone's status bar, so it is read, not assumed.
 */
function useBarHeight(root: RefObject<HTMLElement>, bar: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const el = bar.current;
    const host = root.current;
    if (!el || !host) return;
    const put = (): void => host.style.setProperty("--k-studio-bar-h", `${el.getBoundingClientRect().height}px`);
    put();
    if (typeof ResizeObserver !== "function") return;
    const watch = new ResizeObserver(put);
    watch.observe(el);
    return () => watch.disconnect();
  }, [root, bar]);
}

/** Focus that is nowhere a person can be: on the page itself, or on a control now inert. */
function focusLost(): boolean {
  const at = document.activeElement;
  return !at || at === document.body || at.closest("[inert]") !== null;
}

/**
 * On a phone the opened app covers the conversation, which turns inert (#489): the card's Open (or
 * the code sheet's Run) that opened it can no longer hold focus. Focus moves to the app's region, so a
 * keyboard or a screen reader is where the app is, not at the top of the page. When the app closes
 * and focus went with it, it comes back to the Conversation tab, or — no tabs — to the Studio's menu.
 */
function usePhoneFocus(
  covering: boolean,
  region: RefObject<HTMLElement>,
  conversationTab: RefObject<HTMLElement>,
  bar: RefObject<HTMLElement>,
): void {
  const was = useRef(covering);
  useEffect(() => {
    if (covering === was.current) return;
    was.current = covering;
    if (!focusLost()) return;
    if (covering) region.current?.focus({ preventScroll: true });
    else (conversationTab.current ?? bar.current?.querySelector<HTMLElement>(".k-studio-more"))?.focus({ preventScroll: true });
  }, [covering, region, conversationTab, bar]);
}

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

/** The modules whose text differs between two sets, made and deleted ones included. */
function changedPaths(a: Record<string, string> | undefined, b: Record<string, string> | undefined): Set<string> {
  const paths = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return new Set([...paths].filter((p) => a?.[p] !== b?.[p]));
}

/** Whether `draft` holds anything `saved` does not: an edit, a new file, a deleted one. */
const modulesDiffer = (draft: Record<string, string>, saved: Record<string, string> | undefined): boolean => changedPaths(draft, saved).size > 0;

export interface StudioProps {
  onClose: () => void;
  /** What to start the box with — a launcher search that found nothing offers to create it (#85). */
  initialDescription?: string;
  /**
   * Make the app from `initialDescription` without another press (#53): the person typed these words
   * on the site a moment ago. Only main.tsx sets it, and only for a visit the browser says came from
   * the site (new-from-url.ts). Once, when the engine is ready; with no way to make an app yet, the
   * words stay in the box under the panel that says what is missing.
   */
  startNow?: boolean;
  /** The saved app to open on: "Studio — change this app" passes the one it was opened from. */
  initialAppId?: string;
  /** An unfinished conversation to pick up (the launcher's drafts). */
  initialDraftId?: string;
  /** A part of the app already pointed at — edit mode's "More changes" on a label (#284). */
  initialPoint?: Pointed;
}

export function Studio({ onClose, initialDescription, initialAppId, initialDraftId, initialPoint, startNow }: StudioProps) {
  const { t } = useLingui();
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
  // Publishing: the share sheet, from here (DESIGN.md §10: the platform's primary is Publish).
  const [publishing, setPublishing] = useState(false);
  // The app's colour, chosen on the clock above its preview: the launcher's tile colour (#83), so
  // it is the same colour everywhere; the preview wears it at once.
  const [hue, setHue] = useState<number | undefined>(undefined);
  // The app's theme on this device — light, dark or the system's — chosen beside the clock (#423).
  const [appearance, setAppearance] = useState<Appearance>("system");
  // Published once (a hosted link made): the bar's Publish becomes Copy link.
  const [published, setPublished] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [held, setHeld] = useState<Held | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  // What was in the box when the person left for the gallery from here (#487), for this app (or a new
  // one): back in the box, unless they came with words of their own. Either way, taken.
  const [description, setDescription] = useState(() => initialDescription ?? keptIdea(opened?.id ?? null) ?? "");
  useEffect(() => {
    if (keptIdea(opened?.id ?? null) !== undefined) forgetKeptIdea();
    // once, as the Studio opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const descriptionRef = useRef(description);
  descriptionRef.current = description;
  // The microphone (docs/29): what was in the box when it started, and then what is heard after it.
  const beforeVoice = useRef("");
  const voice = useVoice(
    (heard) => setDescription(withHeard(beforeVoice.current, heard)),
    () => {
      beforeVoice.current = descriptionRef.current;
    },
  );
  const listening = voice.phase !== "idle";
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
  // The app's own modules in the code (#448): as saved, and as edited in the editor. Read again when
  // the app or its saved source changes (a save, a restore, a change from the conversation).
  const [savedModules, setSavedModules] = useState<Record<string, string> | undefined>(undefined);
  const [draftModules, setDraftModules] = useState<Record<string, string> | undefined>(undefined);
  const savedModulesRef = useRef<Record<string, string> | undefined>(undefined);
  const modulesOfApp = useRef<string | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [caseReport, setCaseReport] = useState<ReplayReport | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [engineCfg, setEngineCfg] = useEngineConfig();
  // What the relay's free route said (#121): read here so the engine's name and readiness follow it.
  const free = useFreeAi();
  const wide = useWide();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  useBarHeight(rootRef, barRef);
  const previewRef = useRef<HTMLElement>(null);
  const conversationTabRef = useRef<HTMLButtonElement>(null);

  const label = engineLabel(engineCfg);
  const ready = engineReady(engineCfg);
  const busy = working !== null;
  // A deployed build asks the relay at start which engine a first visit gets (#121): until it answers,
  // neither the panel nor "needs an API key" shows, since the answer may well be Potyro's free engine.
  const asking = free.health === null && (!canGenerate() || engineCfg.engine === "potyro");
  // No engine can make an app (#455): no free app making to use, and no key of the person's own. Not
  // while the free route is still being asked about, and not for an endpoint, which says what it lacks.
  const noWay = !ready && !busy && !asking && (isCloud(engineCfg.engine) || engineCfg.engine === "potyro");
  // A key already in Model settings, while another engine is chosen: the panel offers it first.
  const ownKey =
    engineCfg.engine !== "openrouter" && engineCfg.openrouterKey.trim()
      ? { label: t({ message: "OpenRouter", comment: "Service name; keep as is" }), use: () => setEngineCfg({ ...engineCfg, engine: "openrouter" }) }
      : undefined;
  const savedName = appId ? getUserApp(appId)?.name : undefined;
  // The name the person reads (#302): their own for it, or the source's in their language.
  const appName = preview ? shownName(savedName, preview.composed.runtime.core.app.definition, languagePrefs()) : (savedName ?? t`Your app`);
  const hasApp = appId !== null;
  // A remix (docs/24 §6): greeted with what it remixed and changes drawn from the app, until asked for one.
  const remixedFrom = appId ? getUserApp(appId)?.remixOf : undefined;
  const remix = remixedFrom ? { credit: remixLine(remixedFrom), suggestions: preview ? remixSuggestions(preview.composed.runtime.definition) : [] } : null;

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
      const reason = e instanceof Error ? e.message : String(e);
      setProblem(t`This conversation could not be saved: ${reason}`);
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

  // Arriving: whether the relay's free route serves, and so which engine a first visit starts on.
  useEffect(() => {
    void checkFreeEngine();
  }, []);

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

  useEffect(() => {
    if (!appId) {
      savedModulesRef.current = undefined;
      setSavedModules(undefined);
      setDraftModules(undefined);
      return;
    }
    let live = true;
    void moduleTextsFor(appId).then((m) => {
      if (!live) return;
      // A module edited and not saved yet stays as it is in the editor — a restore or a change from the
      // conversation must not throw away what someone typed. It then shows as changed against the new one.
      // Another app's draft never carries over.
      const sameApp = modulesOfApp.current === appId;
      const saved = savedModulesRef.current;
      setDraftModules((draft) => (sameApp && draft && modulesDiffer(draft, saved) ? draft : m));
      modulesOfApp.current = appId;
      savedModulesRef.current = m;
      setSavedModules(m);
    });
    return () => {
      live = false;
    };
  }, [appId, source]);
  // Edited, made or deleted since the last save: each is a change Save keeps.
  const changedModules = changedPaths(draftModules, savedModules);
  // Something here that lives only in this page: a version made and not kept (it failed a gate), or
  // code edited in the Studio's editor and not saved. Leaving the page loses it.
  const unkept = held !== null || changedModules.size > 0 || draftSource !== (source ?? STARTER);

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
    /** Modules edited by hand (#448): their files go on this device first, and their lock with the version. */
    own?: OwnEdit,
    /** A new app's sample records (#486): its demo records. A changed app keeps the ones it has, as they are. */
    made?: AppSeed,
  ): Promise<void> => {
    const existing = appRef.current ? getUserApp(appRef.current) : undefined;
    // Saved in the app's OWN language: a translated app keeps one stored name, and each device shows
    // the source's name in its own language around it (#302).
    const defined = built ? ownName(built.composed.runtime.core.app.definition) : undefined;
    const name = existing ? await nameAfter(existing, defined) : defined || note.split("\n")[0]!.slice(0, 40) || t`Untitled app`;
    // A library's bytes are in the app's folder before its record names them, so no open finds one missing.
    if (existing && libraries?.files.length) await keepLibraryFiles(existing, libraries.files);
    if (existing && own) await keepCode(existing.id, own.code.files);
    // An app with no libraries has no `libraries`: an edited module still changes its lock.
    const lock = libraries?.lock ?? (existing && own ? withOwnModules(existing.lock, own.code.lock) : undefined);
    const record = await saveUserApp(
      // A new app is an app of its own (docs/24 §11): links to it open its copies, whatever it declares as its id.
      {
        id: existing?.id,
        name,
        source: next,
        lock,
        ...(existing && own ? { modules: own.texts } : {}),
        note: note || undefined,
        rationale: summary || undefined,
        origin,
        ...(existing ? {} : { line: newLine() }),
        // Stored as it came: each use fits it to the version at hand (app-seed.ts).
        ...seedToSave(!existing, made),
      },
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
    if (own) {
      savedModulesRef.current = own.texts;
      setSavedModules(own.texts);
    }
    setHeld(null);
    await say({ kind: "version", text: summary || (existing ? t`Changed.` : t`Made “${name}”.`), seq, name, ...extra });
    if (wide) setPreviewOpen(true);
  };

  /**
   * The libraries a version imports (#266), the way Add an app does it: what will be fetched is said
   * first — "fetches chart.js 4.4.1 from esm.sh" — and fetched once, now, only if the person agrees.
   * Null for an app with none; a sentence when the version cannot be kept as it is.
   */
  const librariesFor = async (src: string, edited?: ModuleSource): Promise<StudioLibraries | null | string> => {
    const have = edited ?? (await modulesOf(appRef.current ?? undefined));
    const { lines, issues } = await librariesToFetch(src, have);
    if (issues.length) {
      const issue = issues[0]!;
      return t`Not saved: ${issue}`;
    }
    if (lines.length) {
      const what = lines.map((l) => describeLibrary(l)).join("\n");
      const go = await shellDialogs.confirm(plural(lines.length, { one: "Fetch the library this version uses?", other: "Fetch the libraries this version uses?" }), {
        detail: t`${what}\n\nOnce, now, and kept with the app: after that it works without the internet.`,
        ok: t({ message: "Fetch", comment: "Button: download the libraries a version uses" }),
      });
      if (!go) {
        const names = fmt.list(lines.map((l) => l.label));
        return plural(lines.length, { one: `Not saved: it uses ${names}, which was not fetched.`, other: `Not saved: it uses ${names}, which were not fetched.` });
      }
    }
    try {
      const libraries = await prepareStudioLibraries(src, have);
      const fetched = libraries?.fetched.map((l) => describeLibrary(l, { done: true })) ?? [];
      // The lines are describeLibrary's, in the person's language; the first letter goes up in any script.
      if (fetched.length) await say({ kind: "event", text: `${fetched.join("; ").replace(/^\p{Ll}/u, (c) => c.toUpperCase())}.` });
      return libraries;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return t`Not saved: ${reason}`;
    }
  };

  /** A source arrived: check it, repair it once if its structure is wrong, then keep it or hold it. */
  const land = async (
    next: string,
    summary: string,
    note: string,
    loss: string | null,
    extra: Pick<NewMessage, "platform"> = {},
    /** The app's own modules, when the change edited any (#448): checked and kept with it. */
    modules?: Record<string, string>,
    /** A new app's sample records (#486). */
    made?: AppSeed,
  ): Promise<void> => {
    setWorking(t`Checking it`);
    let src = next;
    let said = summary;
    let lost = loss;
    let own: OwnEdit | undefined = modules ? { texts: modules, code: await ownModuleCode(modules) } : undefined;
    let edited = own ? withEditedModules(await modulesOf(appRef.current ?? undefined), own.code) : undefined;
    const first = await librariesFor(src, edited);
    if (typeof first === "string") return say({ kind: "failure", text: first });
    let libraries = first;
    let { preview: built, issues } = await buildPreview(src, appRef.current, libraries?.modules ?? edited);
    if (issues.length && ready) {
      try {
        const fixed = await (await engine()).repair(src, issues, own?.texts);
        if (fixed.modules) {
          own = { texts: fixed.modules, code: await ownModuleCode(fixed.modules) };
          edited = withEditedModules(await modulesOf(appRef.current ?? undefined), own.code);
        }
        src = fixed.source;
        said = `${said} ${fixed.summary}`.trim();
        lost = lost ?? fixed.loss;
        const again = await librariesFor(src, edited);
        if (typeof again === "string") return say({ kind: "failure", text: again });
        libraries = again;
        ({ preview: built, issues } = await buildPreview(src, appRef.current, libraries?.modules ?? edited));
      } catch {
        // The problems stand, and are said below.
      }
    }
    if (issues.length || lost) {
      setHeld({ source: src, summary: said, note, issues, loss: lost, libraries, ...(own ? { own } : {}), ...(made ? { made } : {}) });
      setPreview(built ?? preview);
      const problems = issues.join("\n- ");
      await say({
        kind: "failure",
        text: lost
          ? t`This change rewrote your app rather than editing it — it ${lost}. Nothing was saved; try a smaller, more specific change.`
          : t`What came back has problems, so it was not saved:\n- ${problems}`,
        ...extra,
      });
      return;
    }
    await keep(src, built, said, note, undefined, libraries, extra, own, made);
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
    await land(
      outcome.source,
      outcome.summary,
      note,
      outcome.kind === "loss" ? outcome.loss : null,
      outcome.kind === "source" ? platformAsk(outcome.platformRequest) : {},
      outcome.modules,
      outcome.kind === "source" ? outcome.seed : undefined,
    );
  };

  /** One turn: what was asked joins the conversation, the box empties, and the answer lands under it. */
  const send = async (text = description): Promise<void> => {
    const asked = text.trim();
    if (!asked || busy || !ready) return;
    voice.stop();
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

  // The words came from the site's own prompt box (#53): make the app from them, once, as soon as
  // there is a way to. `send` runs with the words given, so the box's own state is not waited for.
  const startedFromSite = useRef(false);
  useEffect(() => {
    if (!startNow || startedFromSite.current || !ready || busy || !initialDescription?.trim()) return;
    startedFromSite.current = true;
    void send(initialDescription);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when ready; `send` is new on every render
  }, [startNow, ready, busy]);

  const fixHeld = async (): Promise<void> => {
    if (!held || busy) return;
    setWorking("");
    try {
      const fixed = await (await engine()).repair(held.source, held.issues, held.own?.texts);
      const l = fixedLanding(held, fixed);
      await land(l.source, l.summary, l.note, l.loss, {}, l.modules, l.made);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await say({ kind: "failure", text: t`Could not fix it: ${reason}` });
    } finally {
      setWorking(null);
    }
  };

  /**
   * The key panel's gallery link (#487): the gallery opens in this tab, so the Studio goes with the
   * page. The box's words are kept for the way back (kept-idea.ts); a version not kept or code not
   * saved cannot be, so the person is asked first — never left to find it gone.
   */
  const leaveForGallery = (): true | Promise<boolean> =>
    leaveFor({
      unkept,
      keep: () => keepIdea(descriptionRef.current, appRef.current),
      ask: () =>
        shellDialogs.confirm(t({ message: "Leave for the gallery?", comment: "Asked before the Studio's page goes to the gallery while a change in it is not kept" }), {
          detail: t`The change you have not kept here is lost.`,
          ok: t({ message: "Leave", comment: "Button: go to the gallery, losing the change not kept" }),
          cancel: t({ message: "Stay", comment: "Button: stay in the Studio, with the change" }),
        }),
    });

  const keepHeld = async (): Promise<void> => {
    if (!held) return;
    const h = held;
    const loss = h.loss;
    const go = await shellDialogs.confirm(
      loss ? t`Keep it anyway? This version ${loss}.` : t`Keep it anyway? It has problems, so parts of it may not work.`,
      { detail: t`You can go back to the version before from History.`, ok: t`Keep it` },
    );
    if (!go) return;
    const kept = t`Kept with problems.`;
    const k = keptAnyway(h, kept);
    await keep(k.source, preview, k.summary, k.note, undefined, k.libraries, {}, k.own, k.made);
  };

  /** An older card: put that version back, as a new version — nothing after it is lost. */
  const goBack = async (seq: number): Promise<void> => {
    const id = appRef.current;
    if (!id || busy) return;
    const version = (await listVersions(id)).find((v) => v.seq === seq);
    const app = getUserApp(id);
    if (!version || !app) return;
    if (!(await shellDialogs.confirm(t`Go back to version ${seq}?`, { detail: t`The versions after it stay in History.`, ok: t`Go back` }))) return;
    // The note is what History and the conversation show for this version; nothing parses it.
    const note = `went back to version ${seq}`; // stored in English; shownNote (version-notes.ts) translates it where it is read
    await restoreVersion(app, version, note, new Date().toISOString());
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

  /**
   * The modules edited by hand (#448), as files and lock entries, with what the app has otherwise.
   * Null when no module was changed: then everything goes as it did before modules could be edited.
   */
  const editedModules = async (): Promise<{ texts: Record<string, string>; code: { lock: AppLock; files: PackagedFile[] }; have: ModuleSource } | null> => {
    if (!draftModules || !changedModules.size) return null;
    const code = await ownModuleCode(draftModules);
    return { texts: draftModules, code, have: withEditedModules(await modulesOf(appRef.current ?? undefined), code) };
  };

  /** The libraries the hand-written code imports, fetched for Run and reused by Save of the same code. */
  const draftLibraries = useRef<{ key: string; libraries: StudioLibraries | null } | null>(null);
  const librariesForDraft = async (edited: ModuleSource | undefined): Promise<StudioLibraries | null | string> => {
    const key = JSON.stringify([draftSource, edited ? draftModules : null]);
    if (draftLibraries.current?.key === key) return draftLibraries.current.libraries;
    const libraries = await librariesFor(draftSource, edited);
    if (typeof libraries !== "string") draftLibraries.current = { key, libraries };
    return libraries;
  };

  const runDraft = async (): Promise<void> => {
    setToolsBusy(true);
    const own = await editedModules();
    const libraries = await librariesForDraft(own?.have);
    if (typeof libraries === "string") {
      setToolsBusy(false);
      return setToolsError(libraries);
    }
    const { preview: built, issues } = await buildPreview(draftSource, appRef.current, libraries?.modules ?? own?.have);
    setToolsBusy(false);
    if (built) setPreview(built);
    const problems = issues.join("\n- ");
    setToolsError(issues.length ? t`Invalid app structure:\n- ${problems}` : null);
    if (!issues.length && built) {
      setTools(null);
      setPreviewOpen(true);
    }
  };

  const saveDraft = async (): Promise<void> => {
    setToolsBusy(true);
    const own = await editedModules();
    const libraries = await librariesForDraft(own?.have);
    if (typeof libraries === "string") {
      setToolsBusy(false);
      return setToolsError(libraries);
    }
    const { preview: built, issues } = await buildPreview(draftSource, appRef.current, libraries?.modules ?? own?.have);
    setToolsBusy(false);
    if (issues.length) {
      const problems = issues.join("\n- ");
      setToolsError(t`Invalid app structure:\n- ${problems}`);
      // Confirm rather than block: an author may still want to park work in progress.
      const listed = issues.join("\n");
      if (!(await shellDialogs.confirm(t`This app has structure problems:\n\n${listed}\n\nSave anyway?`))) return;
    }
    setToolsError(null);
    await keep(
      draftSource,
      built,
      t`Changed by hand, in the code.`,
      t({ message: "edited the code by hand", comment: "A version's note in History, lower case" }),
      "edited",
      libraries,
      {},
      own ?? undefined,
    );
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
    if (!(await shellDialogs.confirm(t`Delete this conversation?`, { detail: t`Nothing was made from it yet, so there is no app to keep.`, ok: t`Delete`, destructive: true }))) return;
    await clearChat(chatRef.current);
    startOver();
  };

  // --- The app itself: rename, copy, delete — here, where you are working on it ------------------

  const [, renamed] = useState(0);
  const rename = async (): Promise<void> => {
    const app = appRef.current ? getUserApp(appRef.current) : undefined;
    if (!app) return;
    const next = await shellDialogs.prompt(t`Rename app`, { default: app.name });
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
    { key: "code", label: hasApp ? t`See the code` : t`Write the code yourself`, icon: I.code, onSelect: () => setTools("source") },
    {
      key: "history",
      label: t`History`,
      icon: I.history,
      hint: cases.length ? plural(cases.length, { one: "# reported", other: "# reported" }) : undefined,
      onSelect: () => setTools("history"),
    },
    ...(hasApp ? [{ key: "files", label: t`Files it comes with`, icon: I.files, onSelect: () => setTools("files") } as MenuEntry] : []),
    { key: "model", label: t`Model settings`, icon: I.settings, hint: label, onSelect: () => setSettingsOpen(true) },
    ...(hasApp
      ? ([
          "separator",
          { key: "rename", label: t`Rename`, icon: I.edit, onSelect: () => void rename() },
          ...(published ? [{ key: "publish", label: t`Publish`, icon: I.share, onSelect: () => setPublishing(true) } as MenuEntry] : []),
          { key: "duplicate", label: t`Duplicate`, icon: I.duplicate, hint: t`the app, not its data`, onSelect: () => void duplicate(), disabled: busy },
        ] as MenuEntry[])
      : []),
    "separator",
    { key: "new", label: t`Start a new app`, icon: I.plus, onSelect: startOver, disabled: busy },
    ...(hasApp ? [{ key: "delete", label: t`Delete ${appName}`, danger: true, onSelect: () => void remove() } as const] : []),
    ...(!hasApp && items.length ? [{ key: "delete", label: t`Delete this conversation`, danger: true, onSelect: () => void deleteDraft() } as const] : []),
  ];

  const canOpen = preview !== null && (hasApp || held !== null);
  useEffect(() => {
    const entry = appId ? getEntry(`user:${appId}`) : undefined;
    setHue(entry?.hue);
    setAppearance(entry?.appearance ?? "system");
    setPublished(entry?.published?.link);
  }, [appId, publishing]);
  const pickHue = (h: number | undefined): void => {
    setHue(h);
    if (appId) updateEntry(`user:${appId}`, { hue: h });
  };
  const pickAppearance = (a: Appearance): void => {
    setAppearance(a);
    if (appId) updateEntry(`user:${appId}`, { appearance: a });
  };
  const copyLink = async (): Promise<void> => {
    if (!published) return;
    try {
      await navigator.clipboard.writeText(published);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard here: the sheet has the link and every other way to hand it on.
      setPublishing(true);
    }
  };
  const showPreview = previewOpen && preview !== null;
  /** Leaving the app ends pointing at it, by whichever way back (the tab, or the preview's own). */
  const closePreview = (): void => {
    setPointing(false);
    setPreviewOpen(false);
  };
  usePhoneFocus(showPreview && !wide, previewRef, conversationTabRef, barRef);
  // On a phone the app covers the conversation and the box: out of reach, so out of the reading and
  // Tab order too (#489), until the Conversation tab brings them back. The bar above stays live.
  const covered: Record<string, string> = showPreview && !wide ? { inert: "" } : {};
  const tabs =
    canOpen && !wide ? (
      <div className="k-studio-tabs" role="tablist" aria-label={t`Studio`}>
        <button ref={conversationTabRef} type="button" role="tab" className="k-studio-tab" aria-selected={!showPreview} onClick={closePreview}>
          <Trans comment="Studio tab on a phone: the conversation">Conversation</Trans>
        </button>
        <button type="button" role="tab" className="k-studio-tab" aria-selected={showPreview} onClick={() => setPreviewOpen(true)}>
          <Trans comment="Studio tab on a phone: the app being made">App</Trans>
        </button>
      </div>
    ) : null;
  const adjust =
    wide && hasApp ? (
      <>
        <button type="button" className="k-preview-adjust-name" title={t`Rename`} onClick={() => void rename()}>
          {appName} {I.edit}
        </button>
        <div className="k-clock" role="radiogroup" aria-label={t({ message: "Colour", comment: "The app's colour, chosen on the clock" })}>
          <button type="button" role="radio" className="k-clock-own" aria-checked={hue === undefined} aria-label={t`The app's own colour`} onClick={() => pickHue(undefined)} />
          {HOURS.map((h) => (
            <button
              key={h.nome}
              type="button"
              role="radio"
              className="k-clock-dot"
              aria-checked={hue === h.hue}
              aria-label={`${t(HOUR_NAMES[h.nome]!)}, ${h.hora}h`}
              style={{ ["--hora" as string]: h.hora, background: tracoOf(h.hue) }}
              onClick={() => pickHue(h.hue)}
            />
          ))}
        </div>
        <div className="k-appearance" role="radiogroup" aria-label={t`Appearance`}>
          {(["light", "dark", "system"] as const).map((a) => (
            <button key={a} type="button" role="radio" className="k-appearance-choice" aria-checked={appearance === a} data-appearance={a} onClick={() => pickAppearance(a)}>
              {a === "light" ? t`Light` : a === "dark" ? t`Dark` : t`System`}
            </button>
          ))}
        </div>
      </>
    ) : null;
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
    <div ref={rootRef} className="k-studio k-traco" role="dialog" aria-label={t`App studio`} data-preview={showPreview || undefined} style={ROSA as CSSProperties}>
      <div className="k-studio-chat">
        <header ref={barRef} className="k-studio-bar">
          <button type="button" className="k-studio-close" aria-label={t`Close studio`} onClick={onClose}>
            {I.close}
          </button>
          <div className="k-studio-title">
            <span className="k-studio-eyebrow">
              <Trans comment="The Studio's name, above the app's: where apps are made by talking">Studio</Trans>
            </span>
            <strong className="k-studio-name">{hasApp ? appName : t`New app`}</strong>
          </div>
          {tabs ??
            (canOpen && !showPreview ? (
              <button type="button" className="k-studio-open" onClick={() => setPreviewOpen(true)}>
                <Trans comment="Studio bar: open the app being made">Preview</Trans>
              </button>
            ) : null)}
          {wide && appId && getUserApp(appId) ? (
            published ? (
              <button type="button" className="k-add k-primary-action k-studio-publish" data-published onClick={() => void copyLink()}>
                {copied ? <Trans comment="Studio: the published link is on the clipboard">Copied</Trans> : <Trans comment="Studio: copy the app's published link">Copy link</Trans>}
              </button>
            ) : (
              <button type="button" className="k-add k-primary-action k-studio-publish" onClick={() => setPublishing(true)}>
                <Trans comment="Studio: share the app by a link">Publish</Trans>
              </button>
            )
          ) : null}
          <ActionMenu label={t`Studio menu`} trigger={I.more} entries={menu} buttonClassName="k-studio-more" />
        </header>

        <div className="k-studio-scroll" ref={scrollRef} {...covered}>
          <div className="k-studio-column">
            <ThreadView
              items={items}
              app={appId ? { id: appId, name: appName } : null}
              working={working}
              held={
                held
                  ? {
                      name: appName,
                      why: held.loss ? t`Rewrote the app instead of editing it.` : plural(held.issues.length, { one: "# problem with it.", other: "# problems with it." }),
                      canFix: held.issues.length > 0 && ready,
                    }
                  : null
              }
              onOpen={() => setPreviewOpen(true)}
              onGoBack={(seq) => void goBack(seq)}
              onFix={() => void fixHeld()}
              onKeep={() => void keepHeld()}
              onLook={() => setPreviewOpen(true)}
              onSuggest={noWay ? undefined : (s) => setDescription(s)}
              existing={hasApp}
              remix={remix}
              requests={requests}
            />
            {problem ? <p className="k-form-error k-studio-problem">{problem}</p> : null}
          </div>
        </div>

        <footer className="k-composer" {...covered}>
          {noWay ? <FreePanel free={free} onAddKey={() => setSettingsOpen(true)} ownKey={ownKey} onLeave={leaveForGallery} request={description} /> : null}
          {noWay ? null : <VoiceStrip voice={voice} />}
          <div className="k-composer-box" hidden={noWay} data-pointed={point ? true : undefined} data-listening={listening || undefined}>
            {point ? (
              <div className="k-composer-point">
                <span className="k-point-chip" title={t({ message: `About ${point.label}`, comment: "The part of the app a message is about" })}>
                  <PointGlyph />
                  <span className="k-point-chip-label">{point.label}</span>
                  <button type="button" className="k-point-chip-x" aria-label={t`Stop pointing at ${point.label}`} onClick={() => setPoint(null)}>
                    {I.close}
                  </button>
                </span>
              </div>
            ) : null}
            <textarea
              ref={inputRef}
              id="k-studio-desc"
              className="k-composer-input"
              aria-label={t`Describe the app`}
              placeholder={
                listening ? t({ message: "Say what you want", comment: "Studio box while the microphone listens" }) : point ? t`What should be different about it?` : hasApp ? t`Ask for a change` : t`Describe the app you want`
              }
              rows={2}
              value={description}
              onChange={(e) => {
                // Typing takes over from the microphone: what was heard stays, to be changed.
                if (voice.phase === "listening") voice.release();
                setDescription(e.target.value);
              }}
              onKeyDown={(e) => {
                // Enter sends on a keyboard; a phone's Enter is a new line, and its send button is right there.
                if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <VoiceButton voice={voice} disabled={busy} />
            <button
              type="button"
              className="k-composer-send"
              aria-label={hasApp ? t`Modify the app` : t`Create the app`}
              title={
                ready
                  ? t`Send to ${label}`
                  : engineCfg.engine === "potyro"
                    ? freeNotNow()
                    : engineCfg.engine === "endpoint"
                    ? t`${label} needs an address and a model — open Model settings`
                    : t`${label} needs an API key — open Model settings`
              }
              disabled={!description.trim() || busy || !ready || voice.phase === "working"}
              onClick={() => void send()}
            >
              {I.send}
            </button>
          </div>
          <div className="k-composer-meta" hidden={noWay}>
            <button type="button" className="k-composer-engine" aria-label={t`Model settings`} title={t`Choose which model writes and edits your app`} onClick={() => setSettingsOpen(true)}>
              {I.settings} {label}
              {engineLeft(engineCfg)}
            </button>
            {!ready && !asking && engineCfg.engine !== "potyro" ? (
              <span className="k-composer-warn">
                {engineCfg.engine === "endpoint" ? <Trans>needs an address and a model</Trans> : <Trans>needs an API key</Trans>}
              </span>
            ) : null}
            {canOpen && hasApp ? (
              <button type="button" className="k-composer-point-btn" aria-pressed={pointing} title={t`Tap a part of the app to talk about it`} onClick={startPointing}>
                <PointGlyph /> <Trans>Point at the app</Trans>
              </button>
            ) : null}
          </div>
        </footer>
      </div>

      {publishing && appId && getUserApp(appId) ? <ShareSheet app={getUserApp(appId)!} onClose={() => setPublishing(false)} /> : null}
      {showPreview ? (
        <PreviewScreen
          preview={preview}
          title={appName}
          underStudioBar={tabs !== null}
          regionRef={previewRef}
          above={adjust}
          appAccent={hue !== undefined ? hueColour(hue) : undefined}
          appearance={appearance}
          version={items.reduce<number | undefined>((v, i) => (i.type === "version" && i.current ? i.seq : v), undefined)}
          unsaved={held !== null}
          onBack={closePreview}
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
          definition={preview?.composed.runtime.definition}
          modules={draftModules}
          onModuleChange={(path, next) => setDraftModules((m) => ({ ...(m ?? {}), [path]: next }))}
          onCreateModule={(path) => setDraftModules((m) => ({ ...(m ?? {}), [path]: NEW_MODULE }))}
          onDeleteModule={(path) =>
            void shellDialogs
              .confirm(t({ message: `Delete ${path}?`, comment: "The Studio's code tree: asked before a file of code is taken out" }), {
                detail: t`It goes when you save the code. Anything that imports it stops working until that import goes too.`,
                ok: t`Delete`,
                destructive: true,
              })
              .then((go) => {
                if (go) setDraftModules((m) => Object.fromEntries(Object.entries(m ?? {}).filter(([p]) => p !== path)));
              })
          }
          changed={changedModules}
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
