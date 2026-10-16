// An app's line (docs/24 §11): which app it is across devices, so a link made on one opens the copy on
// another. Apart from app-link.ts so the registry (user-apps.ts), which nearly everything imports, can
// mint one without pulling in what reading a link needs.
import { parseLine } from "@potyro/store";
import { toBase64Url } from "./demo-link.js";

/** A line of its own, for an app made here: 128 random bits. */
export function newLine(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** The line of an app that never got one of its own: its declared id. */
export function derivedLine(declaredId: string | undefined): string | undefined {
  return declaredId ? parseLine(`id:${declaredId}`) : undefined;
}

/** An app's line: its own, else its declared id's. */
export function lineFor(app: { line?: string }, declaredId: string | undefined): string | undefined {
  return parseLine(app.line) ?? derivedLine(declaredId);
}
