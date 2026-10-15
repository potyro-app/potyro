// The Puzzles screen: make one from a photo, and every puzzle in the app — yours and the ones people
// sent — with the best time on each.
import type { FileRef, Resolved, ViewProps } from "potyro";
import { h, keepPuzzle, madeBy, photoUrl, reducedMotion, sendPuzzle, takePhoto } from "./common.js";
import { bests, clock, cut, LEVEL_IDS, LEVELS, outline, pieceCount, type LevelId, type Seg, type Solve } from "./jigsaw.js";
import { STYLES } from "./styles.js";
import { LEVEL_NAMES, W } from "./words.js";

/** A piece's outline as SVG path data, in a 100-unit square (with room for the knobs). */
function svgPath(segs: Seg[]): string {
  const p = (pt: [number, number]) => `${(pt[0] * 100).toFixed(1)} ${(pt[1] * 100).toFixed(1)}`;
  return `M0 0 ${segs.map((s) => ("c1" in s ? `C${p(s.c1)} ${p(s.c2)} ${p(s.to)}` : `L${p(s.to)}`)).join(" ")} Z`;
}

/** The welcome art: four real pieces (cut by jigsaw.ts), floating, in the app's colours. */
function heroArt(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "-40 -40 300 300");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("pp-art");
  const c = cut(LEVELS.easy, 7);
  const fills = ["url(#pp-g1)", "url(#pp-g2)", "url(#pp-g3)", "url(#pp-g4)"];
  // Static, known markup: gradients only.
  svg.innerHTML = `<defs>
    <linearGradient id="pp-g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a76"/><stop offset="1" stop-color="#e2557a"/></linearGradient>
    <linearGradient id="pp-g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#f29a3a"/></linearGradient>
    <linearGradient id="pp-g3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fd1c7"/><stop offset="1" stop-color="#3a8fb7"/></linearGradient>
    <linearGradient id="pp-g4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9a4ff"/><stop offset="1" stop-color="#6b4fd8"/></linearGradient>
  </defs>`;
  [
    [0, 0, 0, -6],
    [0, 1, 104, 4],
    [1, 0, -4, 104],
    [1, 1, 108, 98],
  ].forEach(([row, col, x, y], i) => {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", `pp-art-piece pp-art-${i}`);
    g.setAttribute("transform", `translate(${x} ${y})`);
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", svgPath(outline(c, row!, col!)));
    path.setAttribute("fill", fills[i]!);
    path.setAttribute("stroke", "rgba(255,255,255,0.55)");
    path.setAttribute("stroke-width", "2");
    g.append(path);
    svg.append(g);
  });
  return svg;
}

export function mountPuzzles(el: HTMLElement, props: ViewProps): () => void {
  const fresh = () => props.runtime.ctx;
  const ctx = fresh();
  const style = h("style", {}, STYLES);
  const root = h("div", { class: "pp" });
  el.append(style, root);
  let alive = true;
  const isAlive = () => alive;
  const urls = new Map<string, string>();
  let puzzles: Resolved[] = [];
  let solves: Solve[] = [];
  /** This device's own solves: its person's best times. */
  let mineOnly: Solve[] = [];
  let ready = { puzzles: false, solves: false };

  const chooseLevel = (r: Resolved) =>
    fresh().ui.sheet<LevelId>({
      title: W.chooseLevel,
      items: LEVEL_IDS.map((id) => {
        const best = bests(solves, String(r.id))[id];
        return {
          id,
          label: LEVEL_NAMES[id],
          detail: `${ctx.t(W.pieces, { n: pieceCount(LEVELS[id]) })}${best ? ` · ${ctx.t(W.bestLine, { time: clock(best.seconds) })}` : ""}`,
          icon: id === "easy" ? "🧩" : id === "medium" ? "🧩🧩" : "🧩🧩🧩",
        };
      }),
    });
  const play = async (r: Resolved) => {
    const level = await chooseLevel(r);
    if (level) props.navigate("play", { puzzle: String(r.id), level });
  };
  const make = async (source: "camera" | "library") => {
    const jpeg = await takePhoto(fresh(), source);
    if (!jpeg || !alive) return;
    const r = await keepPuzzle(fresh(), jpeg);
    if (r && alive) await play(r);
  };

  const takeBtn = () => {
    const b = h("button", { class: "pp-btn pp-primary", type: "button" }, `📷  ${ctx.t(W.take)}`);
    b.addEventListener("click", () => void make("camera"));
    return b;
  };
  const chooseBtn = () => {
    const b = h("button", { class: "pp-btn", type: "button" }, ctx.t(W.choose));
    b.addEventListener("click", () => void make("library"));
    return b;
  };

  const card = (r: Resolved): HTMLElement => {
    const who = madeBy(ctx, r);
    const mine = bests(mineOnly, String(r.id));
    const others = solves.filter((s) => s.puzzle === String(r.id) && !mineOnly.includes(s)).sort((a, b) => a.seconds - b.seconds);
    // The hardest level solved says the most.
    const best = [...LEVEL_IDS].reverse().map((id) => mine[id]).find((s): s is Solve => !!s);
    const bestText = best ? `${ctx.t(LEVEL_NAMES[best.level])} · ${ctx.t(W.bestLine, { time: clock(best.seconds) })}` : ctx.t(W.unsolved);
    const fig = h("div", { class: "pp-thumb" }, h("span", { class: "pp-thumb-wait" }, ctx.t(W.notHere)));
    const ref = r.photo as FileRef | undefined;
    const known = ref && urls.get(ref.id);
    const show = (url: string) => {
      const img = h("img", { src: url, alt: "", loading: "lazy", decoding: "async" });
      fig.replaceChildren(img);
    };
    if (known) show(known);
    else
      void photoUrl(fresh, ref, isAlive).then((url) => {
        if (!url || !alive) return;
        urls.set(ref!.id, url);
        show(url);
      });
    const open = h("button", { class: "pp-card-open", type: "button", "aria-label": ctx.t(W.open, { title: String(r.title ?? "") }) }, fig);
    open.addEventListener("click", () => void play(r));
    const more = h("button", { class: "pp-icon pp-more", type: "button", "aria-label": ctx.t(W.more, { title: String(r.title ?? "") }) }, "⋯");
    more.addEventListener("click", async () => {
      const pick = await fresh().ui.menu<"send" | "delete">({
        title: String(r.title ?? ""),
        items: [
          { id: "send", label: W.send, icon: "💌" },
          { id: "delete", label: W.delete, icon: "🗑", destructive: true },
        ],
      });
      if (pick === "send") await sendPuzzle(fresh(), best?.seconds);
      if (pick === "delete") {
        const sure = await fresh().ui.confirm(ctx.t(W.deleteAsk, { title: String(r.title ?? "") }), { detail: W.deleteDetail, ok: W.delete, destructive: true });
        if (!sure) return;
        for (const s of await fresh().query("solve", { filter: (x) => String((x.puzzle as Resolved | undefined)?.id ?? x.puzzle) === String(r.id) })) await fresh().delete("solve", String(s.id));
        if (ref) await fresh().files.remove(ref).catch(() => undefined);
        await fresh().delete("puzzle", String(r.id));
      }
    });
    const from = who.mine ? ctx.t(W.yours) : ctx.t(W.fromWho, { name: who.name });
    const meta = h(
      "div",
      { class: "pp-card-meta" },
      h("div", {}, h("b", {}, String(r.title ?? "")), h("span", { class: who.mine ? "" : "pp-from" }, from)),
      more,
    );
    const foot = h("p", { class: "pp-card-best" }, bestText);
    const kids: Node[] = [open, meta, foot];
    if (others[0]) kids.push(h("p", { class: "pp-card-others" }, `🏁 ${ctx.t(W.solvedBy, { name: others[0].by!, time: clock(others[0].seconds) })}`));
    return h("article", { class: `pp-card${who.mine ? "" : " pp-card-gift"}` }, ...kids);
  };

  const render = () => {
    if (!ready.puzzles || !ready.solves || !alive) return;
    const sorted = [...puzzles].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    const hero = h(
      "section",
      { class: `pp-hero${sorted.length ? " pp-hero-small" : ""}` },
      heroArt(),
      h("div", { class: "pp-hero-text" }, h("h2", {}, ctx.t(W.heroTitle)), h("p", {}, ctx.t(W.heroText)), h("div", { class: "pp-row" }, takeBtn(), chooseBtn())),
    );
    if (reducedMotion()) hero.classList.add("pp-still");
    const kids: Node[] = [hero];
    if (!sorted.length) {
      const step = (n: string, words: typeof W.step1) => h("li", {}, h("span", { class: "pp-step-n", "aria-hidden": "true" }, n), ctx.t(words));
      kids.push(h("ol", { class: "pp-steps" }, step("1", W.step1), step("2", W.step2), step("3", W.step3)));
    }
    if (sorted.length) {
      const mineBest = bests(mineOnly);
      const chips = LEVEL_IDS.filter((id) => mineBest[id]).map((id) => h("span", { class: "pp-chip" }, `${ctx.t(LEVEL_NAMES[id])} ${clock(mineBest[id]!.seconds)}`));
      if (chips.length) kids.push(h("div", { class: "pp-bests", "aria-label": ctx.t(W.bestsTitle) }, h("span", { class: "pp-bests-label" }, `🏆 ${ctx.t(W.bestsTitle)}`), ...chips));
      kids.push(h("div", { class: "pp-wall" }, ...sorted.map(card)));
    }
    root.replaceChildren(...kids);
  };

  const stopP = props.runtime.watchQuery("puzzle", undefined, ({ rows, loading }) => {
    if (loading) return;
    puzzles = rows;
    ready = { ...ready, puzzles: true };
    render();
  });
  const stopS = props.runtime.watchQuery("solve", undefined, ({ rows, loading }) => {
    if (loading) return;
    const me = fresh().me.id;
    const all = rows.map((r) => ({ solve: { puzzle: String((r.puzzle as Resolved | undefined)?.id ?? r.puzzle ?? ""), level: r.level as LevelId, seconds: Number(r.seconds), by: String(r.by ?? "") }, mine: !r.createdBy || r.createdBy === me }));
    solves = all.map((x) => x.solve);
    mineOnly = all.filter((x) => x.mine).map((x) => x.solve);
    ready = { ...ready, solves: true };
    render();
  });

  return () => {
    alive = false;
    stopP();
    stopS();
    root.remove();
    style.remove();
  };
}

