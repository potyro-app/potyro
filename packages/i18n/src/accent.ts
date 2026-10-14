// The pseudo-language's letters (#298): every ASCII letter as an accented look-alike.
// Its own tiny module because the format helpers use it too: in the pseudo-language a formatted date
// is accented like everything else that went through this package, so a raw `toLocaleString()`
// somewhere is the plain-ASCII word the guard e2e catches.

const ACCENTED: Record<string, string> = {
  a: "å", b: "ƀ", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "î", j: "ĵ", k: "ķ", l: "ļ", m: "ɱ",
  n: "ñ", o: "ö", p: "þ", q: "ǫ", r: "ŕ", s: "š", t: "ţ", u: "û", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
  A: "Å", B: "Ɓ", C: "Ç", D: "Ð", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Î", J: "Ĵ", K: "Ķ", L: "Ļ", M: "Ṁ",
  N: "Ñ", O: "Ö", P: "Þ", Q: "Ǫ", R: "Ŕ", S: "Š", T: "Ţ", U: "Û", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž",
};

/** Accent every ASCII letter, leaving `<0>…</0>` element markers, `#` and everything else alone. */
export function accent(text: string): string {
  // Element markers in a compiled Trans message are `<0>`, `</0>`, `<1/>`: digits only, so the
  // letter swap cannot touch them.
  return text.replace(/[A-Za-z]/g, (ch) => ACCENTED[ch] ?? ch);
}
