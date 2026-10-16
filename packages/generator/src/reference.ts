// The model's reference is the schema, verbatim.
//
// A hand-written summary of what an app can declare drifts from the schema the moment someone adds
// an option and forgets the prompt — and every gap is a refusal that only a prompt edit can fix
// (#130: `MapView.camera` was validated for weeks while the prompt said the map could not be
// positioned). So the reference is GENERATED from `packages/schema/src/types`: the declarations
// with their doc comments, minus the import lines, which mean nothing to a reader without a
// module graph. `scripts/build-reference.ts` writes `reference.generated.ts`; a test regenerates
// and compares, so a schema change without a regeneration fails CI instead of quietly narrowing
// what the model believes is possible.
//
// #341 split it in two. The CORE — defineApp, entities, fields, views, pages and the `ctx` every app
// uses — goes into every system prompt. Each capability an app reaches for only sometimes (the
// camera, AI, the app's folder, sharing, formats…) is listed in `CAPABILITIES`: its declarations
// leave the core and are read on demand, through `lookup` (discovery-tools.ts), through the passages
// put beside a request that names it (`capabilityNotes`, for every engine — including the ones that
// cannot call a tool), and through a one-line index the prompt keeps for each, so the model knows
// it exists and how to fetch it. The core stopped growing with every capability; a test
// (reference.test.ts) proves every `ctx` member is still reachable one way or the other.

/** The type files of the core, in reading order: primitives and words, then fields, then `ctx`, then the app shape. */
export const REFERENCE_FILES = ["core.ts", "words.ts", "fields.ts", "ctx.ts", "app.ts", "runtime.ts"] as const;

/** Type files that are never in the core: read only through `lookup` and the capability passages. */
export const LOOKUP_ONLY_FILES = ["faces.ts", "sockets.ts", "speech.ts"] as const;

const IMPORT_LINE = /^import\s.*$/gm;

/** Join the type sources into one reference text, file by file, imports removed. */
export function buildReference(sources: Readonly<Record<string, string>>): string {
  const parts: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const body = text.replace(IMPORT_LINE, "").replace(/\n{3,}/g, "\n\n").trim();
    parts.push(`// ===== ${file} =====\n${body}`);
  }
  return parts.join("\n\n");
}

// ---- declarations ----

export interface Declaration {
  name: string;
  /** The doc comment (if any) and the declaration itself. */
  text: string;
  /** 0-based line range in the text it was read from, inclusive. */
  from: number;
  to: number;
}

const START = /^export (?:interface|type) (\w+)\b/;

/** Brackets opened minus closed on a line, strings and comments not counted. */
function depthOf(line: string): number {
  let d = 0;
  for (const c of line.replace(/\/\/.*$/, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "")) {
    if (c === "{" || c === "(" || c === "[") d += 1;
    else if (c === "}" || c === ")" || c === "]") d -= 1;
  }
  return d;
}

/** The first line of the doc comment that ends on line `i - 1`, or `i` when there is none. */
function docStart(lines: readonly string[], i: number): number {
  if (i === 0 || !lines[i - 1]!.trimEnd().endsWith("*/")) return i;
  let j = i - 1;
  while (j > 0 && !lines[j]!.trimStart().startsWith("/**")) j -= 1;
  return lines[j]!.trimStart().startsWith("/**") ? j : i;
}

/**
 * Every top-level declaration, line by line: the doc comment right above it (if any), then
 * `export interface X { … }` up to its closing brace at column 0, or `export type X = …` up to the
 * line where its brackets close and it ends with `;`. A regex used to do this and, on a one-line
 * `export type X = A | B;` or a doc comment not followed by a declaration, ran on and swallowed the
 * declarations after it — `lookup("Reminder")` answered "it does not exist" (#262 phase 3).
 */
export function declarations(reference: string): Declaration[] {
  const lines = reference.split("\n");
  const out: Declaration[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = START.exec(lines[i]!);
    if (!m) continue;
    const from = docStart(lines, i);
    let end = i;
    if (/^export interface/.test(lines[i]!)) {
      while (end < lines.length - 1 && !/^\}/.test(lines[end]!) && !(end === i && /\}\s*$/.test(lines[i]!) && depthOf(lines[i]!) === 0)) end += 1;
    } else {
      let depth = 0;
      for (; end < lines.length; end += 1) {
        depth += depthOf(lines[end]!);
        if (depth <= 0 && /;\s*(\/\/.*)?$/.test(lines[end]!)) break;
        if (end > i && START.test(lines[end + 1] ?? "")) break;
      }
    }
    out.push({ name: m[1]!, text: lines.slice(from, end + 1).join("\n"), from, to: end });
    i = end;
  }
  return out;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The line a member of an interface starts on: `name:`, `name?:`, `name(`, `name<`, `readonly name`. */
export const memberLine = (name: string): RegExp => new RegExp(`^\\s+(?:readonly\\s+)?${escapeRe(name)}\\??\\s*[:(<]`);

/** A member's lines inside a declaration's text — its doc comment and the signature up to its `;`. */
function memberRange(lines: readonly string[], name: string): [number, number] | null {
  const re = memberLine(name);
  const at = lines.findIndex((l) => re.test(l));
  if (at < 0) return null;
  let end = at;
  let depth = 0;
  for (; end < lines.length; end += 1) {
    depth += depthOf(lines[end]!);
    if (depth <= 0 && /;\s*(\/\/.*)?$/.test(lines[end]!)) break;
  }
  return [docStart(lines, at), Math.min(end, lines.length - 1)];
}

// ---- capabilities: what leaves the core ----

export interface Capability {
  /** What the model looks up, and what the index names: `ctx.caps.ai`, `Face`. */
  key: string;
  /** The index line: what it is for and the call that does it, in one line. */
  summary: string;
  /** Declarations that leave the core (or were never in it) and are read with this capability. */
  declarations: readonly string[];
  /** Single members cut out of a core declaration — `ctx.ui.share` from `CtxUi`. */
  members?: ReadonlyArray<{ of: string; name: string }>;
  /** Other names lookup answers with this entry, and `ctx` paths it covers (`ctx.ui.menu` under `ctx.ui.form`). */
  also?: readonly string[];
  /**
   * Its members are capabilities of their own (`ctx.caps`): each one needs its own entry, and the
   * reachability test (reference.test.ts) does not let this entry stand in for them.
   */
  container?: true;
  /** What the prompt used to say about using it beyond the declarations; read with them. */
  notes?: string;
  /**
   * When a request needs it: words a person would use, in the languages the Studio speaks. A miss
   * costs one lookup for a model with tools, and leaves the index line for one without; a false hit
   * costs a passage.
   */
  cues: RegExp;
  /** When the app being changed already uses it: the code that does (never its words — labels say anything). */
  uses: RegExp;
}

/**
 * Every capability, view and option whose declarations are read on demand. A new `ctx` member, view
 * or option that should not be in every prompt is added HERE (with its index line and cues) — the
 * reachability tests fail until it is, because what is neither in the core nor in this list is
 * invisible to the model. The core's budget (reference.test.ts) is never raised for a new feature.
 */
export const CAPABILITIES: readonly Capability[] = [
  {
    key: "ctx.caps",
    summary:
      "native capabilities; EVERY member is optional (undefined when not granted), so guard: `if (!ctx.caps.geo) { ctx.ui.toast(\"Location unavailable\"); return; }`, and declare what the app needs: `permissions: { geo: true, camera: true }`",
    declarations: ["Caps", "PermissionManifest"],
    container: true,
    cues: /\bctx\.caps\b|\bpermissions\b|\bsync\b/i,
    uses: /\bctx\.caps\b|\bpermissions\s*:/,
  },
  {
    key: "ctx.caps.camera",
    summary:
      "`capture(opts?)` → Blob (then `await ctx.media.put(blob)` for a media field); `live(opts?)` → live frames for a custom view (a camera toy, a mirror), `faces: true` adds eyes and mouth (see `Face`)",
    declarations: ["CameraCapability", "LiveCameraOptions", "LiveCameraStop", "LiveCameraFailure", "LiveFrameInfo", "LiveCamera"],
    cues: /caps\.camera|\b(camera|cameras|webcam|selfie|mirror|snap|photograph\w*|take (?:a )?(?:photo|picture)|scan\w*|live video|kamer\w*|aparat\w*|câmera|cámara|kamera)\b/i,
    uses: /caps\.camera\b/,
  },
  {
    key: "Face",
    summary: "a face in a live frame: eyes (pupils, how open), mouth, nose, brows, expressions (smile, blink…), head turn — `live({ faces: true })`",
    declarations: ["FacePoint", "FaceEye", "FaceExpressions", "Face", "FaceOptions", "FacesFailure"],
    cues: /\bfaces?\b|\binfo\.faces\b|\b(eyes?|mouth|smil\w*|blink\w*|wink\w*|twarz\w*|oczy|usta|rosto|olhos|boca|gesicht|augen|mund|cara|ojos)\b/i,
    uses: /\bfaces\s*:|\.faces\b/,
  },
  {
    key: "ctx.caps.ai",
    summary:
      "read a photo or text into a typed shape: `await ctx.caps.ai.extract({ image, instructions, schema: { shop: \"text?\", items: [{ name: \"text\", price: \"number\" }] } })`; `ask(question, { image })` → words (`permissions: { ai: true }`)",
    declarations: ["AiLeaf", "AiShape", "AiImage", "AiExtractRequest", "AiCapability"],
    notes: "Send only what the task needs: the call sends exactly what it names, nothing else of the app's.",
    cues: /caps\.ai\b|\b(ai|a\.i\.|artificial intelligence|llm|gpt|ocr|scan\w*|receipts?|invoices?|extract\w*|recogni[sz]\w*|identify|classif\w*|read (?:the |a |my )?(?:photo|picture|image|label|text)|paragon\w*|rachun\w*|recibo\w*|nota fiscal|beleg\w*|quittung\w*|rechnung\w*|factura\w*|ticket de caja)\b/i,
    uses: /caps\.ai\b/,
  },
  {
    key: "ctx.caps.geo",
    summary: "`current()` → { lat, lng }, where the device is (the key is `geo`, NOT `geolocation`)",
    declarations: ["GeoCapability"],
    cues: /caps\.geo\b|\b(where i am|my location|current location|near me|nearby|gps|lokalizac\w*|localiza\w*|standort)\b/i,
    uses: /caps\.geo\b/,
  },
  {
    key: "ctx.caps.notifications",
    summary: "`schedule({ id, at, title, body? })` / `cancel(id)`: a notification at a time (a declarative entity `reminders` entry is usually enough)",
    declarations: ["NotificationCapability"],
    cues: /caps\.notifications\b|\b(notif\w*|push|alarm\w*|powiadom\w*|notifica\w*|benachrichtig\w*)\b/i,
    uses: /caps\.notifications\b/,
  },
  {
    key: "ctx.caps.filesystem",
    summary: "`pick()` → Blob / `save(name, blob)`: a file from or to outside the app (`ctx.files` is the app's own folder)",
    declarations: ["FileCapability"],
    cues: /caps\.filesystem\b|\b(save to (?:disk|device)|download\w*)\b/i,
    uses: /caps\.filesystem\b/,
  },
  {
    key: "ctx.caps.haptics",
    summary: "`vibrate(pattern?)`: a buzz on a phone",
    declarations: ["HapticsCapability"],
    cues: /caps\.haptics\b|\b(vibrat\w*|haptic\w*|buzz\w*|wibr\w*|vibra\w*)\b/i,
    uses: /caps\.haptics\b/,
  },
  {
    key: "ctx.caps.network",
    summary: "`fetch(url, init?)`: the internet, only to the hosts in `permissions: { network: { hosts } }`",
    declarations: ["NetworkCapability", "NetworkPermission"],
    cues: /caps\.network\b|\b(fetch|api|http|https|internet|online|weather|exchange rate|from the web|download\w*)\b/i,
    uses: /caps\.network\b/,
  },
  {
    key: "ctx.caps.network.socket",
    summary:
      "live data both ways (prices, a home hub, chat): `const s = await ctx.caps.network.socket(\"wss://…\")`, `s.onMessage(d => …)`, `s.send(…)`, `s.onClose(c => …)`; `ctx.caps.network.room(id?)` joins Potyro's rooms for multiplayer (`permissions: { network: { hosts: [\"…\"], rooms: true } }`)",
    declarations: ["SocketFailure", "SocketSendFailure", "SocketCloseWhy", "SocketClose", "SocketData", "KeepWhileHidden", "SocketOptions", "Socket", "RoomMember", "RoomPresence", "RoomOptions", "Room"],
    notes: [
      "Open a connection from an action, a page action or a custom view, and keep it in a module-level variable: it outlives the call.",
      "Write what arrives as records (`ctx.create`/`ctx.patch` in `onMessage`). Potyro closes every connection when the person",
      "leaves the app or Potyro is hidden 30 s (`keepWhileHidden: \"5m\"` for a chat), and never reconnects by itself; `c.why` says",
      "why. Reconnect after a growing pause (1 s, 2 s… 30 s), not when `c.why` is \"app\", \"left\", \"hidden\" or \"off\". A room's id",
      "is its invitation: share it with `ctx.ui.share`. Word `e.code` (SocketFailure) for the person (\"offline\" → \"You're offline\").",
    ].join("\n"),
    cues: /caps\.network\.(?:socket|room)\b|\b(live|real[- ]?time|websockets?|sockets?|multi-?player|stream\w*|ticker|chat ?rooms?|lobby|home assistant|push updates?|ao vivo|tempo real|na żywo|czas\w* rzeczywist\w*|en vivo|tiempo real|echtzeit|tempo reale|in diretta)\b/i,
    uses: /caps\.network\.(?:socket|room)\b/,
  },
  {
    key: "ctx.caps.speech",
    summary:
      "voice input, live words",
    declarations: ["SpeechEngine", "SpeechFailure", "SpeechOptions", "SpeechSession", "SpeechCapability"],
    notes: [
      "Declare `permissions: { speech: true }`. Start it from a button the person presses (an action or a custom view), keep the",
      "session in a module-level variable, and",
      "do NOT await `result` inside that action: while an action runs the app's other buttons wait, so a Stop button could",
      "never be pressed — use `s.result.then(text => ctx.create(…))`. `text` is everything heard so far: show it as it is.",
      "It listens in the person's language unless `language` says another. A failure's `e.code` is one of SpeechFailure; word",
      "it (\"denied\" → \"Allow the microphone to talk to it\").",
    ].join("\n"),
    cues: /caps\.speech\b|\b(voice|speak\w*|spoken|speech|dicta\w*|talk to it|say it|hands[- ]free|microphone|mic|transcri\w*|głos\w*|mów\w*|dyktu\w*|mikrofon\w*|voz|falar|fala|dita[rd]\w*|hablar|hablad\w*|stimm\w*|sprechen|sprach\w*|diktier\w*|voce|parlar\w*|dettat\w*)\b/i,
    uses: /caps\.speech\b/,
  },
  {
    key: "ctx.media",
    // Also how pages SHOW pictures and look (`cover`, `background`, a big `primaryAction`…): the
    // presentation options, cut out of the core and read here with the media calls.
    summary: "`put(blob)` → MediaRef for a `media` field, `url(ref)` → a URL to show it",
    declarations: ["CtxMedia", "Backdrop"],
    members: [
      { of: "Page", name: "description" },
      { of: "Page", name: "primaryAction" },
      { of: "Page", name: "background" },
      { of: "Theme", name: "background" },
      { of: "DetailView", name: "cover" },
      { of: "DetailView", name: "media" },
      { of: "DetailView", name: "facts" },
      { of: "DetailView", name: "primaryAction" },
      { of: "ListDisplay", name: "lead" },
      { of: "GalleryView", name: "aspect" },
      { of: "ActionDef", name: "icon" },
    ],
    cues: /ctx\.media\b|\b(photo|photos|picture|pictures|image|images|zdjęci\w*|foto\w*|bild\w*|imagen\w*|cover|hero|backgrounds?|wallpaper|full ?screen|look\w*|design\w*|beautiful|pretty|prettier|playful|professional|polish\w*|prominent|big button|call to action|tło|wygląd\w*|fundo|aparência|hintergrund|aussehen|fondo|aspecto|sfondo)\b/i,
    uses: /ctx\.media\b|\b(cover|background|primaryAction|facts|lead|aspect)\s*:/,
  },
  {
    key: "ctx.files",
    summary:
      "the app's own folder: `text`/`json`/`bytes`/`url`/`write`/`list`/`import` (the person picks; no permission). `null` = not on this device yet, never empty; a `file` field stores `{ id, path, name, mime }`; starting data is a shipped JSON, `ctx.files.json(\"plan.json\")`",
    declarations: ["FileOrigin", "FileInfo", "CtxFiles"],
    cues: /ctx\.files\b|type:\s*["']file["']|\b(files?|folder|documents?|pdfs?|csv|json|import\w*|export\w*|attach\w*|upload\w*|plik\w*|arquivo\w*|datei\w*|archivo\w*)\b/i,
    uses: /ctx\.files\b|type:\s*["']file["']/,
  },
  {
    key: "ctx.ui.share",
    summary: "`await ctx.ui.share({ text, url | app })`: share sheet / Copy; `app`: link to a page",
    declarations: ["ShareAppLink", "PageLink"],
    members: [{ of: "CtxUi", name: "share" }],
    notes: [
      "A link to one of the app's pages: the page declares what a link may hand it, `link: { params: [\"code\"] }`, and",
      "`ctx.ui.share({ text, app: { page: \"play\", params: { code } } })` makes it. It opens the friend's own copy of the app",
      "there (or a demo they can keep, which lands there). The page reads `ctx.params.code` (a custom view: `props.param?.code`):",
      "text, at most 200 characters, possibly typed by a stranger. Never act on it by itself — fill a box, and let the person tap.",
    ].join("\n"),
    cues: /\bshare\(|link:\s*\{\s*params|\b(share|sharing|send (?:it |this )?to|whatsapp|copy (?:the |a )?link|invit\w*|deep ?links?|udostępni\w*|zapros\w*|compartilh\w*|convid\w*|teilen|einlad\w*|compartir|invitar\w*)\b/i,
    uses: /\.share\(|link:\s*\{\s*params/,
  },
  {
    key: "ctx.space",
    summary: "the people the app's data is shared with: `ctx.space?.members ?? [ctx.me]` (each `{ id, name, role }`); undefined for a solo app",
    declarations: ["SpaceRole", "Member", "Space"],
    cues: /\b(shared|together|partner|family|household|room ?mates?|flat ?mates?|team|members?|everyone|each of us|who (?:owes|paid|did)|wspóln\w*|rodzin\w*|família|familia|partilh\w*|gemeinsam\w*)\b/i,
    uses: /ctx\.space\b/,
  },
  {
    key: "ctx.views",
    summary: "`ctx.views.map(pageId).flyTo({ center, zoom? })` / `.fit()`: move a map that is on screen, from a page action (\"Centre on me\")",
    declarations: ["MapViewControl", "CtxViews"],
    cues: /ctx\.views\b|\b(fly ?to|centre on|center on|zoom to|pan to|recent(?:re|er))\b/i,
    uses: /ctx\.views\b/,
  },
  {
    key: "ctx.format",
    summary: "`ctx.format.date/number/money/relative/list` in the person's locale, for text the app composes (return a Date or a number where a view formats it)",
    declarations: ["FormatDateOptions", "FormatNumberOptions", "CtxFormat"],
    cues: /ctx\.format\b|\b(format\w*|locale|currency)\b/i,
    uses: /ctx\.format\b/,
  },
  {
    key: "languages",
    summary: "an app's words in several languages: `languages`, `Words` maps, `ctx.t` with plurals, enum `labels`",
    declarations: [],
    notes: [
      "An app's words become maps once it has several languages — `label: { en: \"Quantity\", pl: \"Ilość\" }` —",
      "and `languages: [\"en\", \"pl\"]` lists every language, the app's own first. Every map has the app's own `language`.",
      "Inside functions: `ctx.t({ en: \"Due now\", pl: \"Do podlania\" })`, with `vars` for plurals",
      "(`{n, plural, one {# plant} other {# plants}}`), and `ctx.format` for formats (lookup(\"ctx.format\")).",
      "Records are never translated. An enum's options are stored values and stay as they are; their words",
      "go in `labels: { todo: { en: \"To do\", pl: \"Do zrobienia\" } }`.",
    ].join("\n"),
    cues: /\blanguages\s*:|\bctx\.t\(|\b(translat\w*|languages?|multilingual|bilingual|in (?:english|polish|german|portuguese|spanish|french|italian)|tłumacz\w*|języ\w*|tradu\w*|idioma\w*|sprache\w*|übersetz\w*)\b/i,
    uses: /\blanguages\s*:|\bctx\.t\(/,
  },

  // #370: the rarer views, options and app parts left the core too, by how often apps use them (the
  // counts are in the PR). Each is still declared in full — a lookup, or a passage beside a request
  // that names it, away — and its index line carries the shape a one-shot engine writes from.
  {
    key: "board",
    summary: "records with a stage or status (tasks, applications, \"want to try / tried\") in columns: `{ type: \"board\", entity, column: \"<enum field>\" }`; dragging a card moves it",
    declarations: ["BoardView"],
    cues: /type:\s*["']board["']|\b(boards?|kanban|stages?|status(?:es)?|pipeline|columns?|workflow|to do.{0,12}doing|quadro|etap\w*|tablic\w*|estado|tablero|spalte\w*|fase|colonn\w*)\b/i,
    uses: /type:\s*["']board["']/,
  },
  {
    key: "timeline",
    summary: "records read back by when (a journal, a workout or care log): `{ type: \"timeline\", entity, date: \"<datetime field>\", groupBy: \"week\", color: \"<enum field>\" }`",
    declarations: ["TimelineView"],
    cues: /type:\s*["']timeline["']|\b(timeline|journal|diary|logs?|logbook|history|when did i|last time|dziennik\w*|histori\w*|diário|diario|tagebuch|verlauf|cronolog\w*)\b/i,
    uses: /type:\s*["']timeline["']/,
  },
  {
    key: "stats",
    summary:
      "\"how am I doing\" figures (this week vs last, totals): `{ type: \"stats\", entity, items: [{ label, op: \"sum\", field }] }`, or `value: (rows, ctx) => …` and `compare`; a page's `summary: [...]` takes the same items. Stack it with a `chart` in a page `layout`",
    declarations: ["SummaryOp", "SummaryValue", "StatItem", "StatsView"],
    cues: /type:\s*["']stats["']|\bsummary\s*:|\b(stats|statistics?|totals?|averages?|sum|how (?:much|many|often)|per (?:day|week|month|year)|this (?:week|month)|streaks?|dashboard|overview|figures?|progress|statystyk\w*|suma|średni\w*|estatístic\w*|média|total\w*|statistik\w*|summe|durchschnitt|estadístic\w*|promedio|statistich\w*|media)\b/i,
    uses: /type:\s*["']stats["']|\bsummary\s*:\s*\[/,
  },
  {
    key: "chart",
    summary: "a bar chart folded out of the page's rows: `{ type: \"chart\", entity, series: (rows, ctx) => [{ label: \"Mon\", value: 3 }] }`",
    declarations: ["ChartPoint", "ChartView"],
    cues: /type:\s*["']chart["']|\b(charts?|graphs?|plot|bars?|trends?|over time|by (?:week|month)|wykres\w*|gráfic\w*|grafic\w*|diagramm\w*|grafik\w*)\b/i,
    uses: /type:\s*["']chart["']/,
  },
  {
    key: "steps",
    summary: "walk one record's ordered `list` field step by step, ticking each (a recipe's method, a routine): `{ type: \"steps\", entity, param, list: \"<list field>\", onFinish?: \"<action>\" }`",
    declarations: ["StepsView"],
    cues: /type:\s*["']steps["']|\b(steps?|step[- ]by[- ]step|cook[- ]?along|walk (?:me )?through|routines?|method|instructions|krok\w*|passo\w*|schritt\w*|pasos?|passi|passaggi)\b/i,
    uses: /type:\s*["']steps["']/,
  },
  {
    key: "aggregate",
    summary:
      "a screen folded from ALL the rows rather than one per record (who owes whom, what is left to buy): `{ type: \"aggregate\", entity, rows: (rows, ctx) => [{ label, value?, detail?, tone?: \"positive\", group? }] }`",
    declarations: ["AggregateRow", "AggregateView"],
    cues: /type:\s*["']aggregate["']|\b(owes?|owed|owing|balances?|settle\w*|split\w*|debts?|who pays|left to (?:buy|pay|do)|remaining|leftover|per person|dług\w*|rozlicz\w*|dívida\w*|acert\w*|schulde\w*|abrechn\w*|deuda\w*|saldo\w*|debit\w*)\b/i,
    uses: /type:\s*["']aggregate["']/,
  },
  {
    key: "checklist",
    summary: "a checklist's rarer options: `reorder` (a number field; rows drag), `groupOrder` (relation groups renamed, reordered, added in place), `editText` (rename a row in place), `donePlacement: \"sink\"`",
    declarations: [],
    members: [
      { of: "ChecklistView", name: "donePlacement" },
      { of: "ChecklistView", name: "editText" },
      { of: "ChecklistView", name: "reorder" },
      { of: "ChecklistView", name: "groupOrder" },
    ],
    cues: /\b(donePlacement|editText|reorder|groupOrder)\b|\b(drag\w*|re-?order\w*|rearrang\w*|sort by hand|move (?:it|them|items?|rows?) (?:up|down)|rename (?:it|items?|rows?|groups?)|to the bottom|przeciąg\w*|arrast\w*|zieh\w*|verschieb\w*|arrastr\w*|trascin\w*)\b/i,
    uses: /\b(donePlacement|editText|reorder|groupOrder)\s*:/,
  },
  {
    key: "mount",
    summary: "a custom view in anything but React (p5, a canvas, Svelte): `mount: (el, props) => teardown`, data through `props.runtime.watchQuery/watchRecord`",
    declarations: ["CustomViewMount"],
    members: [
      { of: "CustomView", name: "mount" },
      { of: "Runtime", name: "watchQuery" },
      { of: "Runtime", name: "watchRecord" },
    ],
    also: ["watchQuery", "watchRecord"],
    cues: /\bmount\s*:|watch(?:Query|Record)\b|\b(p5(?:\.js)?|three\.js|webgl|svelte|vue|vanilla js|plain js|canvas)\b/i,
    uses: /\bmount\s*:|watch(?:Query|Record)\b/,
  },
  {
    key: "ctx.scope",
    summary:
      "the one record everything else belongs to (the current trip, project, season, child): `scope: { entity: \"trip\", required: true }` gives a header picker; functions read it synchronously as `ctx.scope.trip` and each page narrows itself: `filter: (e, ctx) => e.trip?.id === ctx.scope.trip?.id`",
    declarations: ["ScopeDef"],
    members: [{ of: "Ctx", name: "scope" }],
    cues: /\bscope\s*:|ctx\.scope\b|\b(trips?|travels?|holidays?|vacations?|projects?|seasons?|semesters?|each (?:child|kid|class|event)|current (?:trip|project|season)|podróż\w*|wyjazd\w*|projekt\w*|sezon\w*|viage\w*|projeto\w*|temporada\w*|reise\w*|saison|viaje\w*|proyecto\w*|viaggi\w*|progett\w*|stagion\w*)\b/i,
    uses: /\bscope\s*:\s*\{|ctx\.scope\b/,
  },
  {
    key: "sources",
    summary: "outside data the app's Ask may read (a places API, a search engine): `sources: { places: { endpoint, description, docs?, auth? } }` — never a key in the app",
    declarations: ["SourceDef"],
    members: [{ of: "AppDefinition", name: "sources" }],
    cues: /\bsources\s*:|\b(api keys?|search engine|places api|data sources?|look (?:it )?up online|from the web)\b/i,
    uses: /\bsources\s*:\s*\{/,
  },
  {
    key: "ctx.ui.form",
    summary:
      "`await ctx.ui.form({ title, fields: { kg: { type: \"number\", unit: \"kg\" } }, initial, submit })` when an action needs several values (null = cancelled); `sheet`/`menu({ title, items: [{ id, label, detail, destructive }] })` for a short choice; `progress(label)` → `{ update(0..1), done() }`",
    declarations: ["UiItem", "UiProgress"],
    members: [
      { of: "CtxUi", name: "sheet" },
      { of: "CtxUi", name: "menu" },
      { of: "CtxUi", name: "form" },
      { of: "CtxUi", name: "progress" },
    ],
    also: ["ctx.ui.sheet", "ctx.ui.menu", "ctx.ui.progress"],
    cues: /\.ui\.(?:form|sheet|menu|progress)\b|\b(choose|choice|pick (?:one|from)|menu|options?|a form|several values|ask (?:me|for)|enter (?:the )?(?:weight|amount|details)|progress bar|long (?:action|import)|wybierz|wybór|escolh\w*|auswahl|wähl\w*|elegir|elig\w*|scegli\w*)\b/i,
    uses: /\.ui\.(?:form|sheet|menu|progress)\(/,
  },
];

const CAPABILITY_BY_DECL = new Map(CAPABILITIES.flatMap((c) => c.declarations.map((d) => [d, c] as const)));

/** The capability a lookup query names: its key, with or without `ctx.`, any case. */
export function capabilityNamed(query: string): Capability | undefined {
  const q = query.trim().toLowerCase().replace(/^ctx\./, "");
  const bare = (name: string): string => name.toLowerCase().replace(/^ctx\./, "");
  return CAPABILITIES.find((c) => bare(c.key) === q || (c.also ?? []).some((a) => bare(a) === q));
}

export interface SplitReference {
  /** What every system prompt carries. */
  core: string;
  /** Each capability's declarations, by key, in `CAPABILITIES` order. */
  capabilities: Record<string, string>;
}

/**
 * Split the full reference (core files + lookup-only files) into the core and the capability
 * sections. Throws when `CAPABILITIES` names a declaration or a member the types do not have — a
 * rename in the schema must not leave a capability that silently says nothing.
 */
export function splitReference(coreSources: Readonly<Record<string, string>>, lookupOnlySources: Readonly<Record<string, string>>): SplitReference {
  const full = buildReference(coreSources);
  const lines = full.split("\n");
  const drop = new Set<number>();
  const found = new Map<string, string>();
  for (const d of declarations(full)) {
    if (!CAPABILITY_BY_DECL.has(d.name)) continue;
    found.set(d.name, d.text);
    for (let i = d.from; i <= d.to; i += 1) drop.add(i);
    if ((lines[d.to + 1] ?? "x").trim() === "") drop.add(d.to + 1);
  }
  for (const d of declarations(buildReference(lookupOnlySources))) found.set(d.name, d.text);

  // One fragment per declaration a capability cuts members out of, the members in their own order —
  // `mount` cuts from `CustomView` and from `Runtime`, `ctx.ui.form` four members of `CtxUi`.
  const fragments = new Map<string, string[]>();
  const decls = declarations(full);
  for (const c of CAPABILITIES) {
    const byHost = new Map<string, Array<[number, number]>>();
    for (const m of c.members ?? []) {
      const host = decls.find((d) => d.name === m.of);
      if (!host) throw new Error(`CAPABILITIES: ${c.key} cuts ${m.name} out of ${m.of}, which is not declared`);
      const range = memberRange(lines.slice(host.from, host.to + 1), m.name);
      if (!range) throw new Error(`CAPABILITIES: ${m.of} has no member ${m.name} (${c.key})`);
      byHost.set(m.of, [...(byHost.get(m.of) ?? []), range]);
    }
    const out: string[] = [];
    for (const [name, ranges] of byHost) {
      const host = decls.find((d) => d.name === name)!;
      const own = lines.slice(host.from, host.to + 1);
      const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
      for (const [a, b] of sorted) for (let i = a; i <= b; i += 1) drop.add(host.from + i);
      const head = own.find((l) => START.test(l))!.replace(/\{.*$/, "{");
      const body = sorted.map(([a, b]) => own.slice(a, b + 1).join("\n")).join("\n");
      out.push(`// ${name}, continued (${c.key}):\n${head}\n${body}\n}`);
    }
    if (out.length) fragments.set(c.key, out);
  }

  const capabilities: Record<string, string> = {};
  for (const c of CAPABILITIES) {
    const parts: string[] = [];
    for (const name of c.declarations) {
      const text = found.get(name);
      if (text === undefined) throw new Error(`CAPABILITIES: ${c.key} lists ${name}, which no type file declares`);
      parts.push(text);
    }
    parts.push(...(fragments.get(c.key) ?? []));
    capabilities[c.key] = parts.join("\n\n");
  }
  const core = lines
    .filter((_, i) => !drop.has(i))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { core, capabilities };
}

// ---- what the prompt and the first message say about them ----

/** The prompt's index: one line per capability, with how to read it. */
export function capabilityIndex(): string {
  return CAPABILITIES.map((c) => `- \`${c.key}\` — ${c.summary}. lookup("${c.key}")`).join("\n");
}

/** A capability's passage: its notes, then its declarations. */
export function capabilityBlock(c: Capability, declared: Readonly<Record<string, string>>): string {
  const body = [c.notes, declared[c.key]].filter((p): p is string => Boolean(p && p.trim())).join("\n\n");
  return `// ===== ${c.key} =====\n${body}`;
}

const NOTES_MAX_CHARS = 9000;

/**
 * The capability passages a request needs, for the first message — so an engine that cannot call
 * `lookup` (claude -p, a one-turn API call) still reads the declarations of what it is asked to use,
 * and one that can starts with them. Matched on the request and on the app being changed (an app
 * that already reads `ctx.caps.ai` gets its declaration back). Empty when nothing matches.
 */
export function capabilityNotes(declared: Readonly<Record<string, string>>, request: string, source = ""): string {
  let picked = CAPABILITIES.filter((c) => c.cues.test(request) || (source !== "" && c.uses.test(source)));
  // A capability under ctx.caps brings the guard-and-permissions rule with it.
  if (picked.some((c) => c.key.startsWith("ctx.caps.")) && !picked.some((c) => c.key === "ctx.caps")) {
    picked = [CAPABILITIES.find((c) => c.key === "ctx.caps")!, ...picked];
  }
  if (!picked.length) return "";
  let out = "";
  for (const c of picked) {
    const block = capabilityBlock(c, declared);
    if (out.length + block.length > NOTES_MAX_CHARS) continue;
    out += `${out ? "\n\n" : ""}${block}`;
  }
  if (!out) return "";
  return `The declarations of the capabilities this request may need (the CAPABILITIES index in your instructions lists the rest; with tools, lookup reads any of them):\n\`\`\`ts\n${out}\n\`\`\``;
}
