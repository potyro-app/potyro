// @vitest-environment happy-dom
//
// Pairing what is on screen with what is in the source. The failure this guards against is the
// old edit mode's: offering to change something and then having nothing behind it — or worse,
// offering a record's own data as if it were the app's wording.

import { describe, expect, it } from "vitest";
import type { AppShape, TextSite } from "../src/app-source.js";
import { collectTargets, sameThing } from "../src/inline-targets.js";

const SHAPE: AppShape = {
  entities: [
    {
      key: "item",
      fields: [
        { key: "title", label: "Name", hidden: false },
        { key: "dueDate", hidden: false },
      ],
    },
  ],
  pages: [{ id: "all", title: "Everything", hidden: false, entity: "item", viewType: "list" }],
};

const site = (text: string, start = 0): TextSite => ({ start, end: start + text.length + 2, text, form: "string" });
const SITES = [site("Everything"), site("Start session", 10), site("Milk", 40), site("Details", 60), site("Details", 80)];

function render(html: string): Element {
  document.body.innerHTML = `<div class="k-app-chrome">${html}</div>`;
  return document.querySelector(".k-app-chrome")!;
}

const summary = (root: Element) =>
  collectTargets([root], SITES, SHAPE).map((t) => `${t.kind}:${t.text}`);

describe("collectTargets", () => {
  it("pairs literal text, including text split around an expression", () => {
    const root = render(`<button>
        Start session
      </button><p>Step <b>1</b></p>`);
    expect(summary(root)).toEqual(["text:Start session"]);
  });

  it("never offers a record's own text, even when it reads like a literal", () => {
    const root = render(`<span class="k-primary" data-k-value>Milk</span><p>Milk</p>`);
    expect(summary(root)).toEqual(["text:Milk"]);
    expect(collectTargets([root], SITES, SHAPE)[0]!.node.parentElement!.tagName).toBe("P");
  });

  it("uses a field tag, and covers a label the app never wrote (the humanized key)", () => {
    const root = render(`<table><tr><th data-k-field="item.title">Name</th><th data-k-field="item.dueDate">Due Date</th></tr></table>`);
    expect(summary(root)).toEqual(["field:Name", "field:Due Date"]);
  });

  it("offers only the label inside a tagged form row, not its help text or input", () => {
    const root = render(`<div data-k-field="item.title"><span>Name<em> *</em></span><input value="Name"/><p>Your name</p></div>`);
    expect(summary(root)).toEqual(["field:Name"]);
  });

  it("uses a page tag", () => {
    const root = render(`<nav><span class="k-tab-label" data-k-page="all">Everything</span></nav>`);
    const [target] = collectTargets([root], SITES, SHAPE);
    expect(target).toMatchObject({ kind: "page", text: "Everything" });
  });

  it("leaves a title or label the app computes alone — renaming it would overwrite code", () => {
    const shape: AppShape = {
      entities: [{ key: "item", fields: [{ key: "title", labelOpaque: true, hidden: false }] }],
      pages: [{ id: "all", titleOpaque: true, hidden: false }],
    };
    const root = render(`<span data-k-page="all">All</span><span data-k-field="item.title">Title</span>`);
    expect(collectTargets([root], SITES, shape)).toEqual([]);
  });

  it("leaves the shell's own UI alone", () => {
    const root = render(`<div class="k-tools"><button>Start session</button></div><div role="menu">Everything</div><div data-k-noedit>Milk</div>`);
    expect(summary(root)).toEqual([]);
  });

  it("carries every place a repeated text is written", () => {
    const root = render(`<h3>Details</h3>`);
    const [target] = collectTargets([root], SITES, SHAPE);
    expect(target?.kind === "text" && target.sites).toHaveLength(2);
  });

  it("treats the same text, field or page as one thing to change", () => {
    const root = render(`<p>Start session</p><button>Start session</button><span data-k-field="item.title">Name</span>`);
    const [a, b, c] = collectTargets([root], SITES, SHAPE);
    expect(sameThing(a!, b!)).toBe(true);
    expect(sameThing(a!, c!)).toBe(false);
  });
});
