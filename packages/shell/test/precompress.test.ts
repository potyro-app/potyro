// The build's brotli and gzip copies (#48): made for text and Wasm, never for what is compressed
// already or too small to matter, and each one really is the file it sits beside.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { precompressDir } from "../precompress.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "potyro-precompress-"));
  mkdirSync(join(dir, "assets"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SCRIPT = "export const words = 'the same words, again and again';\n".repeat(200);

describe("precompressDir", () => {
  it("writes a brotli and a gzip copy beside a script, and each unpacks to the script", async () => {
    // Arrange
    writeFileSync(join(dir, "assets", "index-abc.js"), SCRIPT);

    // Act
    const done = await precompressDir(dir);

    // Assert
    expect(brotliDecompressSync(readFileSync(join(dir, "assets", "index-abc.js.br"))).toString()).toBe(SCRIPT);
    expect(gunzipSync(readFileSync(join(dir, "assets", "index-abc.js.gz"))).toString()).toBe(SCRIPT);
    expect(done.files).toBe(1);
    expect(done.brotliBytes).toBeLessThan(done.gzipBytes);
    expect(done.gzipBytes).toBeLessThan(done.bytes);
  });

  it("leaves pictures, fonts and tiny files alone", async () => {
    writeFileSync(join(dir, "icon-192.png"), Buffer.alloc(4096, 7));
    writeFileSync(join(dir, "assets", "font.woff2"), Buffer.alloc(4096, 7));
    writeFileSync(join(dir, "robots.txt"), "User-agent: *\n");

    const done = await precompressDir(dir);

    expect(done.files).toBe(0);
    for (const file of ["icon-192.png", "assets/font.woff2", "robots.txt"]) {
      expect(existsSync(join(dir, `${file}.br`)), file).toBe(false);
      expect(existsSync(join(dir, `${file}.gz`)), file).toBe(false);
    }
  });

  it("covers the page, the worker and Wasm, in folders too", async () => {
    for (const file of ["index.html", "sw.js", "assets/esbuild.wasm", "privacy/index.html"]) {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), SCRIPT);
    }

    await precompressDir(dir);

    for (const file of ["index.html", "sw.js", "assets/esbuild.wasm", "privacy/index.html"]) expect(existsSync(join(dir, `${file}.br`)), file).toBe(true);
  });

  it("writes no copy that would be bigger than its file", async () => {
    // Random bytes do not compress: the server sends the file itself.
    const noise = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919 + ((i * i) % 251)) % 256));
    writeFileSync(join(dir, "assets", "noise.wasm"), noise);

    await precompressDir(dir);

    const br = join(dir, "assets", "noise.wasm.br");
    if (existsSync(br)) expect(readFileSync(br).length).toBeLessThan(noise.length);
  });
});
