// An app's icon drawn the system's way (#425): a Lucide name is an <svg> in the logo's stroke, an
// emoji is the character, an unknown name is the fallback — and before the paths land, empty room.
import { primeLucide } from "@potyro/design";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Glyph, glyphOf } from "../src/glyph.js";

describe("Glyph", () => {
  it("keeps the icon's room before the paths are here", () => {
    const html = renderToStaticMarkup(<Glyph icon="shopping-cart" size={24} />);
    expect(html).toContain("k-glyph-pending");
    expect(html).toContain("width:24px");
    expect(html).not.toContain("shopping-cart");
  });

  it("draws a Lucide name as the icon, stroke 2 with round caps", () => {
    primeLucide({ "shopping-cart": "M1 1L2 2" }, { cart: "shopping-cart" });
    const html = renderToStaticMarkup(<Glyph icon="shopping-cart" size={24} />);
    expect(html).toMatch(/<svg[^>]*class="k-glyph k-icon"/);
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="2"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('<path d="M1 1L2 2"');
    expect(html).toContain('data-icon="shopping-cart"');
    // An older name finds the icon it means today.
    expect(renderToStaticMarkup(<Glyph icon="cart" />)).toContain('<path d="M1 1L2 2"');
  });

  it("keeps the stroke 2px below 24, and lets it scale above", () => {
    expect(renderToStaticMarkup(<Glyph icon="shopping-cart" size={16} />)).toContain('stroke-width="3"');
    expect(renderToStaticMarkup(<Glyph icon="shopping-cart" size={48} />)).toContain('stroke-width="2"');
  });

  it("shows an emoji as the character it is", () => {
    const html = renderToStaticMarkup(<Glyph icon="🛒" />);
    expect(html).toBe('<span class="k-glyph k-glyph-text" aria-hidden="true">🛒</span>');
  });

  it("shows the fallback for a name Lucide has not, and for no icon", () => {
    expect(renderToStaticMarkup(<Glyph icon="no-such-icon" fallback="AB" />)).toBe("AB");
    expect(renderToStaticMarkup(<Glyph icon="no-such-icon" />)).toBe("");
    expect(renderToStaticMarkup(<Glyph icon={undefined} fallback="AB" />)).toBe("AB");
  });

  it("glyphOf draws a string and passes a node through", () => {
    expect(renderToStaticMarkup(<>{glyphOf("shopping-cart")}</>)).toContain("<svg");
    expect(renderToStaticMarkup(<>{glyphOf(<b>x</b>)}</>)).toBe("<b>x</b>");
    expect(glyphOf(undefined)).toBeNull();
  });
});
