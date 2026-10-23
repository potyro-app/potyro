// One icon of an app's, drawn the system's way (DESIGN.md §3.5, #425). An app's `icon` is a Lucide
// name ("shopping-cart") — drawn as that icon, stroke 2 with round caps, the stroke of the logo — or,
// from before, an emoji or a short glyph, shown as the character it is. Every place the shell shows
// an app's icon (a tab, a tile, a row's lead, a button, a menu row) goes through here, so a name is
// the same picture everywhere and an unknown one never shows as text.
//
// The paths are one lazy chunk (@potyro/design): the first Lucide name seen starts the load, and
// until it lands the icon's room is kept empty — a fallback that flashes and is replaced is worse
// than a beat of nothing. A name Lucide has not shows `fallback` (an initial, a plus) or nothing.

import { isLucideName, lucideLoaded, lucidePath, lucideReady, onLucide } from "@potyro/design";
import type { CSSProperties, ReactNode } from "react";
import { useSyncExternalStore } from "react";

/** The icon's box, in px: 16 inline, 20 default, 24 in a tab bar — larger on tiles and heroes. */
export type GlyphSize = number;

export interface GlyphProps {
  /** A Lucide name, an emoji, a short glyph — or nothing. */
  icon: string | undefined | null;
  /** The box, in px. The stroke is 2px up to 24 and scales with the box above it, as the logo's. */
  size?: GlyphSize;
  className?: string;
  /** What to show for a name Lucide has not, or no icon at all. */
  fallback?: ReactNode;
  style?: CSSProperties;
}

/** Re-renders when the paths land. */
export function useLucide(): boolean {
  return useSyncExternalStore(onLucide, lucideLoaded, lucideLoaded);
}

/** The icon as an element: an <svg> for a Lucide name, a <span> for a glyph, `fallback` otherwise. */
export function Glyph({ icon, size = 20, className, fallback = null, style }: GlyphProps): ReactNode {
  const loaded = useLucide();
  const cls = className ? `k-glyph ${className}` : "k-glyph";
  if (!icon) return fallback;
  if (!isLucideName(icon)) {
    return (
      <span className={`${cls} k-glyph-text`} style={style} aria-hidden>
        {icon}
      </span>
    );
  }
  if (!loaded) {
    void lucideReady();
    return <span className={`${cls} k-glyph-pending`} style={{ width: size, height: size, ...style }} aria-hidden />;
  }
  const d = lucidePath(icon);
  if (!d) return fallback;
  return (
    <svg
      className={`${cls} k-icon`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size < 24 ? (2 * 24) / size : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={style}
      data-icon={icon}
    >
      <path d={d} />
    </svg>
  );
}

/** Whether an icon can be drawn now: a glyph always, a Lucide name once the paths are here and have it. */
export function glyphDrawable(icon: string | undefined | null): icon is string {
  if (!icon) return false;
  return !isLucideName(icon) || lucidePath(icon) !== undefined;
}

const SVG = "http://www.w3.org/2000/svg";

/**
 * The icon as a DOM element, for markup built outside React (a map's pin): the <svg> for a Lucide
 * name the paths have, a <span> for a glyph. Call `lucideReady()` first; a name not loaded or not
 * known comes back as an empty, sized span.
 */
export function glyphElement(icon: string, size: GlyphSize = 20): HTMLElement | SVGElement {
  if (!isLucideName(icon)) {
    const span = document.createElement("span");
    span.className = "k-glyph k-glyph-text";
    span.textContent = icon;
    return span;
  }
  const d = lucidePath(icon);
  if (!d) {
    const span = document.createElement("span");
    span.className = "k-glyph k-glyph-pending";
    span.style.width = `${size}px`;
    span.style.height = `${size}px`;
    return span;
  }
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "k-glyph k-icon");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(size < 24 ? (2 * 24) / size : 2));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.dataset.icon = icon;
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}

/**
 * A menu row's icon: an app's string goes through `Glyph`, the shell's own node (an `I.xxx`) stays
 * as it is.
 */
export function glyphOf(icon: ReactNode | string | undefined, size: GlyphSize = 20): ReactNode {
  return typeof icon === "string" ? <Glyph icon={icon} size={size} /> : (icon ?? null);
}
