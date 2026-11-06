// The toolbar's marks, pure: the same function for a button and a key, as in Notes
// (apps/markdown-notes), so the two editors behave alike.

export type Mark = "bold" | "italic" | "code" | "link" | "heading" | "bullets" | "numbers" | "tasks" | "quote";

/** Where the text and the selection are, before and after a mark. */
export interface Edit {
  text: string;
  start: number;
  end: number;
}

const WRAP: Record<"bold" | "italic" | "code", string> = { bold: "**", italic: "*", code: "`" };
const LINE: Record<"bullets" | "numbers" | "tasks" | "quote", RegExp> = {
  bullets: /^(\s*)[-*+] (?!\[[ xX]\] )/,
  numbers: /^(\s*)\d+[.)] /,
  tasks: /^(\s*)[-*+] \[[ xX]\] /,
  quote: /^(\s*)> ?/,
};
/** Any mark a line may start with: a heading, a list item, a task, a quote. */
const ANY_LINE = /^(\s*)(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)/;

/**
 * `mark` applied to the selection `[start, end)` of `text`: wrapped, or each of its lines prefixed —
 * and taken off again when it is already there, so every button is a switch. Pure, so the editor's
 * buttons and keys are one function and the tests can read it.
 */
export function applyMark(e: Edit, mark: Mark): Edit {
  const { text } = e;
  const start = Math.min(e.start, e.end);
  const end = Math.max(e.start, e.end);
  if (mark === "bold" || mark === "italic" || mark === "code") {
    const w = WRAP[mark];
    const picked = text.slice(start, end);
    const before = text.slice(start - w.length, start);
    const after = text.slice(end, end + w.length);
    if (before === w && after === w && (mark !== "italic" || text.slice(start - 2, start) !== "**" || picked.length > 0)) {
      // Already wrapped: unwrap.
      return { text: text.slice(0, start - w.length) + picked + text.slice(end + w.length), start: start - w.length, end: end - w.length };
    }
    if (picked.startsWith(w) && picked.endsWith(w) && picked.length >= 2 * w.length) {
      const inner = picked.slice(w.length, -w.length);
      return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
    }
    return { text: text.slice(0, start) + w + picked + w + text.slice(end), start: start + w.length, end: end + w.length };
  }
  if (mark === "link") {
    const picked = text.slice(start, end);
    if (picked) {
      // The address is what is selected next, ready to be typed over.
      const out = `[${picked}](url)`;
      return { text: text.slice(0, start) + out + text.slice(end), start: start + picked.length + 3, end: start + picked.length + 6 };
    }
    const out = "[text](url)";
    return { text: text.slice(0, start) + out + text.slice(end), start: start + 1, end: start + 5 };
  }
  // Line marks: every line the selection touches.
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEndAt = text.indexOf("\n", Math.max(end, start) - (end > start ? 1 : 0));
  const lineEnd = lineEndAt === -1 ? text.length : lineEndAt;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  let changed: string[];
  if (mark === "heading") {
    // One button, three levels, then none: "# " → "## " → "### " → plain.
    const level = /^(#{1,6}) /.exec(lines[0]!)?.[1].length ?? 0;
    const next = level >= 3 ? 0 : level + 1;
    changed = lines.map((l) => (next ? `${"#".repeat(next)} ` : "") + l.replace(/^#{1,6} /, ""));
  } else {
    const re = LINE[mark];
    const all = lines.every((l) => re.test(l) || !l.trim());
    changed = lines.map((l, i) => {
      if (!l.trim() && lines.length > 1) return l;
      const bare = l.replace(ANY_LINE, "$1");
      if (all) return bare;
      const prefix = mark === "bullets" ? "- " : mark === "numbers" ? `${i + 1}. ` : mark === "tasks" ? "- [ ] " : "> ";
      return bare.replace(/^(\s*)/, `$1${prefix}`);
    });
  }
  const block = changed.join("\n");
  const delta = block.length - (lineEnd - lineStart);
  const out = text.slice(0, lineStart) + block + text.slice(lineEnd);
  // The selection follows the text: the same lines, now marked.
  const newStart = start === lineStart ? lineStart : Math.max(lineStart, start + (changed[0]!.length - lines[0]!.length));
  return { text: out, start: Math.min(newStart, out.length), end: Math.max(newStart, end + delta) };
}

/** What a key does in the editor, or null: B, I, K (link), E (code) with Ctrl or ⌘; Ctrl/⌘+S saves. */
export function markForKey(key: string, mod: boolean): Mark | "save" | null {
  if (!mod) return null;
  switch (key.toLowerCase()) {
    case "b":
      return "bold";
    case "i":
      return "italic";
    case "k":
      return "link";
    case "e":
      return "code";
    case "s":
      return "save";
    default:
      return null;
  }
}

export const TOOLS: Array<{ mark: Mark; label: string; title: string }> = [
  { mark: "bold", label: "B", title: "Bold (Ctrl+B)" },
  { mark: "italic", label: "I", title: "Italic (Ctrl+I)" },
  { mark: "heading", label: "H", title: "Heading" },
  { mark: "bullets", label: "•", title: "Bulleted list" },
  { mark: "numbers", label: "1.", title: "Numbered list" },
  { mark: "tasks", label: "☑", title: "Checklist" },
  { mark: "quote", label: "❝", title: "Quote" },
  { mark: "code", label: "<>", title: "Code (Ctrl+E)" },
  { mark: "link", label: "🔗", title: "Link (Ctrl+K)" },
];

