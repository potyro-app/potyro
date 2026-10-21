/* Potyro — gerador de cores (o relógio de traços)
   Regra: toda cor é só um ângulo (matiz OKLCH, 0–360). Luz e intensidade são do sistema.
   Ver DESIGN.md, seção 3.1.

   No navegador:  <script src="potyro-color.js"></script>
                  PotyroColor.apply(document.documentElement, 135)  // ou PotyroColor.apply(el, "laranja")
   No Node:       const PotyroColor = require("./potyro-color.js")
                  node potyro-color.js            → tabela das 12 horas
                  node potyro-color.js --css      → bloco CSS das 12 horas (vai em potyro-tokens.css)
                  node potyro-color.js 135        → todas as cores do ângulo 135 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PotyroColor = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── Parâmetros do sistema (mude aqui, nunca nas cores) ────────────────
  const P = {
    // Fundos contra os quais o contraste é garantido
    light: { bg: "#ffffff", surface: "#f3f3f4", ink: "#231f20" },
    dark: { bg: "#1c1b1c", surface: "#2a2829", ink: "#1c1b1c" },
    // Traço: a versão mais viva do matiz, com a luz presa nesta faixa
    traco: { minL: 0.62, maxL: 0.8, chroma: 0.88, maxC: 0.19 },
    // Tinta: contraste mínimo de texto
    tinta: { onBg: 5.0, onSurface: 4.6, chroma: 0.9, maxC: 0.2 },
    // Aguada: fundo tingido
    aguada: { light: { L: 0.955, C: 0.032 }, dark: { L: 0.3, C: 0.055 } },
    // Botão usa o traço com texto escuro quando o texto escuro passa este contraste sobre ele
    tracoComTextoEscuro: 4.5,
  };

  // As 12 horas. 12h é o rosa Potyro: só do Potyro, não vai para apps nem categorias.
  const HORAS = [
    { hora: 12, nome: "rosa", hue: 0 },
    { hora: 1, nome: "vermelho", hue: 30 },
    { hora: 2, nome: "laranja", hue: 60 },
    { hora: 3, nome: "amarelo", hue: 90 },
    { hora: 4, nome: "lima", hue: 120 },
    { hora: 5, nome: "verde", hue: 150 },
    { hora: 6, nome: "menta", hue: 180 },
    { hora: 7, nome: "ciano", hue: 210 },
    { hora: 8, nome: "azul", hue: 240 },
    { hora: 9, nome: "anil", hue: 270 },
    { hora: 10, nome: "roxo", hue: 300 },
    { hora: 11, nome: "magenta", hue: 330 },
  ];

  // ── OKLCH ↔ sRGB (Björn Ottosson) ────────────────────────────────────
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  function oklchToLinRgb(L, C, H) {
    const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }
  const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
  function maxChroma(L, H) {
    let lo = 0, hi = 0.4;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinRgb(L, mid, H))) lo = mid; else hi = mid;
    }
    return lo;
  }
  function hex(L, C, H) {
    return "#" + oklchToLinRgb(L, C, H)
      .map((c) => Math.round(Math.min(1, Math.max(0, toGam(Math.min(1, Math.max(0, c))))) * 255)
        .toString(16).padStart(2, "0"))
      .join("");
  }
  function luminance(h) {
    const [r, g, b] = [1, 3, 5].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function hexToHue(h) {
    const [r, g, b] = [1, 3, 5].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  }

  // ── Os três níveis ──────────────────────────────────────────────────
  // Traço: a luz onde o matiz é mais vivo (a "cúspide"), presa na faixa do sistema.
  function traco(H) {
    let best = [0.62, 0];
    for (let L = 0.4; L <= 0.98; L += 0.005) {
      const c = maxChroma(L, H);
      if (c > best[1]) best = [L, c];
    }
    const L = Math.min(P.traco.maxL, Math.max(P.traco.minL, best[0]));
    return hex(L, Math.min(P.traco.maxC, maxChroma(L, H) * P.traco.chroma), H);
  }
  // Tinta: a cor mais clara (no claro) ou mais escura (no escuro) que ainda passa o contraste.
  function tinta(H, theme) {
    const t = P[theme], dir = theme === "light" ? -1 : 1;
    for (let i = 0; i <= 200; i++) {
      const L = theme === "light" ? 0.8 + dir * i * 0.0025 : 0.74 + dir * i * 0.0025;
      const h = hex(L, Math.min(P.tinta.maxC, maxChroma(L, H) * P.tinta.chroma), H);
      if (contrast(h, t.bg) >= P.tinta.onBg && contrast(h, t.surface) >= P.tinta.onSurface) return h;
    }
    return theme === "light" ? t.ink : "#f3f3f4";
  }
  function aguada(H, theme) {
    const a = P.aguada[theme];
    return hex(a.L, Math.min(a.C, maxChroma(a.L, H)), H);
  }

  // ── Uma cor completa a partir de um ângulo ou de um nome de hora ─────
  function resolveHue(x) {
    if (typeof x === "number") return ((x % 360) + 360) % 360;
    if (typeof x === "string" && x.startsWith("#")) return hexToHue(x);
    const h = HORAS.find((h) => h.nome === x || String(h.hora) === String(x));
    if (!h) throw new Error('Cor desconhecida: "' + x + '". Use um ângulo (0–360), um hex ou um nome de hora.');
    return h.hue;
  }
  function cor(x) {
    const H = resolveHue(x);
    const T = traco(H);
    const lt = tinta(H, "light"), dt = tinta(H, "dark");
    const claroComEscuro = contrast(T, P.light.ink) >= P.tracoComTextoEscuro;
    const escuroComEscuro = contrast(T, P.dark.ink) >= P.tracoComTextoEscuro;
    return {
      hue: Math.round(H * 10) / 10,
      hora: horaMaisProxima(H),
      light: {
        traco: T,
        tinta: lt,
        aguada: aguada(H, "light"),
        accent: claroComEscuro ? T : lt,
        onAccent: claroComEscuro ? P.light.ink : "#ffffff",
      },
      dark: {
        traco: T,
        tinta: dt,
        aguada: aguada(H, "dark"),
        accent: escuroComEscuro ? T : dt,
        onAccent: P.dark.ink,
      },
    };
  }
  function horaMaisProxima(H) {
    let best = HORAS[0], d = 999;
    for (const h of HORAS) {
      const dd = Math.min(Math.abs(h.hue - H), 360 - Math.abs(h.hue - H));
      if (dd < d) { d = dd; best = h; }
    }
    return best.hora;
  }

  // Categorias: começam na hora do app e andam 5 horas por vez, pulando o 12h (rosa Potyro).
  function categorias(x, n) {
    const start = horaMaisProxima(resolveHue(x)) % 12;
    const out = [];
    for (let k = 0; out.length < n && k < 24; k++) {
      const h = (start + 5 * k) % 12;
      if (h === 0) continue;
      const hh = HORAS.find((o) => o.hora % 12 === h);
      if (!out.includes(hh.nome)) out.push(hh.nome);
    }
    return out;
  }

  // Variáveis CSS de um traço, para um tema
  function vars(c, theme) {
    const t = c[theme];
    return {
      "--hue": String(c.hue),
      "--traco": t.traco,
      "--tinta": t.tinta,
      "--aguada": t.aguada,
      "--accent": t.accent,
      "--on-accent": t.onAccent,
      "--focus": t.tinta,
    };
  }
  // Aplica num elemento (normalmente <html>), seguindo o tema atual
  function apply(el, x) {
    const c = cor(x);
    const dark = el.getAttribute("data-theme") === "dark" ||
      (el.getAttribute("data-theme") !== "light" && typeof matchMedia === "function" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    const v = vars(c, dark ? "dark" : "light");
    for (const k in v) el.style.setProperty(k, v[k]);
    return c;
  }

  return { P, HORAS, cor, categorias, apply, vars, contrast, hexToHue, horaMaisProxima };
});

// ── CLI ───────────────────────────────────────────────────────────────
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  const PC = module.exports, arg = process.argv[2];
  const line = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v};`).join(" ");
  if (arg === "--css") {
    const L = [], D = [];
    for (const h of PC.HORAS) {
      const c = PC.cor(h.nome);
      const sel = h.nome === "rosa" ? ":root" : `[data-traco="${h.nome}"]`;
      L.push(`${sel} { ${line(PC.vars(c, "light"))} }`);
      D.push(`${h.nome === "rosa" ? "" : `[data-traco="${h.nome}"]`}{ ${line(PC.vars(c, "dark"))} }`);
    }
    const cats = PC.HORAS.filter((h) => h.hora !== 12).map((h) => {
      const c = PC.cor(h.nome);
      return { n: h.nome, l: `--cat-${h.nome}: ${c.light.tinta}; --cat-${h.nome}-fill: ${c.light.traco}; --cat-${h.nome}-soft: ${c.light.aguada};`,
        d: `--cat-${h.nome}: ${c.dark.tinta}; --cat-${h.nome}-soft: ${c.dark.aguada};` };
    });
    console.log(JSON.stringify({ light: L, dark: D, catsLight: cats.map((c) => c.l), catsDark: cats.map((c) => c.d) }, null, 1));
  } else if (arg !== undefined) {
    const x = isNaN(Number(arg)) ? arg : Number(arg);
    console.log(JSON.stringify(PC.cor(x), null, 2));
    console.log("categorias:", PC.categorias(x, 6).join(", "));
  } else {
    console.log("hora  nome      hue  traço    tinta    aguada   botão (claro)        | tinta    aguada   (escuro)");
    for (const h of PC.HORAS) {
      const c = PC.cor(h.nome), l = c.light, d = c.dark;
      console.log(
        `${String(h.hora).padStart(2)}h  ${h.nome.padEnd(9)} ${String(h.hue).padStart(3)}  ${l.traco}  ${l.tinta}  ${l.aguada}  ${l.accent}/${l.onAccent === "#ffffff" ? "branco " : "grafite"} ${PC.contrast(l.accent, l.onAccent).toFixed(1)} | ${d.tinta}  ${d.aguada}` +
        `  ✓ tinta/bg ${PC.contrast(l.tinta, "#ffffff").toFixed(1)} tinta/aguada ${PC.contrast(l.tinta, l.aguada).toFixed(1)} dk ${PC.contrast(d.tinta, "#1c1b1c").toFixed(1)}/${PC.contrast(d.tinta, "#2a2829").toFixed(1)}/${PC.contrast(d.tinta, d.aguada).toFixed(1)}`);
    }
  }
}
