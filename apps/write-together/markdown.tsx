// Markdown drawn as React elements, never as HTML from the text: a document someone else typed
// cannot put a script on the page. The same renderer as Notes (apps/markdown-notes), kept in step.
import type { ReactNode } from "react";

/** Bold, italic, code and links inside one line. A link is only followed when it is http(s). */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let at = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const k = `${key}.${n++}`;
    const s = m[0];
    if (m[1]) out.push(<code key={k}>{s.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{s.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={k}>{s.slice(1, -1)}</em>);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(s)!;
      out.push(
        /^https?:\/\//i.test(href!) ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    }
    at = m.index + s.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Headings, paragraphs, lists, quotes and code blocks: enough for notes, and nothing executable. */
export function renderMarkdown(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  const key = () => `b${blocks.length}`;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
      i++;
      blocks.push(<pre key={key()}>{code.join("\n")}</pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1]!.length + 1, 6);
      const H = `h${level}` as "h2";
      blocks.push(<H key={key()}>{inline(heading[2]!.replace(/\s*#+\s*$/, ""), key())}</H>);
      i++;
      continue;
    }
    const listItem = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
    if (listItem.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      for (; i < lines.length && listItem.test(lines[i]!); i++) {
        const [, , body] = listItem.exec(lines[i]!)!;
        const done = /^\[([ xX])\]\s+/.exec(body!);
        items.push(<li key={`${key()}.${items.length}`}>{done ? <>{done[1] === " " ? "☐ " : "☑ "}{inline(body!.slice(done[0].length), key())}</> : inline(body!, key())}</li>);
      }
      blocks.push(ordered ? <ol key={key()}>{items}</ol> : <ul key={key()}>{items}</ul>);
      continue;
    }
    if (line.startsWith(">")) {
      const quoted: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith(">"); i++) quoted.push(lines[i]!.replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key()}>{inline(quoted.join(" "), key())}</blockquote>);
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]!); i++) para.push(lines[i]!.trim());
    blocks.push(<p key={key()}>{inline(para.join(" "), key())}</p>);
  }
  return blocks;
}

