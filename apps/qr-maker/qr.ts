// A QR code from text, in plain TypeScript: byte mode (UTF-8), the forty versions, the four error
// correction levels, Reed–Solomon over GF(256), the eight masks scored by the standard's penalties,
// format and version information. After Project Nayuki's reference algorithm (ISO/IEC 18004), with
// no library and no network: a code is made on the device and nothing leaves it.
//
// `encode(text, ecl)` answers the module matrix — `true` is dark — and the tests prove every code it
// makes reads back with an independent decoder (jsQR).

export type Ecl = "L" | "M" | "Q" | "H";

export interface Matrix {
  /** Modules per side. */
  size: number;
  version: number;
  ecl: Ecl;
  mask: number;
  /** `modules[y][x]`, `true` = dark. */
  modules: boolean[][];
}

const ECL_BITS: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };
const ECL_INDEX: Record<Ecl, number> = { L: 0, M: 1, Q: 2, H: 3 };

// Rows: L, M, Q, H; index by version (0 unused).
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** How many data modules a version has in all, function patterns left out. */
function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

/** Data codewords (bytes) a version holds at a level, before error correction. */
export function numDataCodewords(ver: number, ecl: Ecl): number {
  const e = ECL_INDEX[ecl];
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[e]![ver]! * NUM_ERROR_CORRECTION_BLOCKS[e]![ver]!;
}

/** The most bytes a version holds in byte mode at a level. */
export function byteCapacity(ver: number, ecl: Ecl): number {
  const ccBits = ver <= 9 ? 8 : 16;
  return Math.floor((numDataCodewords(ver, ecl) * 8 - 4 - ccBits) / 8);
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// ---- Reed–Solomon over GF(256), reducing polynomial x^8 + x^4 + x^3 + x^2 + 1 ----

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i]! ^= gfMultiply(coef, factor)));
  }
  return result;
}

const getBit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

/** The bytes of `text` as the code carries them, UTF-8. */
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * The smallest version at `ecl` that holds `text`, or null when even version 40 cannot. Up to
 * `maxVersion` (default 40).
 */
export function versionFor(text: string, ecl: Ecl, maxVersion = 40): number | null {
  const bytes = utf8(text).length;
  for (let v = 1; v <= maxVersion; v++) if (byteCapacity(v, ecl) >= bytes) return v;
  return null;
}

/**
 * The code for `text`: the smallest version that holds it at `ecl`, the mask the penalties prefer.
 * Throws when the text does not fit in version 40 (2,953 bytes at L).
 */
export function encode(text: string, ecl: Ecl = "M"): Matrix {
  const data = utf8(text);
  const version = versionFor(text, ecl);
  if (version === null) throw new Error("Too long for a QR code");
  const size = version * 4 + 17;
  const ccBits = version <= 9 ? 8 : 16;
  const dataCapacityBits = numDataCodewords(version, ecl) * 8;

  // ---- the data bits: mode, count, the bytes, terminator, padding ----
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0x4, 4);
  push(data.length, ccBits);
  for (const b of data) push(b, 8);
  push(0, Math.min(4, dataCapacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < dataCapacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(""), 2));

  // ---- error correction, interleaved ----
  const e = ECL_INDEX[ecl];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[e]![version]!;
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e]![version]!;
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = codewords.slice(k, k + datLen);
    k += datLen;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const all: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) all.push(block[i]!);
    });
  }

  // ---- the matrix: function patterns first, then the codewords, then the best mask ----
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setFn = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    isFunction[y]![x] = true;
  };
  const drawFinder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
      }
  };
  const drawAlignment = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  };
  const drawFormatBits = (mask: number) => {
    const d = (ECL_BITS[ecl] << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fb = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, getBit(fb, i));
    setFn(8, 7, getBit(fb, 6));
    setFn(8, 8, getBit(fb, 7));
    setFn(7, 8, getBit(fb, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(fb, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(fb, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(fb, i));
    setFn(8, size - 8, true);
  };
  const drawVersion = () => {
    if (version < 7) return;
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vb = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(vb, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  };
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);
  const aligns = alignmentPositions(version);
  const n = aligns.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      drawAlignment(aligns[i]!, aligns[j]!);
    }
  drawFormatBits(0);
  drawVersion();

  // The codewords, in the zigzag the standard reads them back in.
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y]![x] && bitIndex < all.length * 8) {
          modules[y]![x] = getBit(all[bitIndex >>> 3]!, 7 - (bitIndex & 7));
          bitIndex++;
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!isFunction[y]![x] && invert) modules[y]![x] = !modules[y]![x];
      }
  };

  // ---- the penalties, so the chosen mask reads well ----
  const addHistory = (runLength: number, history: number[]) => {
    if (history[0] === 0) runLength += size;
    history.pop();
    history.unshift(runLength);
  };
  const countPatterns = (h: number[]): number => {
    const c = h[1]!;
    const core = c > 0 && h[2] === c && h[3] === c * 3 && h[4] === c && h[5] === c;
    return (core && h[0]! >= c * 4 && h[6]! >= c ? 1 : 0) + (core && h[6]! >= c * 4 && h[0]! >= c ? 1 : 0);
  };
  const terminateAndCount = (runColor: boolean, runLength: number, history: number[]): number => {
    if (runColor) {
      addHistory(runLength, history);
      runLength = 0;
    }
    runLength += size;
    addHistory(runLength, history);
    return countPatterns(history);
  };
  const penalty = (): number => {
    let result = 0;
    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runX = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        if (modules[y]![x] === runColor) {
          runX++;
          if (runX === 5) result += PENALTY_N1;
          else if (runX > 5) result++;
        } else {
          addHistory(runX, history);
          if (!runColor) result += countPatterns(history) * PENALTY_N3;
          runColor = modules[y]![x]!;
          runX = 1;
        }
      }
      result += terminateAndCount(runColor, runX, history) * PENALTY_N3;
    }
    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runY = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        if (modules[y]![x] === runColor) {
          runY++;
          if (runY === 5) result += PENALTY_N1;
          else if (runY > 5) result++;
        } else {
          addHistory(runY, history);
          if (!runColor) result += countPatterns(history) * PENALTY_N3;
          runColor = modules[y]![x]!;
          runY = 1;
        }
      }
      result += terminateAndCount(runColor, runY, history) * PENALTY_N3;
    }
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y]![x];
        if (c === modules[y]![x + 1] && c === modules[y + 1]![x] && c === modules[y + 1]![x + 1]) result += PENALTY_N2;
      }
    let dark = 0;
    for (const row of modules) for (const m of row) if (m) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  };

  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormatBits(m);
    const score = penalty();
    if (score < bestScore) {
      best = m;
      bestScore = score;
    }
    applyMask(m); // undo: a mask is its own inverse
  }
  applyMask(best);
  drawFormatBits(best);
  return { size, version, ecl, mask: best, modules };
}

// ---- pictures of a code ----

/** RGBA pixels of a code, `scale` pixels a module, `quiet` modules of white around: what a decoder, or a canvas, reads. */
export function rgbaOf(m: Matrix, scale = 4, quiet = 4): { width: number; height: number; data: Uint8ClampedArray } {
  const side = (m.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++) {
      if (!m.modules[y]![x]) continue;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y + quiet) * scale + dy) * side * 4 + ((x + quiet) * scale + dx) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
    }
  return { width: side, height: side, data };
}

// A PNG written by hand, 1 bit a pixel, deflate's stored blocks and nothing compressed: a code is
// small anyway, and this needs no canvas, so it is the same in a page, a worker and a test.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function chunk(type: string, body: number[]): number[] {
  const typed = [...type].map((c) => c.charCodeAt(0));
  const crc = crc32(new Uint8Array([...typed, ...body]));
  return [...be32(body.length), ...typed, ...body, ...be32(crc)];
}

/** `raw` wrapped as a zlib stream of stored deflate blocks (no compression), with its Adler-32. */
function zlibStored(raw: number[]): number[] {
  const out = [0x78, 0x01];
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  for (let b = 0; b < blocks; b++) {
    const part = raw.slice(b * 65535, (b + 1) * 65535);
    out.push(b === blocks - 1 ? 1 : 0, part.length & 0xff, part.length >>> 8, ~part.length & 0xff, (~part.length >>> 8) & 0xff, ...part);
  }
  let a = 1;
  let s = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    s = (s + a) % 65521;
  }
  out.push(...be32(((s << 16) | a) >>> 0));
  return out;
}

/** The code as a PNG, black on white, `scale` pixels a module, `quiet` modules of white around. */
export function pngOf(m: Matrix, scale = 8, quiet = 4): Uint8Array {
  const side = (m.size + quiet * 2) * scale;
  const rowBytes = Math.ceil(side / 8);
  const raw: number[] = [];
  for (let py = 0; py < side; py++) {
    raw.push(0); // filter: none
    const my = Math.floor(py / scale) - quiet;
    const row = new Array<number>(rowBytes).fill(0);
    for (let px = 0; px < side; px++) {
      const mx = Math.floor(px / scale) - quiet;
      const dark = my >= 0 && my < m.size && mx >= 0 && mx < m.size && m.modules[my]![mx]!;
      if (!dark) row[px >> 3]! |= 0x80 >> (px & 7); // 1 = white at bit depth 1, greyscale
    }
    raw.push(...row);
  }
  const ihdr = [...be32(side), ...be32(side), 1, 0, 0, 0, 0];
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", ihdr), ...chunk("IDAT", zlibStored(raw)), ...chunk("IEND", [])]);
}

/** Draw a code on a square canvas, filling it: white ground, black modules, `quiet` modules of margin. */
export function drawOn(canvas: HTMLCanvasElement, m: Matrix, quiet = 4): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  const side = canvas.width;
  const px = side / (m.size + quiet * 2);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, side, side);
  g.fillStyle = "#000";
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++) {
      if (!m.modules[y]![x]) continue;
      const x0 = Math.round((x + quiet) * px);
      const y0 = Math.round((y + quiet) * px);
      g.fillRect(x0, y0, Math.round((x + quiet + 1) * px) - x0, Math.round((y + quiet + 1) * px) - y0);
    }
}
