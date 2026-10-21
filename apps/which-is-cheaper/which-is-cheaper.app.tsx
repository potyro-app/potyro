// Which is cheaper — two prices and two sizes, and it says the cost per unit and which one wins: the
// thing everyone does badly in a shop aisle. One screen: a card per item (A, B, and a third when
// asked), each with a price, an amount and its unit; as soon as two are filled the answer appears,
// without a button — the price per 100 g, 100 ml or piece on each card, the cheaper card lit, and
// "15% cheaper" under it. Grams and kilograms compare, millilitres and litres compare; a weight
// against a volume says so instead of guessing.
//
// The arithmetic is compare.ts, plain functions with tests. What is typed is remembered in
// `ctx.storage`, so the app opens on the last comparison; Keep makes it a record, listed under Kept
// and reopened on the cards. Money is whole minor units (KA-26); the currency is the person's own
// guess from their locale, changeable at the top.
//
// In six languages (#303), in words.ts; every language but English is a model's draft (#297).
import { defineApp } from "potyro";
import type { Ctx, Resolved, ViewProps } from "potyro";
import { useEffect, useState } from "react";
import { compare, CURRENCIES, currencyFor, KIND, parseAmount, parseMoney, perShown, SHOWN_PER, UNITS, type Currency, type Item, type Unit, type Verdict } from "./compare.js";
import { W } from "./words.js";

const LETTERS = ["A", "B", "C"] as const;
const LAST = "last";

/** An item as it is typed: text in the boxes, so "4," stays "4," until it is a number. */
interface Draft {
  name: string;
  price: string;
  amount: string;
  unit: Unit;
}
interface Sheet {
  items: Draft[];
  currency: Currency;
}

const empty = (unit: Unit = "g"): Draft => ({ name: "", price: "", amount: "", unit });
const fresh = (currency: Currency): Sheet => ({ items: [empty(), empty()], currency });

/** The numbers behind a draft. */
const itemOf = (d: Draft): Item => ({ name: d.name.trim() || undefined, price: parseMoney(d.price), amount: parseAmount(d.amount), unit: d.unit });

/** What an item is called in a sentence: its name, else its letter. */
const called = (d: Draft | undefined, at: number): string => d?.name.trim() || LETTERS[at] || String(at + 1);

/** "€1.00 per 100 ml", "€0.50 each". */
function perText(d: Draft, currency: Currency, ctx: Ctx): string | null {
  const i = itemOf(d);
  if (i.price === null || i.amount === null) return null;
  const shown = SHOWN_PER[KIND[i.unit]];
  const money = ctx.format.money(perShown({ ...i, price: i.price, amount: i.amount }), currency);
  if (shown.unit === "pcs") return `${money} ${ctx.t(W.perPiece)}`;
  return `${money} ${ctx.t(W.per, { amount: shown.amount, unit: shown.unit })}`;
}

/** The one-line answer under the cards. */
function verdictText(sheet: Sheet, v: Verdict, ctx: Ctx): string {
  if (v.winner === null) return ctx.t(v.reason === "kinds" ? W.kinds : W.fillBoth);
  const winner = called(sheet.items[v.winner], v.winner);
  if (v.saving === 0) return ctx.t(W.verdictSame, { a: winner, b: called(sheet.items[v.order[1]!], v.order[1]!) });
  return ctx.t(W.verdict, { winner, saving: v.saving });
}

/** A kept comparison, back on the cards. */
function sheetOf(r: Resolved): Sheet {
  const items: Draft[] = [];
  for (const k of ["a", "b", "c"]) {
    const price = r[`${k}Price`];
    const amount = r[`${k}Amount`];
    if (k === "c" && typeof price !== "number") continue;
    items.push({
      name: typeof r[`${k}Name`] === "string" ? String(r[`${k}Name`]) : "",
      price: typeof price === "number" ? (price / 100).toFixed(2) : "",
      amount: typeof amount === "number" ? String(amount) : "",
      unit: UNITS.includes(r[`${k}Unit`] as Unit) ? (r[`${k}Unit`] as Unit) : "g",
    });
  }
  const currency = CURRENCIES.includes(r.currency as Currency) ? (r.currency as Currency) : "EUR";
  return { items, currency };
}

/** A kept comparison's verdict, for the Kept list and the tile. */
function keptVerdict(r: Resolved, ctx: Ctx): string {
  const sheet = sheetOf(r);
  return verdictText(sheet, compare(sheet.items.map(itemOf)), ctx);
}

const CSS = `
.wc { display: grid; gap: var(--space-3, 0.75rem); padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem) var(--space-6, 2rem); max-width: 40rem; margin: 0 auto; }
.wc-top { display: flex; justify-content: flex-end; align-items: center; gap: 0.5rem; color: var(--ink-soft); font-size: 0.9rem; }
.wc-top select { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 0.6rem; padding: 0.35rem 0.5rem; touch-action: manipulation; }
.wc-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2, 0.5rem); }
.wc-cards[data-count="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 420px) { .wc-cards[data-count="3"] { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.wc-card { position: relative; display: grid; gap: 0.45rem; padding: 0.65rem 0.6rem 0.7rem; border-radius: 1.1rem; background: var(--surface); border: 2px solid var(--line); transition: border-color 200ms, box-shadow 200ms; min-width: 0; }
.wc-card[data-wins="true"] { border-color: var(--accent); box-shadow: 0 10px 28px color-mix(in oklab, var(--accent) 25%, transparent); }
.wc-card[data-loses="true"] { opacity: 0.78; }
.wc-letter { display: inline-grid; place-items: center; width: 1.7rem; height: 1.7rem; border-radius: 999px; background: color-mix(in oklab, var(--ink) 8%, var(--surface)); color: var(--ink); font-weight: 800; font-size: 0.9rem; }
.wc-card[data-wins="true"] .wc-letter { background: var(--accent); color: var(--on-accent, #fff); }
.wc-head { display: flex; align-items: center; gap: 0.5rem; }
.wc-name { flex: 1; min-width: 0; text-overflow: ellipsis; border: 0; border-bottom: 1px dashed var(--line); background: transparent; color: var(--ink); font: inherit; font-size: 0.9rem; padding: 0.2rem 0; }
.wc-name::placeholder { color: var(--ink-soft); }
.wc-field { display: grid; gap: 0.2rem; min-width: 0; }
.wc-price, .wc-amount, .wc-head { min-width: 0; }
.wc-field label { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); }
.wc-price { display: flex; align-items: baseline; gap: 0.25rem; border: 1px solid var(--line); border-radius: 0.8rem; background: var(--paper); padding: 0.35rem 0.6rem; }
.wc-price span { color: var(--ink-soft); font-weight: 700; }
.wc-price input { flex: 1; min-width: 0; width: 100%; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 1.35rem; font-weight: 800; font-variant-numeric: tabular-nums; padding: 0; outline: 0; }
.wc-amount { display: grid; grid-template-columns: minmax(0, 1fr) minmax(3.1rem, auto); gap: 0.3rem; }
.wc-amount input { min-width: 0; width: 100%; border: 1px solid var(--line); border-radius: 0.8rem; background: var(--paper); color: var(--ink); font: inherit; font-size: 1.05rem; font-weight: 700; font-variant-numeric: tabular-nums; padding: 0.4rem 0.5rem; outline: 0; }
.wc-amount select { min-width: 0; font: inherit; font-size: 0.95rem; font-weight: 700; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 0.8rem; padding: 0 0.2rem; touch-action: manipulation; }
.wc-card input:focus, .wc-price:focus-within { border-color: var(--accent); }
.wc-per { min-height: 1.3rem; font-size: 0.95rem; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.wc-per[data-empty="true"] { color: var(--ink-soft); font-weight: 500; }
.wc-badge { justify-self: start; font-size: 0.78rem; font-weight: 800; padding: 0.2rem 0.55rem; border-radius: 999px; background: var(--accent); color: var(--on-accent, #fff); }
.wc-remove { flex: none; width: 1.6rem; height: 1.6rem; border: 0; border-radius: 999px; background: color-mix(in oklab, var(--ink) 8%, var(--surface)); color: var(--ink-soft); font: inherit; font-size: 1.1rem; line-height: 1; cursor: pointer; touch-action: manipulation; }
.wc-verdict { margin: 0; text-align: center; font-size: 1.15rem; font-weight: 800; color: var(--ink); min-height: 1.5rem; }
.wc-verdict[data-hint="true"] { font-weight: 500; font-size: 0.95rem; color: var(--ink-soft); }
.wc-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem; }
.wc-actions button { border: 1px solid var(--line); background: var(--surface); color: var(--ink); font: inherit; font-weight: 700; padding: 0.6rem 1rem; border-radius: 999px; cursor: pointer; touch-action: manipulation; min-height: 2.6rem; }
.wc-actions button:active { transform: scale(0.97); }
.wc-actions .wc-keep { background: var(--ink); color: var(--surface); border-color: transparent; }
.wc-actions button:disabled { opacity: 0.45; cursor: default; }
`;

const SYMBOL: Record<Currency, string> = { EUR: "€", USD: "$", GBP: "£", BRL: "R$", PLN: "zł", CHF: "CHF" };

function CompareView({ runtime, param, navigate }: ViewProps) {
  const ctx = runtime.ctx;
  const openId = param?.id ?? "";
  const [sheet, setSheet] = useState<Sheet | null>(null);

  // What to show first: the kept comparison a row opened, else what was typed last, else the newest kept.
  useEffect(() => {
    let live = true;
    void (async () => {
      let next: Sheet | null = null;
      if (openId) {
        const r = await ctx.get("comparison", openId).catch(() => null);
        if (r) next = sheetOf(r);
      }
      if (!next) next = (await ctx.storage.get<Sheet>(LAST).catch(() => null)) ?? null;
      if (!next) {
        const [newest] = await ctx.query("comparison", { sort: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)), limit: 1 }).catch(() => []);
        if (newest) next = sheetOf(newest);
      }
      if (live) setSheet(next ?? fresh(currencyFor(ctx.format.locale)));
    })();
    return () => {
      live = false;
    };
  }, [openId]);

  // Remembered as typed, a moment after the last keystroke.
  useEffect(() => {
    if (!sheet) return;
    const t = setTimeout(() => void ctx.storage.set(LAST, sheet).catch(() => undefined), 300);
    return () => clearTimeout(t);
  }, [sheet]);

  if (!sheet) return <p className="wc-wait">…</p>;

  const items = sheet.items.map(itemOf);
  const v = compare(items);
  const update = (at: number, patch: Partial<Draft>) => setSheet((s) => s && { ...s, items: s.items.map((d, i) => (i === at ? { ...d, ...patch } : d)) });
  const keep = async () => {
    if (v.winner === null) return ctx.ui.toast(W.keepFirst);
    const suggested = sheet.items.map((d, i) => called(d, i)).join(" · ");
    const name = (await ctx.ui.prompt(W.keptName, { default: suggested }))?.trim();
    if (!name) return;
    const data: Record<string, unknown> = { name, currency: sheet.currency, winner: LETTERS[v.winner], saving: v.saving };
    sheet.items.forEach((d, i) => {
      const k = ["a", "b", "c"][i]!;
      const it = items[i]!;
      data[`${k}Name`] = d.name.trim() || null;
      data[`${k}Price`] = it.price;
      data[`${k}Amount`] = it.amount;
      data[`${k}Unit`] = d.unit;
    });
    await ctx.create("comparison", data);
    ctx.ui.toast(W.keptToast);
    navigate("kept");
  };

  return (
    <div className="wc">
      <style>{CSS}</style>
      <div className="wc-top">
        <label htmlFor="wc-currency">{ctx.t(W.currency)}</label>
        <select id="wc-currency" value={sheet.currency} onChange={(e) => setSheet({ ...sheet, currency: e.target.value as Currency })}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="wc-cards" data-count={sheet.items.length}>
        {sheet.items.map((d, i) => {
          const per = perText(d, sheet.currency, ctx);
          const wins = v.winner === i;
          const loses = v.winner !== null && !wins;
          return (
            <section key={i} className="wc-card" data-wins={wins} data-loses={loses} data-third={i === 2} aria-label={ctx.t(W.item, { letter: LETTERS[i] })}>
              <div className="wc-head">
                <span className="wc-letter" aria-hidden="true">
                  {LETTERS[i]}
                </span>
                <input className="wc-name" value={d.name} placeholder={ctx.t(W.itemName)} aria-label={`${ctx.t(W.item, { letter: LETTERS[i] })} ${ctx.t(W.name)}`} onChange={(e) => update(i, { name: e.target.value })} />
                {i === 2 ? (
                  <button type="button" className="wc-remove" aria-label={ctx.t(W.removeThird)} title={ctx.t(W.removeThird)} onClick={() => setSheet({ ...sheet, items: sheet.items.slice(0, 2) })}>
                    ×
                  </button>
                ) : null}
              </div>
              <div className="wc-field">
                <label htmlFor={`wc-price-${i}`}>{ctx.t(W.price)}</label>
                <div className="wc-price">
                  <span aria-hidden="true">{SYMBOL[sheet.currency]}</span>
                  <input id={`wc-price-${i}`} inputMode="decimal" autoComplete="off" placeholder="0.00" value={d.price} onChange={(e) => update(i, { price: e.target.value })} />
                </div>
              </div>
              <div className="wc-field">
                <label htmlFor={`wc-amount-${i}`}>{ctx.t(W.amount)}</label>
                <div className="wc-amount">
                  <input id={`wc-amount-${i}`} inputMode="decimal" autoComplete="off" placeholder="0" value={d.amount} onChange={(e) => update(i, { amount: e.target.value })} />
                  <select aria-label={`${ctx.t(W.item, { letter: LETTERS[i] })} ${ctx.t(W.unit)}`} value={d.unit} onChange={(e) => update(i, { unit: e.target.value as Unit })}>
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u === "pcs" ? ctx.t(W.pcs) : u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="wc-per" data-empty={per === null}>
                {per ?? "—"}
              </div>
              {wins ? <span className="wc-badge">{v.saving > 0 ? ctx.t(W.cheaper, { saving: v.saving }) : ctx.t(W.samePrice)}</span> : null}
            </section>
          );
        })}
      </div>
      <p className="wc-verdict" data-hint={v.winner === null} role="status">
        {verdictText(sheet, v, ctx)}
      </p>
      <div className="wc-actions">
        {sheet.items.length < 3 ? (
          <button type="button" onClick={() => setSheet({ ...sheet, items: [...sheet.items, empty(sheet.items[sheet.items.length - 1]?.unit)] })}>
            {ctx.t(W.addThird)}
          </button>
        ) : null}
        <button type="button" onClick={() => setSheet(fresh(sheet.currency))}>
          {ctx.t(W.clear)}
        </button>
        <button type="button" className="wc-keep" disabled={v.winner === null} onClick={() => void keep()}>
          {ctx.t(W.keep)}
        </button>
      </div>
    </div>
  );
}

const money = (k: "a" | "b" | "c") => ({ type: "money" as const, currency: "EUR", label: { en: `Price ${k.toUpperCase()}`, "pt-BR": `Preço ${k.toUpperCase()}`, de: `Preis ${k.toUpperCase()}`, es: `Precio ${k.toUpperCase()}`, pl: `Cena ${k.toUpperCase()}`, it: `Prezzo ${k.toUpperCase()}` } });
const amount = (k: "a" | "b" | "c") => ({ type: "number" as const, min: 0, label: { en: `Amount ${k.toUpperCase()}`, "pt-BR": `Quantidade ${k.toUpperCase()}`, de: `Menge ${k.toUpperCase()}`, es: `Cantidad ${k.toUpperCase()}`, pl: `Ilość ${k.toUpperCase()}`, it: `Quantità ${k.toUpperCase()}` } });
const unit = (k: "a" | "b" | "c") => ({ type: "enum" as const, options: [...UNITS], default: "g", label: { en: `Unit ${k.toUpperCase()}`, "pt-BR": `Unidade ${k.toUpperCase()}`, de: `Einheit ${k.toUpperCase()}`, es: `Unidad ${k.toUpperCase()}`, pl: `Jednostka ${k.toUpperCase()}`, it: `Unità ${k.toUpperCase()}` } });
const itemName = (k: "a" | "b" | "c") => ({ type: "text" as const, label: { en: `Item ${k.toUpperCase()}`, "pt-BR": `Item ${k.toUpperCase()}`, de: `Artikel ${k.toUpperCase()}`, es: `Artículo ${k.toUpperCase()}`, pl: `Produkt ${k.toUpperCase()}`, it: `Articolo ${k.toUpperCase()}` } });

export default defineApp({
  id: "which-is-cheaper",
  name: W.appName,
  icon: "⚖️",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#2a9d8f" },
  nav: "tabs",
  // The last verdict, on the tile: what you worked out in the aisle, still there on the home screen.
  tile: async (ctx) => {
    const [newest] = await ctx.query("comparison", { sort: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)), limit: 1 });
    if (!newest) return { title: W.tileEmpty };
    return { title: String(newest.name), lines: [keptVerdict(newest, ctx)] };
  },
  entities: {
    comparison: {
      label: W.comparison,
      icon: "⚖️",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: W.name },
        currency: { type: "enum", options: [...CURRENCIES], default: "EUR", label: W.currency },
        aName: itemName("a"),
        aPrice: money("a"),
        aAmount: amount("a"),
        aUnit: unit("a"),
        bName: itemName("b"),
        bPrice: money("b"),
        bAmount: amount("b"),
        bUnit: unit("b"),
        cName: itemName("c"),
        cPrice: money("c"),
        cAmount: amount("c"),
        cUnit: unit("c"),
        winner: { type: "text", label: W.cheapest },
        saving: { type: "number", min: 0, max: 100, unit: "%", label: { en: "Saving", "pt-BR": "Economia", de: "Ersparnis", es: "Ahorro", pl: "Oszczędność", it: "Risparmio" } },
      },
    },
  },
  pages: [
    {
      id: "compare",
      title: W.compare,
      icon: "⚖️",
      view: { type: "custom", entity: "comparison", param: "id", render: (props) => <CompareView {...props} /> },
    },
    {
      id: "kept",
      title: W.kept,
      icon: "📌",
      view: {
        type: "list",
        entity: "comparison",
        money: false,
        display: { primary: "name", secondary: (c, ctx) => keptVerdict(c, ctx) },
        sort: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
        emptyText: W.noKept,
        onOpen: { page: "compare", param: { id: "id" } },
      },
    },
  ],
});
