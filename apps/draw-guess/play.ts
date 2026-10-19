// The Play screen: start, lobby, the game, the end. A custom view (it draws on a canvas), so it runs
// when the app runs as yours (docs/05) — see README for how a friend who gets the app plays.
//
// The game itself lives in a Session (session.ts) kept at module level, not in this view: switching
// to Past games and back keeps you in the room. Potyro closes the room when you leave the app or it
// sits in the background (docs/28 §5); the Session hears why and this screen offers Rejoin.
import type { Ctx, ViewProps, Words } from "potyro";
import { Session, type FeedItem, type Problem, type RoomLike } from "./session.js";
import { Board } from "./board.js";
import { Sounds } from "./sound.js";
import { COLORS, ERASER, PAPER, SIZES, addPiece, emptySketch, type Sketch } from "./sketch.js";
import { canStart, online, playerOf, standings, ROUNDS, SECONDS, MIN_PLAYERS, type Game, type Player } from "./game.js";
import { newCode, parseCode, showCode, strongRandom } from "./code.js";
import { LANGS, isLang, wordAt, type Lang } from "./words.js";
import { W, COLOR_WORDS, SIZE_WORDS, LANG_NAMES } from "./ui-words.js";
import { STYLES } from "./styles.js";

// ---- small helpers ----

type Kid = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | undefined> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) n.setAttribute(k, v);
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) n.append(kid);
  return n;
}
const on = <T extends HTMLElement>(el: T, ev: string, fn: (e: Event) => void): T => {
  el.addEventListener(ev, fn);
  return el;
};
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Hues far apart, handed out in the order players came in: the same on every device, never two alike in a small room. */
const HUES = [14, 205, 140, 285, 44, 330, 175, 250, 95, 0, 225, 60, 310, 160, 30, 265];
let hueBook: readonly Player[] = [];
/** One colour per player: their place in the game's list picks it. */
export function hueOf(p: string): number {
  const i = hueBook.findIndex((x) => x.p === p);
  return HUES[(i < 0 ? 0 : i) % HUES.length]!;
}
const initials = (name: string) => [...name.trim()].slice(0, 1).join("").toUpperCase() || "?";

function avatar(pl: Player, extra = ""): HTMLElement {
  const a = h("span", { class: `dg-avatar ${extra}`, "aria-hidden": "true" }, initials(pl.name));
  a.style.setProperty("--dg-hue", String(hueOf(pl.p)));
  return a;
}

const PREF_NAME = "name";
const DEFAULT_NAMES = new Set(["", "me", "you"]);

function randomId(): string {
  const a = new Uint8Array(9);
  globalThis.crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_");
}

const PROBLEM_WORDS: Record<Problem, Words> = {
  nobody: W.nobody,
  full: W.full,
  offline: W.offline,
  unreachable: W.unreachable,
  denied: W.denied,
  refused: W.refused,
  idle: W.idle,
  unavailable: W.unavailable,
};

/** Who draws after this reveal, by the host's rule (game.ts `nextTurn`): null when the game ends. */
function nextDrawer(g: Game): Player | null {
  const here = g.players.filter((x) => x.m !== null);
  if (here.length < MIN_PLAYERS) return null;
  const left = here.find((x) => !g.drawn.includes(x.p));
  if (left) return left;
  return g.round < g.rounds ? (here[0] ?? null) : null;
}

// ---- the one game this app is in, across views ----

let current: Session | null = null;
const sounds = new Sounds();
/** Games already written to Past games, so one game is one record however often the view remounts. */
const kept = new Set<string>();
/** What the lobby has shown already, so a re-render does not replay its entrances: the code's tiles drop in once, each person pops in once. */
const lobbySeen = { code: "", people: new Set<string>(), howOpen: false };

// ---- confetti ----

function confetti(host: HTMLElement, burst = 140): void {
  if (reducedMotion()) return;
  const c = h("canvas", { class: "dg-confetti", "aria-hidden": "true" });
  host.append(c);
  const r = host.getBoundingClientRect();
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  c.width = Math.max(1, Math.round(r.width * dpr));
  c.height = Math.max(1, Math.round(r.height * dpr));
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  const hues = [8, 38, 52, 140, 205, 280, 330];
  const bits = Array.from({ length: burst }, () => ({
    x: r.width / 2 + (Math.random() - 0.5) * r.width * 0.3,
    y: r.height * 0.35,
    vx: (Math.random() - 0.5) * 9,
    vy: -Math.random() * 9 - 4,
    s: 5 + Math.random() * 6,
    a: Math.random() * Math.PI,
    va: (Math.random() - 0.5) * 0.4,
    hue: hues[Math.floor(Math.random() * hues.length)]!,
  }));
  const t0 = performance.now();
  const step = (now: number) => {
    const t = now - t0;
    g.clearRect(0, 0, r.width, r.height);
    for (const b of bits) {
      b.vy += 0.28;
      b.vx *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.a += b.va;
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.a);
      g.globalAlpha = Math.max(0, 1 - t / 2200);
      g.fillStyle = `hsl(${b.hue} 85% 58%)`;
      g.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
      g.restore();
    }
    if (t < 2200 && c.isConnected) requestAnimationFrame(step);
    else c.remove();
  };
  requestAnimationFrame(step);
}

// ---- the doodle on the start screen: the board renderer drawing a little scene by itself ----

const DOODLE: Array<{ c: number; w: number; pts: number[] }> = [
  // the sun
  { c: 3, w: 2, pts: [780, 210, 800, 170, 840, 150, 880, 165, 905, 205, 900, 250, 870, 280, 825, 285, 790, 260, 778, 222] },
  { c: 2, w: 0, pts: [840, 110, 845, 70] },
  { c: 2, w: 0, pts: [930, 200, 970, 195] },
  { c: 2, w: 0, pts: [910, 120, 940, 90] },
  // the house
  { c: 0, w: 1, pts: [200, 820, 200, 560, 420, 380, 640, 560, 640, 820, 200, 820] },
  { c: 1, w: 1, pts: [170, 585, 420, 360, 670, 585] },
  { c: 7, w: 1, pts: [370, 820, 370, 680, 470, 680, 470, 820] },
  { c: 5, w: 1, pts: [250, 600, 330, 600, 330, 660, 250, 660, 250, 600] },
  // grass
  { c: 4, w: 1, pts: [60, 860, 120, 830, 180, 865, 260, 835, 340, 862, 430, 832, 520, 866, 610, 836, 700, 864, 800, 834, 900, 862, 960, 840] },
];

function playDoodle(board: Board): () => void {
  let sk: Sketch = emptySketch();
  if (reducedMotion()) {
    DOODLE.forEach((d, i) => (sk = addPiece(sk, { s: i + 1, q: 0, c: d.c, w: d.w, pts: d.pts, end: true })));
    board.show(sk);
    return () => undefined;
  }
  let stroke = 0;
  let upto = 2;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    const d = DOODLE[stroke];
    if (!d) {
      timer = setTimeout(() => {
        sk = emptySketch();
        stroke = 0;
        upto = 2;
        board.show(sk);
        tick();
      }, 3500);
      return;
    }
    // Interpolate along the stroke for a hand-drawn pace.
    const pts: number[] = [];
    for (let i = 0; i + 3 < d.pts.length && i < upto; i += 2) {
      const [x0, y0, x1, y1] = [d.pts[i]!, d.pts[i + 1]!, d.pts[i + 2]!, d.pts[i + 3]!];
      for (let k = 0; k < 6; k++) pts.push(Math.round(x0 + ((x1 - x0) * k) / 6), Math.round(y0 + ((y1 - y0) * k) / 6));
    }
    if (upto >= d.pts.length) pts.push(d.pts[d.pts.length - 2]!, d.pts[d.pts.length - 1]!);
    sk = addPiece(sk, { s: stroke + 1, q: 0, c: d.c, w: d.w, pts: pts.length ? pts : d.pts.slice(0, 2), end: upto >= d.pts.length });
    board.show(sk);
    if (upto >= d.pts.length) {
      stroke += 1;
      upto = 2;
    } else upto += 2;
    timer = setTimeout(tick, 70);
  };
  tick();
  return () => {
    if (timer) clearTimeout(timer);
  };
}

// ---- the view ----

export function mountPlay(el: HTMLElement, props: ViewProps): () => void {
  const ctx: Ctx = props.runtime.ctx;
  const t = (w: Words, vars?: Record<string, string | number>) => ctx.t(w, vars);
  const style = h("style", {}, STYLES);
  const root = h("div", { class: "dg" });
  el.append(style, root);
  let alive = true;
  let teardownScreen: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  let name = "";
  // A game this person was invited to by a link (docs/24 §11): the Play page's `code`, from the link.
  // It only fills the box — joining is still the person's tap. Used once: back on the start screen
  // after that game, the box is empty again.
  let invite = parseCode(String(props.param?.code ?? ""));
  const myLang: Lang = isLang(ctx.locale) ? ctx.locale : "en";

  // The sound switch, in the corner of every screen.
  const soundBtn = h("button", { class: "dg-sound", type: "button" });
  const showSound = () => {
    soundBtn.textContent = sounds.on ? "🔊" : "🔈";
    soundBtn.setAttribute("aria-label", t(sounds.on ? W.soundOn : W.soundOff));
    soundBtn.setAttribute("aria-pressed", String(sounds.on));
    soundBtn.title = t(sounds.on ? W.soundOn : W.soundOff);
  };
  on(soundBtn, "click", () => {
    sounds.set(!sounds.on);
    showSound();
    sounds.play("join");
  });
  showSound();

  const screen = h("div", { class: "dg-screen" });
  root.append(screen);

  const swap = (node: HTMLElement, teardown: (() => void) | null = null) => {
    teardownScreen?.();
    teardownScreen = teardown;
    screen.replaceChildren(node);
  };

  /** What a friend who does not have the app yet does — said where the person needs it: on the start screen and beside the code. */
  const howFriendsJoin = () => {
    // Open or shut as the person left it: the lobby redraws whenever someone comes in.
    const d = h(
      "details",
      { class: "dg-how", ...(lobbySeen.howOpen ? { open: "" } : {}) },
      h("summary", {}, t(W.friendsTitle)),
      h("ol", {}, h("li", {}, t(W.friendsStep1)), h("li", {}, t(W.friendsStep2)), h("li", {}, t(W.friendsStep3))),
    );
    on(d, "toggle", () => (lobbySeen.howOpen = d.open));
    return d;
  };

  // ---- start ----

  const showStart = (message?: Words) => {
    const nameIn = h("input", { id: "dg-name", class: "dg-input", type: "text", maxlength: "24", autocomplete: "nickname", placeholder: t(W.namePlaceholder), value: name, enterkeyhint: "go" });
    const codeIn = h("input", { id: "dg-code", class: "dg-input dg-code-in", type: "text", maxlength: "16", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", placeholder: "KQ7M-XR4P-2DHC", enterkeyhint: "go" });
    const note = h("p", { class: "dg-note", role: "status", "aria-live": "polite" }, message ? t(message) : "");
    if (message) note.classList.add("dg-note-bad");
    const newBtn = h("button", { class: "dg-btn dg-btn-hot", type: "button" }, h("span", { "aria-hidden": "true" }, "✏️"), t(W.newGame));
    const invited = invite;
    if (invited) codeIn.value = showCode(invited);
    const joinBtn = h("button", { class: invited ? "dg-btn dg-btn-hot" : "dg-btn", type: "submit" }, t(W.join));
    const doodle = new Board(t(W.board));
    const stopDoodle = playDoodle(doodle);
    const art = h("div", { class: "dg-hero-art", "aria-hidden": "true" }, doodle.canvas);
    const sizeDoodle = () => doodle.resize(Math.round(Math.min(art.clientWidth || 220, 240)));

    const takeName = (): string | null => {
      const n = nameIn.value.replace(/\s+/g, " ").trim();
      if (!n) {
        note.textContent = t(W.needName);
        note.classList.add("dg-note-bad");
        nameIn.focus();
        return null;
      }
      name = n;
      void ctx.storage.set(PREF_NAME, n).catch(() => undefined);
      return n;
    };
    on(newBtn, "click", () => {
      const n = takeName();
      if (n) begin(newCode(strongRandom), n, true);
    });
    const form = on(
      h(
        "form",
        { class: invited ? "dg-join dg-invited" : "dg-join" },
        invited ? h("p", { class: "dg-invite-note" }, t(W.invited)) : null,
        h("label", { for: "dg-code", class: "dg-label" }, t(W.haveCode)),
        h("div", { class: "dg-row" }, codeIn, joinBtn),
      ),
      "submit",
      (e) => {
      e.preventDefault();
      const n = takeName();
      if (!n) return;
      const code = parseCode(codeIn.value);
      if (!code) {
        note.textContent = t(W.badCode);
        note.classList.add("dg-note-bad");
        codeIn.focus();
        return;
      }
      begin(code, n, false);
      },
    );
    on(nameIn, "keydown", (e) => {
      if ((e as KeyboardEvent).key !== "Enter") return;
      // Invited: Enter after your name joins that game; otherwise it starts a new one.
      if (invited) form.requestSubmit();
      else newBtn.click();
    });

    // Invited: one thing to do — say your name and join THIS game. The code is shown, not asked for;
    // starting a game of your own is still there, below, for whoever wants it instead.
    if (invited && ctx.caps.network?.room) {
      const go = h("button", { class: "dg-btn dg-btn-hot dg-btn-wide", type: "button" }, h("span", { "aria-hidden": "true" }, "🎨"), t(W.joinGame));
      const own = h("button", { class: "dg-link", type: "button" }, t(W.ownGame));
      on(own, "click", () => {
        invite = null;
        showStart();
      });
      const joinForm = h(
        "div",
        { class: "dg-start-card dg-invited" },
        h("p", { class: "dg-invite-note" }, t(W.invitedTo)),
        h("label", { for: "dg-name", class: "dg-label" }, t(W.yourName)),
        nameIn,
        go,
        h("p", { class: "dg-hint" }, `${t(W.codeLabel)}: ${showCode(invited)}`),
        note,
      );
      on(go, "click", () => {
        const n = takeName();
        if (n) begin(invited, n, false);
      });
      const inviteCard = h(
        "section",
        { class: "dg-start", "aria-labelledby": "dg-title" },
        h("div", { class: "dg-hero" }, h("div", { class: "dg-hero-text" }, h("h2", { id: "dg-title", class: "dg-title" }, t(W.heroTitle)), h("p", { class: "dg-tagline" }, t(W.tagline))), art),
        joinForm,
        h("p", { class: "dg-own" }, own),
      );
      const roInvite = new ResizeObserver(sizeDoodle);
      swap(inviteCard, () => {
        stopDoodle();
        doodle.destroy();
        roInvite.disconnect();
      });
      roInvite.observe(art);
      sizeDoodle();
      setTimeout(() => {
        const next = nameIn.value ? go : nameIn;
        if (next.isConnected) next.focus({ preventScroll: true });
      }, 60);
      return;
    }

    const how = howFriendsJoin();
    const card = h(
      "section",
      { class: "dg-start", "aria-labelledby": "dg-title" },
      h("div", { class: "dg-hero" }, h("div", { class: "dg-hero-text" }, h("h2", { id: "dg-title", class: "dg-title" }, t(W.heroTitle)), h("p", { class: "dg-tagline" }, t(W.tagline))), art),
      h(
        "div",
        { class: "dg-start-card" },
        h("label", { for: "dg-name", class: "dg-label" }, t(W.yourName)),
        nameIn,
        h("div", { class: "dg-new" }, newBtn, h("span", { class: "dg-hint" }, t(W.newGameHint))),
        h("div", { class: "dg-or", "aria-hidden": "true" }),
        form,
        note,
      ),
      how,
    );
    const ro = new ResizeObserver(sizeDoodle);
    swap(card, () => {
      stopDoodle();
      doodle.destroy();
      ro.disconnect();
    });
    ro.observe(art);
    sizeDoodle();
    if (!ctx.caps.network?.room) {
      note.textContent = t(W.sealed);
      note.classList.add("dg-note-bad");
      newBtn.disabled = true;
      joinBtn.disabled = true;
    } else if (invited) {
      // Straight to the one thing left to do: your name if it is missing, else Join. After the shell has
      // put the page up, which settles its own focus first.
      const next = nameIn.value ? joinBtn : nameIn;
      setTimeout(() => {
        if (next.isConnected) next.focus({ preventScroll: true });
      }, 60);
    }
  };

  // ---- into a game ----

  const begin = (code: string, who: string, fresh: boolean) => {
    invite = null;
    const room = ctx.caps.network?.room;
    if (!room) return showStart(W.unavailable);
    current?.leave();
    const s = new Session(code, who, {
      // A player puts Potyro away to send the invite (Signal, WhatsApp) or to answer a message, and
      // comes back: the game is still theirs. The most Potyro allows; after that it steps them out.
      open: (id, n) => room(id, { name: n, keepWhileHidden: "15m" }) as Promise<RoomLike>,
      newId: randomId,
      random: strongRandom,
      lang: myLang,
    });
    current = s;
    follow(s);
    void s.connect(fresh);
  };

  const follow = (s: Session) => {
    unsubscribe?.();
    let prev: { phase: string; turn: number; feed: number; players: number } = { phase: "", turn: -1, feed: 0, players: 0 };
    let shown: "wait" | "lobby" | "game" | "final" | "" = "";
    let game: GameScreen | null = null;
    const route = (change: string) => {
      if (!alive || current !== s) return;
      // Over: said once, and forgotten, so coming back to Play later starts fresh.
      if (s.status === "failed" || s.status === "ended") {
        current = null;
        unsubscribe?.();
        return showStart(s.status === "failed" ? (s.problem ? PROBLEM_WORDS[s.problem] : W.refused) : undefined);
      }
      const g = s.game;
      if (g) hueBook = g.players;
      if (!g || s.status === "connecting" || s.status === "away") {
        shown = "wait";
        game = null;
        return showWait(s);
      }
      // Effects on changes, the same for everyone: sounds, a burst of confetti.
      if (g.players.length > prev.players && prev.players) sounds.play("join");
      if (g.turn !== prev.turn && g.phase === "pick" && g.drawer === s.p) sounds.play("turn");
      if (g.phase === "reveal" && prev.phase === "draw") {
        const last = g.last;
        if (last?.by && (last.by === s.p || last.drawer === s.p)) {
          sounds.play("got");
          confetti(root, 60);
        } else sounds.play(last?.by ? "got" : "miss");
      }
      if (g.phase === "final" && prev.phase !== "final") {
        sounds.play("win");
        keep(s, g);
      }
      prev = { phase: g.phase, turn: g.turn, feed: s.feed.length, players: g.players.length };

      const want = g.phase === "lobby" ? "lobby" : g.phase === "final" ? "final" : "game";
      if (want !== shown || (want !== "game" && change !== "sketch")) {
        if (want === "game") {
          if (shown !== "game" || !game) game = showGame(s);
        } else {
          game = null;
          if (want === "lobby") showLobby(s, g);
          else showFinal(s, g);
        }
        shown = want;
      }
      if (want === "game" && game) game.update(change);
      if (s.status === "reconnecting") root.dataset.reconnecting = "";
      else delete root.dataset.reconnecting;
    };
    unsubscribe = s.subscribe(route);
    route("status");
  };

  /** One game, one record in Past games, on this device. */
  const keep = (s: Session, g: Game) => {
    // The turn counter runs on across games in one room, so the code and the last turn name one game.
    const key = `${s.code}:${g.turn}`;
    if (kept.has(key) || !playerOf(g, s.p)) return;
    kept.add(key);
    const ranked = standings(g);
    const mine = ranked.findIndex((x) => x.p === s.p);
    const top = ranked[0];
    void ctx
      .create("game", {
        title: top ? `🏆 ${top.name}` : "—",
        date: new Date(),
        players: ranked.map((x) => `${x.name} ${x.score}`).join(" · "),
        place: mine + 1,
        score: ranked[mine]?.score ?? 0,
      })
      .catch(() => undefined);
  };

  // ---- waiting / away ----

  const showWait = (s: Session) => {
    if (s.status === "away") {
      const back = on(h("button", { class: "dg-btn dg-btn-hot", type: "button" }, t(W.rejoin)), "click", () => void s.rejoin());
      const quit = on(h("button", { class: "dg-btn dg-btn-quiet", type: "button" }, t(W.leave)), "click", () => s.leave());
      swap(h("section", { class: "dg-wait" }, h("div", { class: "dg-big", "aria-hidden": "true" }, "🙈"), h("h2", {}, t(W.away)), h("p", {}, t(W.awayBody)), h("div", { class: "dg-row" }, back, quit)));
      return;
    }
    const words = s.status === "reconnecting" ? W.reconnecting : s.status === "joining" ? W.joining : W.connecting;
    const quit = on(h("button", { class: "dg-btn dg-btn-quiet", type: "button" }, t(W.back)), "click", () => s.leave());
    swap(h("section", { class: "dg-wait", role: "status" }, h("div", { class: "dg-pencil", "aria-hidden": "true" }, "✏️"), h("p", {}, t(words)), h("p", { class: "dg-code-small" }, showCode(s.code)), quit));
  };

  const confirmLeave = async (s: Session) => {
    const sure = await ctx.ui.confirm(W.leaveSure, { detail: W.leaveDetail, ok: W.leave, cancel: W.stay, destructive: true });
    if (sure) s.leave();
  };

  // ---- the lobby ----

  const showLobby = (s: Session, g: Game) => {
    const hostName = s.nameOf(s.hostPlayer);
    const firstTime = lobbySeen.code !== s.code;
    if (firstTime) lobbySeen.people = new Set();
    lobbySeen.code = s.code;
    const tiles = h("div", { class: `dg-tiles${firstTime ? "" : " dg-still"}`, "aria-label": showCode(s.code), role: "img" });
    showCode(s.code)
      .split("")
      .forEach((ch, i) => tiles.append(ch === "-" ? h("span", { class: "dg-tile-gap" }) : h("span", { class: "dg-tile", style: `--dg-i:${i};--dg-r:${((i % 3) - 1) * 2.5}deg` }, ch)));
    const invite = on(h("button", { class: "dg-btn dg-btn-hot", type: "button" }, h("span", { "aria-hidden": "true" }, "💌"), t(W.invite)), "click", () => {
      // A link that opens the game's Play page with this code filled in, on a friend's own copy — or,
      // for a friend without the game, as a demo they can keep (docs/24 §11). The words carry the code
      // too, for anyone who would rather type it.
      void ctx.ui.share({ title: W.inviteTitle, text: t(W.inviteText, { code: showCode(s.code) }), app: { page: "play", params: { code: s.code } } }).catch(() => undefined);
    });
    const people = h("ul", { class: "dg-people", "aria-label": t(W.players, { n: online(g).length }) });
    for (const pl of g.players) {
      if (pl.m === null) continue;
      const tags: Kid[] = [];
      if (pl.p === s.p) tags.push(h("span", { class: "dg-tag" }, t(W.you)));
      if (pl.p === s.hostPlayer) tags.push(h("span", { class: "dg-tag dg-tag-host" }, `👑 ${t(W.host)}`));
      const fresh = !lobbySeen.people.has(pl.p);
      lobbySeen.people.add(pl.p);
      people.append(h("li", { class: `dg-person${fresh ? " dg-pop" : ""}` }, avatar(pl), h("span", { class: "dg-person-text" }, h("span", { class: "dg-person-name" }, pl.name), tags.length ? h("span", { class: "dg-person-tags" }, ...tags) : null)));
    }
    for (let i = online(g).length; i < Math.max(MIN_PLAYERS, 4); i++) people.append(h("li", { class: "dg-person dg-person-empty", "aria-hidden": "true" }, h("span", { class: "dg-avatar dg-avatar-empty" }, "?"), h("span", { class: "dg-person-text" }, h("span", { class: "dg-person-name" }, "…"))));

    const settings = h("div", { class: "dg-settings" });
    const segment = (label: Words, values: readonly number[], value: number, pick: (n: number) => void) =>
      h(
        "div",
        { class: "dg-setting", role: "group", "aria-label": t(label) },
        h("span", { class: "dg-label" }, t(label)),
        h(
          "div",
          { class: "dg-seg" },
          ...values.map((v) => {
            const b = h("button", { type: "button", class: "dg-seg-btn", "aria-pressed": String(v === value) }, String(v));
            if (!s.isHost) b.disabled = true;
            else on(b, "click", () => pick(v));
            return b;
          }),
        ),
      );
    const langSel = h("select", { class: "dg-select", id: "dg-lang" }, ...LANGS.map((l) => h("option", { value: l, ...(l === g.lang ? { selected: "" } : {}) }, LANG_NAMES[l])));
    if (!s.isHost) langSel.disabled = true;
    on(langSel, "change", () => isLang(langSel.value) && s.configure({ lang: langSel.value }));
    settings.append(
      h("div", { class: "dg-setting" }, h("label", { class: "dg-label", for: "dg-lang" }, t(W.wordsIn)), langSel),
      segment(W.rounds, ROUNDS, g.rounds, (n) => s.configure({ rounds: n })),
      segment(W.seconds, SECONDS, g.seconds, (n) => s.configure({ seconds: n })),
    );

    const go = h("button", { class: "dg-btn dg-btn-go", type: "button" }, h("span", { "aria-hidden": "true" }, "🎨"), t(W.start));
    on(go, "click", () => s.start());
    const foot = s.isHost
      ? canStart(g)
        ? go
        : h("p", { class: "dg-note" }, t(W.needTwo))
      : h("p", { class: "dg-note" }, t(W.waitingHost, { name: hostName }));
    const leave = on(h("button", { class: "dg-btn dg-btn-quiet dg-btn-small", type: "button" }, t(W.leave)), "click", () => void confirmLeave(s));

    swap(
      h(
        "section",
        { class: "dg-lobby", "aria-labelledby": "dg-lobby-title" },
        h("header", { class: "dg-head" }, h("h2", { id: "dg-lobby-title" }, t(W.lobbyTitle)), h("div", { class: "dg-head-acts" }, leave, soundBtn)),
        h("div", { class: "dg-lobby-code" }, h("div", { class: "dg-code-card" }, h("span", { class: "dg-label" }, t(W.codeLabel)), tiles, h("p", { class: "dg-hint" }, t(W.shareCode)), invite), howFriendsJoin()),
        h("div", { class: "dg-lobby-side" }, h("h3", { class: "dg-label" }, t(W.players, { n: online(g).length })), people, settings, h("div", { class: "dg-lobby-foot" }, foot)),
      ),
    );
  };

  // ---- the game ----

  interface GameScreen {
    update(change: string): void;
  }

  const showGame = (s: Session): GameScreen => {
    const board = new Board(t(W.board));
    const pen = { color: 0, size: 1 };
    const section = h("section", { class: "dg-play" });
    const strip = h("div", { class: "dg-strip" });
    const roundEl = h("span", { class: "dg-round" });
    const wordEl = h("div", { class: "dg-word", "aria-live": "polite" });
    const ring = h("div", { class: "dg-timer", role: "timer" });
    const ringNum = h("span", {});
    ring.append(ringNum);
    strip.append(roundEl, wordEl, ring, soundBtn);

    const stage = h("div", { class: "dg-stage" });
    const paper = h("div", { class: "dg-paper", "data-testid": "board" }, board.canvas);
    const overlay = h("div", { class: "dg-overlay", hidden: "" });
    stage.append(paper, overlay);

    // Tools: the drawer's only.
    const tools = h("div", { class: "dg-tools", role: "toolbar", "aria-label": t(W.tools) });
    const swatches = [...COLORS.map((c, i) => ({ i, c })), { i: ERASER, c: PAPER }].map(({ i, c }) => {
      const b = h("button", { type: "button", class: `dg-swatch${i === ERASER ? " dg-eraser" : ""}`, "aria-pressed": String(i === pen.color), "aria-label": t(i === ERASER ? W.eraser : COLOR_WORDS[i]!), title: t(i === ERASER ? W.eraser : COLOR_WORDS[i]!) }, i === ERASER ? "◌" : "");
      b.style.setProperty("--dg-swatch", c);
      on(b, "click", () => {
        pen.color = i;
        swatches.forEach((x, k) => x.setAttribute("aria-pressed", String(k === (i === ERASER ? COLORS.length : i))));
      });
      return b;
    });
    const sizes = SIZES.map((_, i) => {
      const b = h("button", { type: "button", class: "dg-size", "aria-pressed": String(i === pen.size), "aria-label": t(SIZE_WORDS[i]!), title: t(SIZE_WORDS[i]!) }, h("span", { style: `--dg-dot:${6 + i * 7}px` }));
      on(b, "click", () => {
        pen.size = i;
        sizes.forEach((x, k) => x.setAttribute("aria-pressed", String(k === i)));
      });
      return b;
    });
    const undo = on(h("button", { type: "button", class: "dg-tool", "aria-label": t(W.undo), title: t(W.undo) }, "↶"), "click", () => s.undo());
    const clear = on(h("button", { type: "button", class: "dg-tool", "aria-label": t(W.clear), title: t(W.clear) }, "🗑"), "click", () => s.clear());
    tools.append(h("div", { class: "dg-swatches" }, ...swatches), h("div", { class: "dg-sizes" }, ...sizes), h("div", { class: "dg-acts" }, undo, clear));

    const side = h("div", { class: "dg-side" });
    const scores = h("ol", { class: "dg-scores" });
    const feed = h("ul", { class: "dg-feed", "aria-live": "polite" });
    const guessIn = h("input", { class: "dg-input dg-guess-in", type: "text", maxlength: "40", autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "send", placeholder: t(W.guessPlaceholder), "aria-label": t(W.guessPlaceholder) });
    const guessBtn = h("button", { class: "dg-btn dg-btn-hot", type: "submit" }, t(W.guessSend));
    const guessForm = on(h("form", { class: "dg-guess" }, guessIn, guessBtn), "submit", (e) => {
      e.preventDefault();
      if (s.guess(guessIn.value)) guessIn.value = "";
      guessIn.focus();
    });
    const drawerNote = h("p", { class: "dg-drawer-note" }, t(W.drawerWaits));
    const leave = on(h("button", { class: "dg-btn dg-btn-quiet dg-btn-small", type: "button" }, t(W.leave)), "click", () => void confirmLeave(s));
    side.append(scores, feed, guessForm, drawerNote, leave);
    section.append(strip, stage, tools, side);

    // Layout: side by side when the screen is wide enough (a laptop, a phone on its side), stacked otherwise.
    const probe = h("div", {});
    probe.style.cssText = "position:absolute;visibility:hidden;height:var(--k-chrome-bottom, 0px)";
    root.append(probe);
    // Where the game starts on the page as if nothing were scrolled: the page may be (the lobby's
    // Start was further down, a phone's keyboard pushed it), and the paper must not grow because of it.
    const layout = () => {
      const w = Math.max(240, section.clientWidth || el.clientWidth || 360);
      let top = section.getBoundingClientRect().top;
      for (let n: Element | null = section.parentElement; n; n = n.parentElement) top += n.scrollTop;
      top = Math.max(0, top);
      const avail = Math.max(220, globalThis.innerHeight - top - probe.offsetHeight - 12);
      const wide = w >= 560 && w > avail * 1.15;
      section.classList.toggle("dg-wide", wide);
      const stripH = strip.offsetHeight || 52;
      const toolsH = s.isDrawer && !wide ? tools.offsetHeight || 56 : 0;
      let size: number;
      // Room for the paper's shadow; on a phone, room under the paper for the scores and the guess box.
      if (wide) size = Math.min(avail - stripH - toolsH - 24, w - Math.min(360, Math.max(250, w * 0.34)) - 32);
      else size = Math.min(w - 8, Math.max(220, avail - stripH - toolsH - (s.isDrawer ? 110 : 200)));
      board.resize(Math.max(200, Math.floor(size)));
    };
    const ro = new ResizeObserver(() => layout());
    ro.observe(root);
    // The phone's keyboard coming up shrinks the window, not the view: the paper shrinks with it.
    globalThis.addEventListener("resize", layout);

    // The clock, four times a second.
    let lastSecond = -1;
    const clock = setInterval(() => drawClock(), 250);
    const drawClock = () => {
      const g = s.game;
      if (!g) return;
      const total = g.phase === "pick" ? 15 : g.phase === "reveal" ? 5 : g.seconds;
      const mine = s.mine;
      const ends = g.phase === "draw" && mine && mine.row !== null ? mine.started + g.seconds * 1000 : g.ends;
      const left = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
      ring.hidden = !(g.phase === "draw" || g.phase === "pick");
      ringNum.textContent = String(Math.min(left, total));
      ring.style.setProperty("--dg-left", String(Math.max(0, Math.min(1, left / total))));
      ring.classList.toggle("dg-hurry", g.phase === "draw" && left <= 10);
      ring.setAttribute("aria-label", t(W.secondsLeft, { n: left }));
      if (g.phase === "draw" && left <= 5 && left > 0 && left !== lastSecond) sounds.play("tick");
      lastSecond = left;
    };

    const drawWord = () => {
      const g = s.game!;
      const mine = s.mine;
      wordEl.replaceChildren();
      wordEl.className = "dg-word";
      if (g.phase === "draw" && mine?.word) {
        wordEl.classList.add("dg-word-mine");
        wordEl.append(h("span", { class: "dg-word-label" }, t(W.drawThis)), h("strong", { "data-testid": "secret" }, mine.word));
      } else if (g.phase === "draw" && g.mask) {
        const blanks = h("span", { class: "dg-mask", "data-testid": "mask", "aria-label": t(W.letters, { n: [...g.mask].filter((c) => c !== " " && c !== "-").length }) });
        for (const ch of g.mask) blanks.append(h("span", { class: ch === "_" ? "dg-blank" : ch === " " || ch === "-" ? "dg-space" : "dg-shown" }, ch === "_" ? "" : ch));
        wordEl.append(blanks);
      } else if (g.phase === "reveal") {
        const next = nextDrawer(g);
        if (next) wordEl.append(h("span", { class: "dg-word-label" }, t(W.nextUp, { name: next.p === s.p ? t(W.you) : next.name })));
      } else if (g.drawer === s.p) {
        wordEl.append(h("strong", { class: "dg-word-turn" }, t(W.yourTurn)));
      } else if (g.drawer) {
        wordEl.append(h("span", { class: "dg-word-label" }, t(W.choosing, { name: s.nameOf(g.drawer) })));
      }
    };

    const drawOverlay = () => {
      const g = s.game!;
      const mine = s.mine;
      overlay.replaceChildren();
      overlay.className = "dg-overlay";
      let show = true;
      if (g.phase === "pick" && mine && mine.row === null) {
        overlay.classList.add("dg-overlay-pick");
        overlay.append(
          h("h3", {}, t(W.choose)),
          h(
            "div",
            { class: "dg-choices" },
            ...mine.choices.map((row, i) =>
              on(h("button", { type: "button", class: "dg-choice", style: `--dg-i:${i}` }, wordAt(mine.lang, row)), "click", () => s.choose(i)),
            ),
          ),
          h("p", { class: "dg-hint" }, t(W.chooseAuto)),
        );
      } else if (g.phase === "pick") {
        const drawer = playerOf(g, g.drawer);
        overlay.append(drawer ? avatar(drawer, "dg-avatar-big") : "", h("p", {}, t(W.choosing, { name: s.nameOf(g.drawer) })));
      } else if (g.phase === "reveal" && g.last) {
        const last = g.last;
        overlay.classList.add("dg-overlay-reveal");
        const head =
          last.why === "guessed" && last.by
            ? t(last.by === s.p ? W.gotYou : W.got, { name: s.nameOf(last.by) })
            : last.why === "left"
              ? t(W.drawerLeft, { name: s.nameOf(last.drawer) })
              : last.why === "skipped"
                ? t(W.skipped, { name: s.nameOf(last.drawer) })
                : t(W.timeUp);
        overlay.append(
          h("p", { class: "dg-reveal-head" }, head),
          last.word ? h("p", { class: "dg-reveal-word" }, h("span", {}, t(W.wordWas)), h("strong", { "data-testid": "revealed" }, last.word)) : "",
          h("ul", { class: "dg-gains" }, ...Object.entries(last.gained).map(([p, n]) => h("li", {}, `${s.nameOf(p)} `, h("b", {}, `+${n}`)))),
        );
      } else show = false;
      overlay.hidden = !show;
    };

    const drawScores = () => {
      const g = s.game!;
      scores.replaceChildren();
      const ranked = standings(g);
      for (const pl of ranked) {
        const li = h(
          "li",
          { class: `dg-score${pl.p === s.p ? " dg-score-me" : ""}${pl.m === null ? " dg-score-away" : ""}`, "data-player": pl.name },
          avatar(pl),
          h("span", { class: "dg-score-name" }, pl.name, pl.p === g.drawer ? h("span", { class: "dg-pencil-mini", "aria-hidden": "true" }, " ✏️") : "", pl.p === s.hostPlayer ? h("span", { class: "dg-crown", title: t(W.host), "aria-label": t(W.host) }, " 👑") : "", pl.m === null ? h("span", { class: "dg-tag" }, t(W.awayTag)) : ""),
          h("b", { class: "dg-score-n", "data-testid": "score" }, String(pl.score)),
        );
        scores.append(li);
      }
    };

    const feedLine = (item: FeedItem): HTMLElement => {
      switch (item.kind) {
        case "guess": {
          const pl = s.game ? playerOf(s.game, item.p) : undefined;
          const who = h("b", {}, s.nameOf(item.p));
          if (pl) who.style.setProperty("--dg-hue", String(hueOf(pl.p)));
          return h("li", { class: "dg-line" }, who, " ", item.text);
        }
        case "close":
          return h("li", { class: "dg-line dg-line-close" }, t(W.close, { text: item.text }));
        case "got":
          return h("li", { class: "dg-line dg-line-got" }, "🎉 ", t(item.p === s.p ? W.gotYou : W.got, { name: s.nameOf(item.p) }));
        case "joined":
          return h("li", { class: "dg-line dg-line-quiet" }, t(W.joined, { name: item.name }));
        case "left":
          return h("li", { class: "dg-line dg-line-quiet" }, t(W.left, { name: item.name }));
      }
    };
    const drawFeed = () => {
      feed.replaceChildren(...s.feed.map(feedLine), ...[...s.pending.values()].map((text) => h("li", { class: "dg-line dg-line-pending" }, h("b", {}, s.name), " ", text)));
      feed.scrollTop = feed.scrollHeight;
    };

    const drawRoles = () => {
      const g = s.game!;
      const drawing = s.isDrawer;
      section.classList.toggle("dg-drawing", drawing);
      tools.hidden = !drawing;
      guessForm.hidden = drawing;
      drawerNote.hidden = !(drawing && g.phase === "draw");
      const can = s.canGuess;
      guessIn.disabled = !can;
      guessBtn.disabled = !can;
      roundEl.textContent = g.round ? t(W.round, { n: g.round, total: g.rounds }) : "";
      board.setInput(
        s.canDraw
          ? {
              down: (x, y) => s.penDown(pen.color, pen.size, x, y),
              move: (pts) => s.penMove(pts),
              up: () => s.penUp(),
            }
          : null,
      );
      undo.disabled = clear.disabled = !s.canDraw;
    };

    swap(section, () => {
      clearInterval(clock);
      ro.disconnect();
      globalThis.removeEventListener("resize", layout);
      board.destroy();
      probe.remove();
    });

    let lastTurn = -1;
    const update = (change: string) => {
      const g = s.game;
      if (!g) return;
      if (change === "sketch") return board.show(s.sketch);
      if (change === "feed") return drawFeed();
      drawRoles();
      drawWord();
      drawOverlay();
      drawScores();
      drawFeed();
      drawClock();
      board.show(s.sketch);
      layout();
      if (g.turn !== lastTurn) {
        lastTurn = g.turn;
        if (s.canGuess) guessIn.focus({ preventScroll: true });
      }
      if (g.phase === "draw" && s.canGuess && document.activeElement === document.body) guessIn.focus({ preventScroll: true });
    };
    update("game");
    // Coming from the lobby, the page may be scrolled to where Start was: bring the game's top into view.
    strip.scrollIntoView({ block: "nearest" });
    return { update };
  };

  // ---- the end ----

  const showFinal = (s: Session, g: Game) => {
    const ranked = standings(g);
    const best = ranked[0]?.score ?? 0;
    const winners = ranked.filter((x) => x.score === best);
    const head = winners.length > 1 && best > 0 ? t(W.tie) : winners[0]?.p === s.p ? t(W.winnerYou) : t(W.winner, { name: winners[0]?.name ?? "?" });
    const podium = h("ol", { class: "dg-podium" });
    ranked.slice(0, 3).forEach((pl, i) => {
      podium.append(h("li", { class: `dg-step dg-step-${i + 1}`, style: `--dg-i:${i}` }, avatar(pl, "dg-avatar-big"), h("span", { class: "dg-step-name" }, pl.name), h("b", {}, t(W.pts, { n: pl.score })), h("span", { class: "dg-step-block" }, ["🥇", "🥈", "🥉"][i]!)));
    });
    const rest = h("ol", { class: "dg-rest", start: "4" }, ...ranked.slice(3).map((pl) => h("li", {}, avatar(pl), h("span", {}, pl.name), h("b", {}, String(pl.score)))));
    const again = s.isHost
      ? on(h("button", { class: "dg-btn dg-btn-go", type: "button" }, h("span", { "aria-hidden": "true" }, "🔁"), t(W.playAgain)), "click", () => s.playAgain())
      : h("p", { class: "dg-note" }, t(W.waitAgain, { name: s.nameOf(s.hostPlayer) }));
    const leave = on(h("button", { class: "dg-btn dg-btn-quiet", type: "button" }, t(W.leave)), "click", () => s.leave());
    const node = h("section", { class: "dg-final", "aria-labelledby": "dg-final-title" }, h("p", { class: "dg-label" }, t(W.finalTitle)), h("h2", { id: "dg-final-title", class: "dg-title" }, head), podium, ranked.length > 3 ? rest : "", h("div", { class: "dg-row dg-final-acts" }, again, leave, soundBtn));
    swap(node);
    requestAnimationFrame(() => confetti(root));
  };

  // ---- start ----

  // Sounds are off on every visit until the switch is tapped: browsers play audio only after a tap.
  void ctx.storage.get<string>(PREF_NAME).catch(() => null).then((savedName) => {
    if (!alive) return;
    const fromMe = ctx.me?.name ?? "";
    name = typeof savedName === "string" && savedName ? savedName : DEFAULT_NAMES.has(fromMe.trim().toLowerCase()) ? "" : fromMe;
    if (current && current.status !== "ended") follow(current);
    else showStart();
  });

  return () => {
    alive = false;
    unsubscribe?.();
    teardownScreen?.();
    root.remove();
    style.remove();
  };
}
