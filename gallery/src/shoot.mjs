#!/usr/bin/env node
// `pnpm gallery:shoot` — take every gallery app's pictures again, from this checkout, in one command (#33).
//
//   pnpm gallery:shoot [--only groceries,plants] [--no-build] [--headed]
//
// It builds the shell as it is here (`vite build`), serves that build on a port the system hands out
// (`vite preview --strictPort`: a port someone else holds stops it, it never joins their server), checks
// that what answers there IS this build, and runs `gallery:publish --shots-only` against it: each app's
// demo link is made for the occasion and thrown away, its pictures are written under gallery/shots in
// every language, theme, format and width (data.mjs), and its link in gallery.json stays as it is.
// Nothing is published: nothing leaves this machine but what the apps themselves fetch (a map's
// tiles, the earthquakes' feed), as they do for anyone who opens them.
//
// Look at every picture before committing it, light and dark: they are the product's face.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publish } from "./publish.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHELL = join(ROOT, "packages", "shell");
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const VITE = ["--filter", "@potyro/shell", "exec", "vite"];

/** A port nobody holds right now, from the system. @returns {Promise<number>} */
function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (probe.address());
      probe.close(() => done(port));
    });
  });
}

/**
 * Serve the build; resolve once the page that answers is this build's own index.html, byte for byte
 * (its script names carry the build's hashes, so another checkout's server cannot pass for it).
 * @param {number} port
 */
async function serveBuild(port) {
  const server = spawn(PNPM, [...VITE, "preview", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  let said = "";
  server.stdout.on("data", (d) => (said += d));
  server.stderr.on("data", (d) => (said += d));
  const stop = () => {
    if (server.exitCode !== null) return;
    // The whole group: pnpm's child is the server.
    try {
      if (process.platform === "win32") server.kill();
      else process.kill(-(/** @type {number} */ (server.pid)), "SIGTERM");
    } catch {
      /* already gone */
    }
  };
  const url = `http://127.0.0.1:${port}/`;
  const built = readFileSync(join(SHELL, "dist", "index.html"), "utf8");
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`the build's server stopped:\n${said}`);
    const page = await fetch(url).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    if (page === built) return { url, stop };
    if (page !== null) {
      stop();
      throw new Error(`${url} answers, but not with this checkout's build: something else is on that port`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  stop();
  throw new Error(`the build's server never answered on ${url}:\n${said}`);
}

const args = process.argv.slice(2);
const take = (/** @type {string} */ flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

let stop = () => {};
try {
  if (!args.includes("--no-build")) {
    console.log("building the shell…");
    const build = spawnSync(PNPM, [...VITE, "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
    if (build.status !== 0) throw new Error("the shell did not build");
  }
  const served = await serveBuild(await freePort());
  stop = served.stop;
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });
  console.log(`shooting this checkout's build on ${served.url}`);
  const outcomes = await publish({ site: served.url, shotsOnly: true, only: take("--only")?.split(",").filter(Boolean), headed: args.includes("--headed") });
  const failed = outcomes.filter((o) => o.outcome === "failed");
  console.log(`shot ${outcomes.length - failed.length} apps, failed ${failed.length}${failed.length ? `: ${failed.map((o) => o.id).join(", ")}` : ""}`);
  console.log("Look at every picture under gallery/shots before committing it.");
  process.exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  stop();
}
// The server's pipes would keep this alive after it has gone.
process.exit();
