// No new hardcoded words in Potyro's own UI (#298, #299).
//
// Scans packages/shell/src and packages/views/src for user-facing text that did not go through a
// catalog:
//   - text between JSX tags, outside <Trans>/<Plural>/<Select>;
//   - a string given to aria-label, title, placeholder, alt or label (and the other aria-* that
//     are read aloud);
//   - a string handed to a toast or a dialog (`toast`, `confirm`, `prompt`, `alert`, `share`), and
//     its `detail` / `ok` / `cancel` options;
//   - a string under a `label`, `title`, `placeholder`, `ariaLabel` or `detail` key — the menu
//     entries and option lists that end up on screen.
// Only the value that is RENDERED is looked at: the branches of `a ? "x" : "y"`, both sides of
// `"x" + y`, a template literal. A string compared, used as a key or a class name is not text.
//
// Every finding is an error, in every file of shell and views (#299 extracted them all, batch by
// batch; the per-file allow-list it went through is gone with it). A new file is covered the moment
// it exists.
//
// Escape hatch, for proper nouns and code that is not language: `// i18n-ignore — <why>` on the
// line, or on the line before (in JSX, `{/* i18n-ignore — <why> */}`). Say why: an example address,
// a name, text a model reads (#297 keeps model-facing text English). "Potyro" is allowed everywhere;
// it is a name.
//
// A callback in one of those slots is followed into what it returns (#300: `label: (r) => \`＋ New
// ${…}\`` in App.tsx slipped through before): an arrow's expression body, or every `return` in its
// block, but not the returns of functions nested inside it. So is a method under one of those keys
// (`label() { return … }`), and a `.map(cb)` / `.flatMap(cb)` rendered as JSX children.
//
// What this cannot see: a string some other function returns or throws that ends up on screen — a
// helper called from a slot is not followed. Those were moved by reading (#299); the
// pseudo-language e2e (e2e/i18n-trusted.spec.ts) is the net for them.
//
// TypeScript's own parser (already a dependency), like the other checks in scripts/: no ESLint in
// this repo to hang a rule on, and a parser rather than a regex because JSX text cannot be found
// reliably any other way.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const ROOTS = ["packages/shell/src", "packages/views/src"];


const ATTRS = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "title",
  "placeholder",
  "alt",
  "label",
]);
const PROPS = new Set(["label", "title", "placeholder", "ariaLabel", "detail"]);
const DIALOG_OPTIONS = new Set(["detail", "ok", "cancel", "label", "title"]);
const CALLEES = new Set(["toast", "confirm", "prompt", "alert", "share"]);
const TRANSLATED = new Set(["t", "tr", "msg", "defineMessage", "plural", "select", "selectOrdinal"]);
const TRANS_ELEMENTS = new Set(["Trans", "Plural", "Select", "SelectOrdinal"]);
const PROPER_NOUNS = /\bPotyro\b/g;
/** Array methods whose callback's return value is what a JSX child renders. */
const LIST_RENDERERS = new Set(["map", "flatMap"]);

/** Two letters in a row, in any script, once the allowed names are taken out. */
const hasWords = (text) => /\p{L}{2,}/u.test(text.replace(PROPER_NOUNS, ""));

const IGNORE_DIRS = new Set(["node_modules", "dist", ".vite", "coverage"]);
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const nameOf = (callee) =>
  ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;

const isTranslated = (node) =>
  (ts.isTaggedTemplateExpression(node) && TRANSLATED.has(nameOf(node.tag))) ||
  (ts.isCallExpression(node) && TRANSLATED.has(nameOf(node.expression)));

/** The string literals an expression would RENDER — not every string inside it. */
function rendered(expr) {
  if (!expr) return [];
  if (isTranslated(expr)) return [];
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [{ node: expr, text: expr.text }];
  if (ts.isTemplateExpression(expr)) {
    const text = [expr.head.text, ...expr.templateSpans.map((s) => s.literal.text)].join(" ");
    return [{ node: expr, text }, ...expr.templateSpans.flatMap((s) => rendered(s.expression))];
  }
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) return rendered(expr.expression);
  if (ts.isConditionalExpression(expr)) return [...rendered(expr.whenTrue), ...rendered(expr.whenFalse)];
  // A callback in a rendered slot — `label: (r) => `＋ New ${r}``, `title={() => "Close"}` — renders
  // what it returns. So does `.map(cb)` over a list in JSX: each item is what the callback returns.
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return returned(expr);
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && LIST_RENDERERS.has(expr.expression.name.text))
    return rendered(expr.arguments[0]);
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken)
      return [...rendered(expr.left), ...rendered(expr.right)];
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return rendered(expr.right);
  }
  return [];
}

/**
 * What a function returns: its expression body, or each `return` in its block — not the returns
 * of functions nested inside it, which return to someone else.
 */
function returned(fn) {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return rendered(fn.body);
  const out = [];
  const walkReturns = (node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) out.push(...rendered(node.expression));
    ts.forEachChild(node, walkReturns);
  };
  ts.forEachChild(fn.body, walkReturns);
  return out;
}

function insideTrans(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) && TRANS_ELEMENTS.has(p.openingElement.tagName.getText())) return true;
  }
  return false;
}

function check(file) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = src.split("\n");
  const findings = [];
  const report = (node, what, text) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    if (/i18n-ignore/.test(lines[line] ?? "") || /i18n-ignore/.test(lines[line - 1] ?? "")) return;
    findings.push({ line: line + 1, what, text: text.trim().replace(/\s+/g, " ").slice(0, 70) });
  };
  const reportAll = (expr, what) => {
    for (const s of rendered(expr)) if (hasWords(s.text)) report(s.node, what, s.text);
  };

  const visit = (node) => {
    if (ts.isJsxText(node) && hasWords(node.text) && !insideTrans(node)) report(node, "JSX text", node.text);
    else if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && !insideTrans(node))
      reportAll(node.expression, "JSX text");
    else if (ts.isJsxAttribute(node) && ATTRS.has(node.name.getText()) && node.initializer) {
      const init = node.initializer;
      if (ts.isStringLiteral(init)) {
        if (hasWords(init.text)) report(init, node.name.getText(), init.text);
      } else if (ts.isJsxExpression(init)) reportAll(init.expression, node.name.getText());
    } else if (ts.isCallExpression(node) && CALLEES.has(nameOf(node.expression))) {
      for (const arg of node.arguments) {
        if (ts.isObjectLiteralExpression(arg)) {
          for (const p of arg.properties)
            if (ts.isPropertyAssignment(p) && DIALOG_OPTIONS.has(p.name.getText())) reportAll(p.initializer, `${nameOf(node.expression)}() ${p.name.getText()}`);
        } else reportAll(arg, `${nameOf(node.expression)}()`);
      }
    } else if (ts.isPropertyAssignment(node) && PROPS.has(node.name.getText().replace(/["']/g, ""))) {
      // Inside a dialog call the options were handled above.
      const call = node.parent?.parent;
      if (!(call && ts.isCallExpression(call) && CALLEES.has(nameOf(call.expression)))) reportAll(node.initializer, `${node.name.getText()}:`);
    } else if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && PROPS.has(node.name.getText().replace(/["']/g, ""))) {
      // `label() { return "…"; }` and `get title() { … }`: the same slot, written as a method.
      for (const s of returned(node)) if (hasWords(s.text)) report(s.node, `${node.name.getText()}()`, s.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

// Self-test first: the planted fixture's `// expect` lines, and only those, must be reported. A
// check that silently stopped seeing a kind of string would otherwise pass forever.
{
  const fixture = join(root, "scripts/fixtures/i18n-planted.tsx");
  const lines = readFileSync(fixture, "utf8").split("\n");
  const want = lines.flatMap((l, i) => (/\/\/ expect\s*$/.test(l) ? [i + 1] : []));
  const got = [...new Set(check(fixture).map((f) => f.line))];
  const missed = want.filter((l) => !got.includes(l));
  const extra = got.filter((l) => !want.includes(l));
  if (missed.length || extra.length) {
    console.error(`[i18n] self-test failed on scripts/fixtures/i18n-planted.tsx — missed lines ${missed.join(", ") || "none"}, wrongly reported ${extra.join(", ") || "none"}`);
    process.exit(1);
  }
}

let errors = 0;
let files = 0;
for (const base of ROOTS) {
  for (const file of walk(join(root, base))) {
    files++;
    const rel = relative(root, file).split("\\").join("/");
    for (const f of check(file)) {
      errors++;
      console.error(`[i18n] ${rel}:${f.line}  ${f.what}: "${f.text}" — put it in a catalog (t\`…\` / <Trans>)`);
    }
  }
}

if (errors) {
  console.error(`\n[i18n] ${errors} hardcoded string(s).`);
  process.exit(1);
}
console.log(`[i18n] OK — ${files} file(s) in shell and views, no hardcoded words`);
