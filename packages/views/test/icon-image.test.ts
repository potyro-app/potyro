// A picture as an icon (#425): what reaches an <img>, and what never does.
import { describe, expect, it } from "vitest";
import { cleanSvg, imageIconSrc } from "../src/icon-image.js";

const dec = (src: string) => decodeURIComponent(src.replace(/^data:image\/svg\+xml;utf8,/, ""));

describe("cleanSvg", () => {
  it("drops scripts, handlers, foreign objects and outside references, keeps the drawing", () => {
    const dirty = `<svg viewBox="0 0 24 24" onload="x()"><script>alert(1)</script><foreignObject><div>hi</div></foreignObject>
      <a href="https://evil.example"><circle cx="12" cy="12" r="10" fill="url(https://evil.example/p.svg)"/></a>
      <use href="#ok"/><use xlink:href="other.svg#x"/><path d="M1 1L2 2"/></svg>`;
    const clean = cleanSvg(dirty);
    expect(clean).not.toMatch(/script|foreignObject|onload|evil\.example|other\.svg/);
    expect(clean).toContain('<circle cx="12" cy="12" r="10" fill="none"/>');
    expect(clean).toContain('<use href="#ok"/>');
    expect(clean).toContain('<path d="M1 1L2 2"/>');
  });
});

describe("cleanSvg's namespace", () => {
  it("declares the SVG namespace when the root has none, and leaves one that has it alone", () => {
    expect(cleanSvg('<svg viewBox="0 0 2 2"/>')).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"/>');
    expect(cleanSvg('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });
});

describe("imageIconSrc", () => {
  it("encodes an inline <svg>, cleaned", () => {
    const src = imageIconSrc('<svg viewBox="0 0 24 24"><script>1</script><path d="M1 1"/></svg>')!;
    expect(src.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(dec(src)).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1"/></svg>');
  });

  it("passes a raster data: URL through and cleans an SVG one", () => {
    expect(imageIconSrc("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
    const b64 = Buffer.from('<svg><script>1</script><path d="M1 1"/></svg>').toString("base64");
    expect(dec(imageIconSrc(`data:image/svg+xml;base64,${b64}`)!)).toBe('<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"/></svg>');
  });

  it("has no src of its own for a shipped file's path, a name or a glyph", () => {
    expect(imageIconSrc("icon.svg")).toBeUndefined();
    expect(imageIconSrc("shopping-cart")).toBeUndefined();
    expect(imageIconSrc("🛒")).toBeUndefined();
    expect(imageIconSrc(undefined)).toBeUndefined();
  });
});
