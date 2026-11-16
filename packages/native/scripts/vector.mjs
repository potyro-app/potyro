// The little geometry the brand scripts need, with no dependency: read the design package's logo
// SVGs (three kinds of element — rect, circle, path — each with a fill), move them into another
// box, and say them again as Android path data or as polygons for the rasteriser (png.mjs).
//
// Why not a browser or an image library: this runs after every `cap add` / `cap sync`, on whatever
// machine has a phone attached, and a brand step that needs Playwright's Chromium or a native
// module is one that gets skipped. The logo is a dozen curves; the arithmetic is small.
//
// Nothing here redraws the mark: the numbers are the designer's, moved and scaled uniformly. A
// circle and a rounded corner are said as cubic curves (the usual 0.5523 approximation, off by
// 0.02 % of the radius), because Android path data and the rasteriser both want one kind of curve.

const KAPPA = 0.5522847498307936;

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};
const num = (tag, name) => Number(attr(tag, name) ?? 0);

/** A path's `d` as absolute subpaths of lines and cubics. Throws on a command the logo never uses. */
export function parsePath(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) ?? [];
  const subpaths = [];
  let i = 0;
  let cmd = null;
  let x = 0, y = 0, startX = 0, startY = 0;
  let lastCtrl = null;
  let current = null;
  const next = () => {
    if (i >= tokens.length || /[a-zA-Z]/.test(tokens[i])) throw new Error(`path data ends inside "${cmd}"`);
    return Number(tokens[i++]);
  };
  const line = (nx, ny) => {
    current.segs.push({ type: "L", pts: [nx, ny] });
    x = nx; y = ny; lastCtrl = null;
  };
  const cubic = (x1, y1, x2, y2, nx, ny) => {
    current.segs.push({ type: "C", pts: [x1, y1, x2, y2, nx, ny] });
    lastCtrl = [x2, y2]; x = nx; y = ny;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    else if (cmd === null || cmd === "Z" || cmd === "z") throw new Error("path data has numbers with no command");
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": {
        x = ox + next(); y = oy + next();
        startX = x; startY = y; lastCtrl = null;
        current = { start: [x, y], segs: [], closed: false };
        subpaths.push(current);
        break;
      }
      case "L": { const nx = ox + next(), ny = oy + next(); line(nx, ny); break; }
      case "H": line(ox + next(), y); break;
      case "V": line(x, oy + next()); break;
      case "C": {
        const p = [next(), next(), next(), next(), next(), next()];
        cubic(ox + p[0], oy + p[1], ox + p[2], oy + p[3], ox + p[4], oy + p[5]);
        break;
      }
      case "S": {
        const [cx, cy] = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const p = [next(), next(), next(), next()];
        cubic(cx, cy, ox + p[0], oy + p[1], ox + p[2], oy + p[3]);
        break;
      }
      case "Z": current.closed = true; x = startX; y = startY; lastCtrl = null; break;
      default: throw new Error(`path command "${cmd}" is not one the logo uses — teach vector.mjs before using it`);
    }
  }
  return subpaths;
}

/** A circle as one closed subpath of four cubics. */
export function circlePath(cx, cy, r) {
  const k = r * KAPPA;
  return [{
    start: [cx + r, cy],
    closed: true,
    segs: [
      { type: "C", pts: [cx + r, cy + k, cx + k, cy + r, cx, cy + r] },
      { type: "C", pts: [cx - k, cy + r, cx - r, cy + k, cx - r, cy] },
      { type: "C", pts: [cx - r, cy - k, cx - k, cy - r, cx, cy - r] },
      { type: "C", pts: [cx + k, cy - r, cx + r, cy - k, cx + r, cy] },
    ],
  }];
}

/** A rectangle, its corners rounded by `r`, as one closed subpath. */
export function rectPath(x, y, w, h, r = 0) {
  const k = r * KAPPA;
  const x1 = x + w, y1 = y + h;
  const segs = [{ type: "L", pts: [x1 - r, y] }];
  if (r) segs.push({ type: "C", pts: [x1 - r + k, y, x1, y + r - k, x1, y + r] });
  segs.push({ type: "L", pts: [x1, y1 - r] });
  if (r) segs.push({ type: "C", pts: [x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1] });
  segs.push({ type: "L", pts: [x + r, y1] });
  if (r) segs.push({ type: "C", pts: [x + r - k, y1, x, y1 - r + k, x, y1 - r] });
  segs.push({ type: "L", pts: [x, y + r] });
  if (r) segs.push({ type: "C", pts: [x, y + r - k, x + r - k, y, x + r, y] });
  return [{ start: [x + r, y], closed: true, segs }];
}

/**
 * One of the design package's logo files as shapes, in document order:
 * `{ kind, fill, subpaths, circle?, rect? }`. `circle` / `rect` keep the element's own numbers, so a
 * caller can tell a tile's background from the mark and read its centre and size.
 */
export function parseSvg(svg) {
  const shapes = [];
  for (const m of svg.matchAll(/<(rect|circle|path)\b[^>]*>/g)) {
    const tag = m[0];
    const fill = (attr(tag, "fill") ?? "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(fill)) throw new Error(`a <${m[1]}> with no plain #rrggbb fill: ${tag.slice(0, 80)}`);
    if (m[1] === "circle") {
      const c = { cx: num(tag, "cx"), cy: num(tag, "cy"), r: num(tag, "r") };
      shapes.push({ kind: "circle", fill, circle: c, subpaths: circlePath(c.cx, c.cy, c.r) });
    } else if (m[1] === "rect") {
      const r = { x: num(tag, "x"), y: num(tag, "y"), width: num(tag, "width"), height: num(tag, "height"), rx: num(tag, "rx") };
      shapes.push({ kind: "rect", fill, rect: r, subpaths: rectPath(r.x, r.y, r.width, r.height, r.rx) });
    } else {
      shapes.push({ kind: "path", fill, subpaths: parsePath(attr(tag, "d") ?? "") });
    }
  }
  if (shapes.length === 0) throw new Error("no shapes in the SVG");
  return shapes;
}

/** Subpaths scaled by `k` about `from` and put down at `to` — uniform, so nothing is distorted. */
export function place(subpaths, { from, to, k }) {
  const px = (v) => (v - from[0]) * k + to[0];
  const py = (v) => (v - from[1]) * k + to[1];
  const move = (pts) => pts.map((v, i) => (i % 2 === 0 ? px(v) : py(v)));
  return subpaths.map((s) => ({ start: move(s.start), closed: s.closed, segs: s.segs.map((g) => ({ type: g.type, pts: move(g.pts) })) }));
}

const points = (subpaths) => subpaths.flatMap((s) => [s.start, ...s.segs.flatMap((g) => { const o = []; for (let i = 0; i < g.pts.length; i += 2) o.push([g.pts[i], g.pts[i + 1]]); return o; })]);

/** The box of the control points: never smaller than the shape, and for this logo within a hair of it. */
export function bounds(subpaths) {
  const pts = points(subpaths);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** The farthest any control point is from `centre` — an upper bound on how far the ink reaches. */
export function reach(subpaths, centre) {
  return Math.max(...points(subpaths).map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1])));
}

const f = (v) => String(Math.round(v * 1000) / 1000);

/** Android `pathData`: absolute M / L / C / Z with every number written out, nothing a parser can misread. */
export function toPathData(subpaths) {
  return subpaths
    .map((s) => `M${f(s.start[0])},${f(s.start[1])}` + s.segs.map((g) => {
      const p = g.pts.map(f);
      return g.type === "L" ? ` L${p[0]},${p[1]}` : ` C${p[0]},${p[1]} ${p[2]},${p[3]} ${p[4]},${p[5]}`;
    }).join("") + (s.closed ? " Z" : ""))
    .join(" ");
}

/** Subpaths as closed polygons, each curve cut finely enough that a chord is under ~2 units long. */
export function flatten(subpaths) {
  return subpaths.map((s) => {
    const poly = [s.start];
    let [x, y] = s.start;
    for (const g of s.segs) {
      if (g.type === "L") {
        poly.push([g.pts[0], g.pts[1]]);
      } else {
        const [x1, y1, x2, y2, x3, y3] = g.pts;
        const len = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
        const n = Math.min(256, Math.max(8, Math.ceil(len / 2)));
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          poly.push([
            u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          ]);
        }
      }
      x = g.pts[g.pts.length - 2]; y = g.pts[g.pts.length - 1];
    }
    return poly;
  });
}
