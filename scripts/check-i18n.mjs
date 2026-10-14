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
// Two levels, so the extraction can go batch by batch (#299):
//   - ERROR for the files in CLEAN below — a batch that has been extracted cannot regress;
//   - WARN for everything else, summarised per file (`--verbose` lists each one).
// `--strict` makes every finding an error, which is where #299 ends.
//
// Escape hatch, for proper nouns and code that is not language: `// i18n-ignore` on the line, or
// on the line before. "Potyro" is allowed everywhere; it is a name.
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

/** Extracted batches: any finding here fails the check. */
export const CLEAN = new Set([
  // #298, batch 1: the launcher and the You panel, and everything drawn inside them.
  "packages/shell/src/launcher.tsx",
  "packages/shell/src/launcher-order.ts",
  "packages/shell/src/launcher-store.ts",
  "packages/shell/src/draft-strip.tsx",
  "packages/shell/src/identity-panel.tsx",
  "packages/shell/src/language-picker.tsx",
  "packages/shell/src/backup-switch.tsx",
  "packages/shell/src/storage-report.tsx",
  // #299, the launcher remainder: tiles, restore, removal, sync state, the picker.
  "packages/shell/src/tile-editor.tsx",
  "packages/shell/src/tile-identity.ts",
  "packages/shell/src/remove-app.ts",
  "packages/shell/src/restore-apps.tsx",
  "packages/shell/src/summary-strip.tsx",
  "packages/shell/src/app-lock.tsx",
  "packages/shell/src/sync-status.tsx",
  "packages/shell/src/toggle-sync.ts",
  "packages/shell/src/launcher-live.ts",
  "packages/shell/src/picker.tsx",
  "packages/shell/src/user-apps.ts",
  "packages/shell/src/examples.ts",
  "packages/shell/src/seed.ts",
  "packages/shell/src/backup-all.ts",
  "packages/shell/src/backup-setting.ts",
  "packages/shell/src/rename-migration.ts",
  // #299, the Studio: conversation, cards, preview bar, point mode, edit mode, code and history.
  "packages/shell/src/studio.tsx",
  "packages/shell/src/studio-thread-view.tsx",
  "packages/shell/src/studio-tools.tsx",
  "packages/shell/src/studio-preview.tsx",
  "packages/shell/src/studio-engine.ts",
  "packages/shell/src/studio-libraries.ts",
  "packages/shell/src/studio-chat.ts",
  "packages/shell/src/studio-thread.ts",
  "packages/shell/src/inline-edit.tsx",
  "packages/shell/src/inline-targets.ts",
  "packages/shell/src/code-editor.tsx",
  "packages/shell/src/diff.ts",
  "packages/shell/src/highlight.ts",
  "packages/shell/src/model-turn.ts",
  "packages/shell/src/generate-client.ts",
  "packages/shell/src/start-modify.ts",
  "packages/shell/src/run-candidate.ts",
  "packages/shell/src/schema-drift.ts",
  "packages/shell/src/history.tsx",
  "packages/shell/src/app-history.ts",
  "packages/shell/src/chat-panel.tsx",
  "packages/shell/src/point-mode.tsx",
  "packages/shell/src/point-target.ts",
  "packages/shell/src/version-notes.ts",
  "packages/shell/src/app-source.ts",
  "packages/shell/src/source-ast.ts",
  "packages/shell/src/source-declared.ts",
  "packages/shell/src/app-source-words.ts",
  // #299, Add an app, the trust dialog, the splash, promotion, missing features, libraries and their consent.
  "packages/shell/src/add-app-dialog.tsx",
  "packages/shell/src/add-app.ts",
  "packages/shell/src/trust-dialog.tsx",
  "packages/shell/src/splash.tsx",
  "packages/shell/src/promotion.ts",
  "packages/shell/src/missing-features.ts",
  "packages/shell/src/app-trial.ts",
  "packages/shell/src/verify-candidate.ts",
  "packages/shell/src/validate-app.ts",
  "packages/shell/src/open-libraries.ts",
  "packages/shell/src/library-fetch.ts",
  "packages/shell/src/package-libraries.ts",
  "packages/shell/src/package-modules.ts",
  "packages/shell/src/version-gate.ts",
  "packages/shell/src/app-bundler.ts",
  "packages/shell/src/app-modules.ts",
  "packages/shell/src/trusted-loader.ts",
  "packages/shell/src/migrate-on-load.ts",
  "packages/shell/src/observe-render.ts",
  "packages/shell/src/isolate-bridge.ts",
  "packages/shell/src/check-concurrency.ts",
  "packages/shell/src/capability-words.ts",
  // #299, the Data page: apps, tables, filters.
  "packages/shell/src/data-page.tsx",
  "packages/shell/src/data-table.tsx",
  "packages/shell/src/filter-chrome.tsx",
  "packages/shell/src/data-runtime.ts",
  "packages/shell/src/data-icon.tsx",
  "packages/shell/src/read-only-store.ts",
  "packages/shell/src/scope.ts",
  // #299, You and settings: model settings, reasoning level, Look, Ask's switch.
  "packages/shell/src/engine-settings.tsx",
  "packages/shell/src/engines.ts",
  "packages/shell/src/engine-store.ts",
  "packages/shell/src/thinking-settings.tsx",
  "packages/shell/src/look-panel.tsx",
  "packages/shell/src/look.ts",
  "packages/shell/src/ask-setting.ts",
  "packages/shell/src/shell-caps.ts",
]);

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
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken)
      return [...rendered(expr.left), ...rendered(expr.right)];
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return rendered(expr.right);
  }
  return [];
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
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const verbose = args.has("--verbose");

let errors = 0;
let warnings = 0;
const warnedFiles = [];
for (const base of ROOTS) {
  for (const file of walk(join(root, base))) {
    const rel = relative(root, file).split("\\").join("/");
    const findings = check(file);
    if (!findings.length) continue;
    const isError = strict || CLEAN.has(rel);
    if (isError) {
      errors += findings.length;
      for (const f of findings) console.error(`[i18n] ${rel}:${f.line}  ${f.what}: "${f.text}" — put it in a catalog (t\`…\` / <Trans>)`);
    } else {
      warnings += findings.length;
      warnedFiles.push([rel, findings.length]);
      if (verbose) for (const f of findings) console.warn(`[i18n] warn ${rel}:${f.line}  ${f.what}: "${f.text}"`);
    }
  }
}

if (warnings) {
  console.warn(`[i18n] ${warnings} hardcoded string(s) in ${warnedFiles.length} file(s) not yet extracted (warn; #299). --verbose lists them.`);
  if (!verbose)
    for (const [rel, n] of warnedFiles.sort((a, b) => b[1] - a[1]).slice(0, 10)) console.warn(`[i18n]   ${String(n).padStart(4)}  ${rel}`);
}
if (errors) {
  console.error(`\n[i18n] ${errors} hardcoded string(s) in extracted files.`);
  process.exit(1);
}
console.log(`[i18n] OK — ${CLEAN.size} extracted file(s) clean`);
