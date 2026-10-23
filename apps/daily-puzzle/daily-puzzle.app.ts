// Potyro Daily — one colour code a day, the same for everyone. Five gems, seven colours (repeats
// allowed), six tries; each guess is told, gem by gem, what Wordle tells a letter: right place, in
// the code elsewhere, or not in it. When it is cracked (or not), the result goes out as the grid
// everyone recognises — "Potyro Daily #12 4/6" and the squares — through `ctx.ui.share`.
//
// No server: the code is a pure function of the puzzle number, and the number is the person's own
// calendar date (puzzle.ts). No words to guess, so it plays the same in all six languages. A day in
// progress lives in `ctx.storage` (close the app and come back to the same board); a finished day is a
// `game` record, which is where the stats and the streak come from. Drawn in plain DOM: the gems are
// CSS, the flips and the burst are transforms, so it stays smooth on a phone and works offline.
//
// In six languages (#303); every language but English is a model's draft (#297). Its words are in
// words.ts, said through `ctx.t`; dates go through `ctx.format`.
import { defineApp } from "potyro";
import type { Ctx, Resolved, ViewProps, Words } from "potyro";
import { gemElement } from "./gems.js";
import {
  COLOURS,
  countdown,
  dailyCode,
  feedback,
  LENGTH,
  nextPuzzleAt,
  outcome,
  paletteHints,
  puzzleDate,
  puzzleNumber,
  rng,
  codeFrom,
  shareText,
  squares,
  stats,
  TRIES,
  validGame,
  type Game,
  type Mark,
  type Played,
} from "./puzzle.js";
import { STYLES } from "./styles.js";
import { GEM_NAMES, W } from "./words.js";

// ---- small helpers ----

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const wait = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const markWords = (m: Mark | undefined, ctx: Ctx): string => ctx.t(m === "exact" ? W.exact : m === "present" ? W.present : m === "absent" ? W.absent : W.untried);
const gemName = (c: number, ctx: Ctx) => ctx.t(GEM_NAMES[c]!);

const PREFS = "prefs";
const dayKey = (n: number) => `game:${n}`;
interface Prefs {
  contrast?: boolean;
  seenHelp?: boolean;
}

/** Finished days, from the records. */
const playedFrom = (rows: Resolved[]): Played[] =>
  rows.map((r) => ({ number: Number(r.number), won: r.won === true, guesses: Number(r.guesses) || TRIES })).filter((p) => Number.isInteger(p.number));

// ---- the stats card, on Today (wide screens) and on Stats ----

function statsCard(ctx: Ctx, played: Played[], today: number, highlight?: number): HTMLElement {
  const s = stats(played, today);
  const card = h("section", { class: "dp-card", "aria-labelledby": "dp-stats-title" }, h("h3", { id: "dp-stats-title" }, ctx.t(W.statsTitle)));
  if (!s.played) {
    card.append(h("p", { class: "dp-empty" }, ctx.t(W.noStats)));
    return card;
  }
  const stat = (value: number | string, label: Words) => h("div", {}, h("dd", {}, String(value)), h("dt", {}, ctx.t(label)));
  card.append(h("dl", { class: "dp-stats" }, stat(s.played, W.played), stat(s.winRate, W.winRate), stat(s.streak, W.streak), stat(s.best, W.best)));
  card.append(h("h3", {}, ctx.t(W.spreadTitle)));
  const top = Math.max(1, ...s.spread);
  const list = h("ul", { class: "dp-spread" });
  s.spread.forEach((count, i) => {
    const bar = h("span", { class: "dp-bar" }, String(count));
    bar.style.width = `${Math.max(8, (count / top) * 100)}%`;
    bar.style.animationDelay = `${i * 60}ms`;
    const li = h("li", { "aria-label": ctx.t(W.spreadBar, { n: count, g: i + 1 }) }, h("span", { "aria-hidden": "true" }, String(i + 1)), bar);
    if (highlight === i + 1) li.dataset.today = "true";
    list.append(li);
  });
  card.append(list);
  return card;
}

// ---- Today ----

function mountToday(el: HTMLElement, props: ViewProps): () => void {
  const fresh = () => props.runtime.ctx; // a getter: its clock is now, not when the page opened
  const ctx = fresh();
  const style = h("style", {}, STYLES);
  const root = h("div", { class: "dp" });
  el.append(style, root);

  // ---- state ----
  let n = puzzleNumber(ctx.today());
  let code: number[] = dailyCode(n);
  let practice = false;
  let game: Game = { guesses: [] };
  let current: Array<number | null> = Array.from({ length: LENGTH }, () => null);
  let cursor = 0;
  let busy = false;
  /** Check was pressed while the last guess was still turning over: run it once that is done. */
  let checkAfter = false;
  let prefs: Prefs = {};
  let played: Played[] = [];
  let alive = true;

  // ---- the frame ----
  const kicker = h("p", { class: "dp-kicker" });
  const number = h("h2", { class: "dp-number" });
  const flame = h("span", { class: "dp-flame", role: "status" });
  const helpBtn = h("button", { class: "dp-icon", type: "button", "aria-label": ctx.t(W.help), title: ctx.t(W.help) }, "?");
  const head = h("header", { class: "dp-head" }, h("div", {}, kicker, number), h("div", { class: "dp-tools" }, flame, helpBtn));
  const practiceBar = h("div", { class: "dp-practice-bar", hidden: "" });
  const board = h("div", { class: "dp-board", role: "group", "aria-label": ctx.t(W.board) });
  const rows: HTMLElement[] = [];
  const cells: HTMLButtonElement[][] = [];
  for (let r = 0; r < TRIES; r++) {
    const row = h("div", { class: "dp-row", role: "group", "aria-label": ctx.t(W.row, { n: r + 1, of: TRIES }) });
    const rowCells: HTMLButtonElement[] = [];
    for (let c = 0; c < LENGTH; c++) {
      const cell = h("button", { class: "dp-cell", type: "button", tabindex: "-1" });
      cell.addEventListener("click", () => {
        if (r !== game.guesses.length || finished()) return;
        cursor = c;
        paintRow(r);
      });
      rowCells.push(cell);
      row.append(cell);
    }
    rows.push(row);
    cells.push(rowCells);
    board.append(row);
  }
  const live = h("p", { class: "dp-live", "aria-live": "polite" });
  const line = h("p", { class: "dp-toastline", "aria-hidden": "true" });

  const keys = Array.from({ length: COLOURS }, (_, c) => {
    const k = h("button", { class: "dp-key", type: "button", "data-colour": String(c) }, gemElement(c));
    k.addEventListener("click", () => place(c));
    return k;
  });
  const removeBtn = h("button", { class: "dp-btn", type: "button", "aria-label": ctx.t(W.remove) }, "⌫");
  const checkBtn = h("button", { class: "dp-btn dp-primary", type: "button" }, ctx.t(W.check));
  removeBtn.addEventListener("click", () => remove());
  checkBtn.addEventListener("click", () => void check());
  const pad = h(
    "div",
    { class: "dp-pad" },
    h("div", { class: "dp-keys", role: "group", "aria-label": ctx.t(W.palette) }, ...keys),
    h("div", { class: "dp-actions" }, removeBtn, checkBtn),
  );
  const done = h("section", { class: "dp-done", hidden: "", "aria-live": "polite" });
  const play = h("div", { class: "dp-play" }, head, practiceBar, board, line, live, pad, done);
  const side = h("aside", { class: "dp-side" });
  root.append(h("div", { class: "dp-wrap" }, play, side));

  const finished = () => outcome(game, code) !== "playing";
  const say = (text: string, visible = true) => {
    live.textContent = text;
    line.textContent = visible ? text : "";
  };
  const buzz = (pattern: number | number[]) => void fresh().caps.haptics?.vibrate(pattern).catch(() => undefined);

  // ---- painting ----
  const setGem = (cell: HTMLElement, colour: number | null, pop = false) => {
    const had = cell.querySelector(".dp-gem");
    if (colour === null) {
      had?.remove();
      return;
    }
    if (had && (had as HTMLElement).dataset.colour === String(colour)) return;
    const gem = gemElement(colour);
    gem.dataset.colour = String(colour);
    if (pop && !reducedMotion()) gem.classList.add("dp-pop");
    had ? had.replaceWith(gem) : cell.prepend(gem);
  };
  const setMark = (cell: HTMLElement, mark: Mark | undefined) => {
    cell.querySelector(".dp-badge")?.remove();
    if (!mark) {
      delete cell.dataset.mark;
      return;
    }
    cell.dataset.mark = mark;
    if (mark !== "absent") cell.append(h("span", { class: "dp-badge", "aria-hidden": "true" }, mark === "exact" ? "✓" : "↔"));
  };

  const paintRow = (r: number) => {
    const now = r === game.guesses.length && !finished();
    rows[r]!.dataset.now = String(now);
    // A finished board keeps only the rows it used, so the result sits right under it.
    rows[r]!.hidden = finished() && r >= game.guesses.length;
    const guess = game.guesses[r];
    const marks = guess ? feedback(guess, code) : undefined;
    cells[r]!.forEach((cell, c) => {
      const colour = guess ? guess[c]! : now ? current[c]! : null;
      setGem(cell, colour ?? null);
      setMark(cell, marks?.[c]);
      cell.tabIndex = now ? 0 : -1;
      if (now) cell.setAttribute("aria-pressed", String(c === cursor));
      else cell.removeAttribute("aria-pressed");
      const what = colour === null || colour === undefined ? ctx.t(W.empty) : marks ? `${gemName(colour, ctx)}, ${markWords(marks[c], ctx)}` : gemName(colour, ctx);
      cell.setAttribute("aria-label", ctx.t(W.slot, { n: c + 1, what }));
      cell.disabled = !now;
    });
  };
  const paintKeys = () => {
    const hints = paletteHints(game.guesses, code);
    keys.forEach((k, c) => {
      const hint = hints[c];
      if (hint) k.dataset.hint = hint;
      else delete k.dataset.hint;
      k.setAttribute("aria-label", `${gemName(c, ctx)}, ${markWords(hint, ctx)}`);
      k.title = gemName(c, ctx);
    });
  };
  const paintHead = () => {
    root.classList.toggle("dp-contrast", prefs.contrast === true);
    kicker.textContent = ctx.t(practice ? W.practiceKicker : W.kicker);
    const when = ctx.format.date(puzzleDate(n), { weekday: "long", day: "numeric", month: "long" });
    number.replaceChildren(practice ? "∞" : `#${n}`, h("small", {}, practice ? ctx.t(W.practiceNote) : when));
    number.setAttribute("aria-label", practice ? ctx.t(W.practice) : `${ctx.t(W.numberLabel, { n })}, ${when}`);
    const s = stats(played, n);
    flame.textContent = `🔥 ${s.streak}`;
    flame.dataset.cold = String(s.streak === 0);
    flame.setAttribute("aria-label", ctx.t(W.streakChip, { n: s.streak }));
    flame.title = ctx.t(W.streakChip, { n: s.streak });
    practiceBar.hidden = !practice;
    if (practice) {
      const back = h("button", { class: "dp-btn dp-quiet", type: "button" }, ctx.t(W.backToToday));
      back.addEventListener("click", () => void openDay(puzzleNumber(fresh().today())));
      practiceBar.replaceChildren(h("span", {}, ctx.t(W.practiceNote)), back);
    }
  };
  const paintSide = () => {
    const wide = window.matchMedia?.("(min-width: 960px)").matches ?? false;
    side.hidden = !wide;
    if (!wide) return;
    const legend = h(
      "ul",
      { class: "dp-legend" },
      ...(["exact", "present", "absent"] as const).map((m) => {
        const cell = h("span", { class: "dp-cell" });
        setGem(cell, m === "exact" ? 4 : m === "present" ? 0 : 2);
        setMark(cell, m);
        return h("li", {}, cell, ctx.t(m === "exact" ? W.legendExact : m === "present" ? W.legendPresent : W.legendAbsent));
      }),
    );
    side.replaceChildren(
      statsCard(ctx, played, n, !practice && outcome(game, code) === "won" ? game.guesses.length : undefined),
      h("section", { class: "dp-card" }, h("h3", {}, ctx.t(W.help)), h("p", { class: "dp-howto" }, ctx.t(W.rules1)), legend, h("p", { class: "dp-howto" }, ctx.t(W.rules2))),
    );
  };
  const paintAll = () => {
    for (let r = 0; r < TRIES; r++) paintRow(r);
    paintKeys();
    paintHead();
    paintSide();
    const over = finished();
    pad.hidden = over;
    checkBtn.classList.toggle("dp-wait", current.some((c) => c === null));
    if (over) showDone(false);
    else done.hidden = true;
  };

  // ---- input ----
  // Placing and removing work while a guess turns over, into the next row: fast fingers lose nothing.
  const place = (colour: number) => {
    if (finished()) return;
    current[cursor] = colour;
    const r = game.guesses.length;
    setGem(cells[r]![cursor]!, colour, true);
    const nextEmpty = current.findIndex((c, i) => i > cursor && c === null);
    const firstEmpty = current.indexOf(null);
    cursor = nextEmpty >= 0 ? nextEmpty : firstEmpty >= 0 ? firstEmpty : Math.min(LENGTH - 1, cursor + 1);
    buzz(6);
    paintRow(r);
    checkBtn.classList.toggle("dp-wait", current.some((c) => c === null));
  };
  const remove = () => {
    if (finished()) return;
    const r = game.guesses.length;
    if (current[cursor] === null && cursor > 0) cursor--;
    else if (current[cursor] === null) {
      const last = current.map((c, i) => (c === null ? -1 : i)).filter((i) => i >= 0).pop();
      if (last === undefined) return;
      cursor = last;
    }
    current[cursor] = null;
    paintRow(r);
    checkBtn.classList.add("dp-wait");
  };

  const save = () => (practice ? Promise.resolve() : fresh().storage.set(dayKey(n), game).catch(() => undefined));

  const check = async (): Promise<void> => {
    if (finished()) return;
    if (busy) {
      checkAfter = true;
      return;
    }
    const r = game.guesses.length;
    if (current.some((c) => c === null)) {
      say(ctx.t(W.needFive));
      rows[r]!.classList.remove("dp-shake");
      void rows[r]!.offsetWidth;
      rows[r]!.classList.add("dp-shake");
      buzz([24, 40, 24]);
      return;
    }
    busy = true;
    const guess = current.map((c) => c!);
    const marks = feedback(guess, code);
    game = { guesses: [...game.guesses, guess] };
    current = Array.from({ length: LENGTH }, () => null);
    cursor = 0;
    void save();
    await reveal(r, guess, marks);
    if (!alive) return;
    const result = outcome(game, code);
    const exact = marks.filter((m) => m === "exact").length;
    const present = marks.filter((m) => m === "present").length;
    if (result === "playing") say(`${ctx.t(W.told, { exact, present })} · ${ctx.t(W.triesLeft, { n: TRIES - game.guesses.length })}`);
    else say("", false);
    busy = false;
    if (result !== "playing") await finish(result === "won");
    else paintAll();
    if (checkAfter && alive) {
      checkAfter = false;
      await check();
    }
  };

  const reveal = async (r: number, guess: number[], marks: Mark[]) => {
    rows[r]!.dataset.now = "false";
    const still = reducedMotion();
    const step = still ? 0 : 230;
    cells[r]!.forEach((cell, c) => {
      setGem(cell, guess[c]!);
      cell.disabled = true;
      cell.removeAttribute("aria-pressed");
      if (still) {
        setMark(cell, marks[c]);
        return;
      }
      setTimeout(() => {
        cell.classList.remove("dp-flip");
        void cell.offsetWidth;
        cell.classList.add("dp-flip");
      }, c * step);
      setTimeout(() => {
        setMark(cell, marks[c]);
        if (marks[c] === "exact") buzz(10);
      }, c * step + 260);
    });
    paintKeysLater(still ? 0 : (LENGTH - 1) * step + 520);
    await wait(still ? 0 : (LENGTH - 1) * step + 560);
    cells[r]!.forEach((cell) => cell.classList.remove("dp-flip"));
  };
  const paintKeysLater = (ms: number) => setTimeout(() => alive && paintKeys(), ms);

  // ---- the end of a day ----
  const finish = async (won: boolean) => {
    if (won && !reducedMotion()) {
      const r = game.guesses.length - 1;
      cells[r]!.forEach((cell, c) => setTimeout(() => cell.classList.add("dp-hop"), c * 90));
      burst();
      buzz([18, 50, 18, 50, 40]);
      await wait(700);
      cells[r]!.forEach((cell) => cell.classList.remove("dp-hop"));
    } else if (!won) buzz([40, 60, 40]);
    if (!practice) await record(won);
    if (alive) paintAll();
    if (alive) showDone(true);
  };

  const record = async (won: boolean) => {
    const c = fresh();
    const existing = await c.query("game", { filter: (g) => Number(g.number) === n }).catch(() => []);
    if (existing.length) return;
    const grid = game.guesses.map((g) => squares(feedback(g, code))).join("\n");
    await c.create("game", { number: n, date: puzzleDate(n), won, guesses: game.guesses.length, grid }).catch(() => undefined);
    // Counted now, not when the records come back round: the streak under the result is today's.
    played = [...played.filter((p) => p.number !== n), { number: n, won, guesses: game.guesses.length }];
  };

  const burst = () => {
    const spray = h("div", { class: "dp-burst", "aria-hidden": "true" });
    board.append(spray);
    const random = rng(n * 7919 + game.guesses.length);
    for (let i = 0; i < 34; i++) {
      const gem = gemElement(i % COLOURS);
      spray.append(gem);
      const angle = random() * Math.PI * 2;
      const reach = 90 + random() * 170;
      const dx = Math.cos(angle) * reach;
      const dy = Math.sin(angle) * reach * 0.8;
      const spin = (random() - 0.5) * 720;
      gem.animate(
        [
          { transform: "translate(0, 0) scale(0.3)", opacity: 1 },
          { transform: `translate(${dx * 0.7}px, ${dy * 0.7 - 40}px) rotate(${spin * 0.6}deg) scale(1.15)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px, ${dy + 120}px) rotate(${spin}deg) scale(0.7)`, opacity: 0 },
        ],
        { duration: 1100 + random() * 500, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "forwards" },
      );
    }
    setTimeout(() => spray.remove(), 1800);
  };

  let ticker = 0;
  const showDone = (focus: boolean) => {
    const won = outcome(game, code) === "won";
    const s = stats(played, n);
    const used = game.guesses.length;
    const title = won ? ctx.t(W.wonIn, { n: used }) : ctx.t(W.lost);
    const sub = won ? `${ctx.t(W.praise[Math.min(used, W.praise.length) - 1]!)}${practice ? "" : ` ${ctx.t(W.streakSub, { n: s.streak })}`}` : ctx.t(W.lostSub);
    const kids: Node[] = [h("h3", { tabindex: "-1" }, title), h("p", { class: "dp-sub" }, sub)];
    if (!won) kids.push(h("div", { class: "dp-answer" }, h("span", {}, ctx.t(W.theCode)), h("span", { class: "dp-gems", role: "img", "aria-label": code.map((c) => gemName(c, ctx)).join(", ") }, ...code.map((c) => gemElement(c)))));
    const text = shareText(n, game, code, { contrast: prefs.contrast });
    if (practice) {
      const again = h("button", { class: "dp-btn dp-primary", type: "button" }, ctx.t(W.another));
      again.addEventListener("click", () => startPractice());
      const back = h("button", { class: "dp-btn", type: "button" }, ctx.t(W.backToToday));
      back.addEventListener("click", () => void openDay(puzzleNumber(fresh().today())));
      kids.push(h("div", { class: "dp-actions" }, back, again));
    } else {
      kids.push(h("pre", { class: "dp-grid-preview", "aria-hidden": "true" }, text.split("\n").slice(1).join("\n")));
      const share = h("button", { class: "dp-btn dp-share", type: "button" }, `↗  ${ctx.t(W.share)}`);
      share.addEventListener("click", async () => {
        const sent = await fresh().ui.share({ title: W.shareTitle, text });
        if (sent) {
          say(ctx.t(W.shared));
          buzz(12);
        }
      });
      const next = h("b", {}, countdown(fresh().now(), nextPuzzleAt(fresh().now())));
      const nextRow = h("div", { class: "dp-next" }, h("span", {}, ctx.t(W.next)), next);
      const train = h("button", { class: "dp-btn dp-quiet", type: "button" }, `↻  ${ctx.t(W.practice)}`);
      train.addEventListener("click", () => startPractice());
      kids.push(share, nextRow, train);
      clearInterval(ticker);
      ticker = window.setInterval(() => {
        const now = fresh().now();
        if (puzzleNumber(now) !== n) {
          clearInterval(ticker);
          const go = h("button", { class: "dp-btn dp-primary", type: "button" }, ctx.t(W.playNew));
          go.addEventListener("click", () => void openDay(puzzleNumber(fresh().today())));
          nextRow.replaceChildren(h("span", {}, ctx.t(W.newReady)), go);
          return;
        }
        next.textContent = countdown(now, nextPuzzleAt(now));
      }, 1000);
    }
    done.replaceChildren(...kids);
    done.hidden = false;
    if (focus) {
      (done.querySelector("h3") as HTMLElement | null)?.focus({ preventScroll: true });
      done.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
    }
  };

  // ---- days and practice ----
  const reset = () => {
    current = Array.from({ length: LENGTH }, () => null);
    cursor = 0;
    busy = false;
    checkAfter = false;
    clearInterval(ticker);
    say("", false);
  };
  const openDay = async (day: number) => {
    practice = false;
    n = day;
    code = dailyCode(n);
    reset();
    const kept = await fresh().storage.get<Game>(dayKey(n)).catch(() => null);
    if (!alive) return;
    game = validGame(kept) ? kept : { guesses: [] };
    paintAll();
  };
  const startPractice = () => {
    practice = true;
    code = codeFrom(rng((Date.now() ^ (Math.random() * 1e9)) >>> 0));
    game = { guesses: [] };
    reset();
    paintAll();
    cells[0]![0]!.focus();
  };

  // ---- help ----
  const openHelp = () => {
    const opener = document.activeElement as HTMLElement | null;
    const example = (guess: number[], marks: Mark[]) => {
      const row = h("div", { class: "dp-example", "aria-hidden": "true" });
      guess.forEach((g, i) => {
        const cell = h("span", { class: "dp-cell" });
        setGem(cell, g);
        setMark(cell, marks[i]);
        row.append(cell);
      });
      return row;
    };
    const contrast = h("input", { type: "checkbox", role: "switch", id: "dp-contrast" });
    contrast.checked = prefs.contrast === true;
    contrast.addEventListener("change", () => {
      prefs = { ...prefs, contrast: contrast.checked };
      void fresh().storage.set(PREFS, prefs).catch(() => undefined);
      root.classList.toggle("dp-contrast", contrast.checked);
      box.classList.toggle("dp-contrast", contrast.checked);
    });
    const go = h("button", { class: "dp-btn dp-primary", type: "button" }, ctx.t(W.letsGo));
    const legend = h(
      "ul",
      { class: "dp-legend" },
      h("li", {}, example([4], ["exact"]).firstChild!, ctx.t(W.legendExact)),
      h("li", {}, example([0], ["present"]).firstChild!, ctx.t(W.legendPresent)),
      h("li", {}, example([2], ["absent"]).firstChild!, ctx.t(W.legendAbsent)),
    );
    const card = h(
      "div",
      { class: "dp-dialog-card" },
      h("h2", { id: "dp-help-title" }, ctx.t(W.help)),
      h("p", { class: "dp-howto" }, ctx.t(W.rules1)),
      example([4, 0, 2, 4, 6], ["exact", "present", "absent", "absent", "exact"]),
      legend,
      h("p", { class: "dp-howto" }, ctx.t(W.rules2)),
      h("label", { class: "dp-switch", for: "dp-contrast" }, h("span", {}, ctx.t(W.contrast)), contrast),
      go,
    );
    const box = h("div", { class: `dp dp-dialog${prefs.contrast ? " dp-contrast" : ""}`, role: "dialog", "aria-modal": "true", "aria-labelledby": "dp-help-title" }, card);
    const close = () => {
      box.remove();
      document.removeEventListener("keydown", onKey, true);
      prefs = { ...prefs, seenHelp: true };
      void fresh().storage.set(PREFS, prefs).catch(() => undefined);
      opener?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
      if (e.key === "Tab") {
        // Keep Tab inside the dialog: it has two stops.
        const stops = [contrast, go];
        const at = stops.indexOf(document.activeElement as never);
        e.preventDefault();
        stops[(at + (e.shiftKey ? stops.length - 1 : 1)) % stops.length]!.focus();
      }
    };
    box.addEventListener("click", (e) => e.target === box && close());
    go.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    box.prepend(h("style", {}, STYLES));
    document.body.append(box);
    go.focus();
  };
  helpBtn.addEventListener("click", openHelp);

  // ---- keys: 1–7 place a colour, Backspace removes, Enter checks, arrows move ----
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".dp-dialog, .k-modal-scrim")) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (finished()) return;
    const digit = Number(e.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= COLOURS) {
      e.preventDefault();
      place(digit - 1);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      remove();
    } else if (e.key === "Enter" && !(t instanceof HTMLButtonElement && !t.classList.contains("dp-cell"))) {
      e.preventDefault();
      void check();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      cursor = Math.max(0, Math.min(LENGTH - 1, cursor + (e.key === "ArrowLeft" ? -1 : 1)));
      paintRow(game.guesses.length);
      if (t?.classList.contains("dp-cell")) cells[game.guesses.length]![cursor]!.focus();
    }
  };
  document.addEventListener("keydown", onKey);
  const wide = window.matchMedia?.("(min-width: 960px)");
  const onWide = () => paintSide();
  wide?.addEventListener("change", onWide);

  // ---- start: preferences, the day's board, and the records ----
  const stop = props.runtime.watchQuery("game", undefined, ({ rows: games, loading }) => {
    if (loading || !alive) return;
    played = playedFrom(games);
    paintHead();
    paintSide();
  });
  void (async () => {
    prefs = (await fresh().storage.get<Prefs>(PREFS).catch(() => null)) ?? {};
    if (!alive) return;
    await openDay(n);
    if (alive && !prefs.seenHelp && game.guesses.length === 0) openHelp();
  })();

  return () => {
    alive = false;
    stop();
    clearInterval(ticker);
    document.removeEventListener("keydown", onKey);
    wide?.removeEventListener("change", onWide);
    document.querySelectorAll(".dp-dialog").forEach((d) => d.remove());
    root.remove();
    style.remove();
  };
}

// ---- Stats ----

function mountStats(el: HTMLElement, props: ViewProps): () => void {
  const ctx = props.runtime.ctx;
  const style = h("style", {}, STYLES);
  const root = h("div", { class: "dp" });
  el.append(style, root);
  const stop = props.runtime.watchQuery("game", undefined, ({ rows, loading }) => {
    if (loading) return;
    const played = playedFrom(rows);
    const today = puzzleNumber(props.runtime.ctx.today());
    const recent = [...rows].sort((a, b) => Number(b.number) - Number(a.number)).slice(0, 30);
    const past = h("section", { class: "dp-card" }, h("h3", {}, ctx.t(W.pastTitle)));
    if (recent.length) {
      past.append(
        h(
          "ul",
          { class: "dp-past" },
          ...recent.map((r) => {
            const when = ctx.format.date(puzzleDate(Number(r.number)), { day: "numeric", month: "short" });
            const score = r.won === true ? `${r.guesses}/${TRIES}` : `X/${TRIES}`;
            return h("li", {}, h("span", {}, h("b", {}, ctx.t(W.pastLine, { n: Number(r.number), when })), ` · ${score}`), h("span", { "aria-hidden": "true" }, String(r.grid ?? "")));
          }),
        ),
      );
    } else past.append(h("p", { class: "dp-empty" }, ctx.t(W.noStats)));
    root.replaceChildren(h("div", { class: "dp-side", style: "max-width: 34rem; margin: 0 auto;" }, statsCard(ctx, played, today), past));
  });
  return () => {
    stop();
    root.remove();
    style.remove();
  };
}

// ---- the app ----

export default defineApp({
  id: "daily-puzzle",
  name: W.appName,
  icon: "puzzle",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#6b4fd8" },
  nav: "tabs",
  // A game is a result, never something to add by hand.
  quickActions: [],
  permissions: { haptics: true },
  entities: {
    game: {
      label: W.game,
      displayField: "number",
      fields: {
        number: { type: "number", required: true, integer: true, min: 1, label: W.fNumber },
        date: { type: "datetime", precision: "day", label: W.fDate },
        won: { type: "boolean", label: W.fWon },
        guesses: { type: "number", integer: true, min: 1, max: TRIES, label: W.fGuesses },
        grid: { type: "text", label: W.fGrid },
      },
    },
  },
  pages: [
    { id: "today", title: W.today, icon: "puzzle", view: { type: "custom", entity: "game", mount: mountToday } },
    { id: "stats", title: W.stats, icon: "chart-bar", view: { type: "custom", entity: "game", mount: mountStats } },
  ],
});
