// potyro.com as the build writes it: every page complete, every file it names present, nothing inline
// (the server's policy allows no inline style or script), nothing from anyone else, and the numbers
// on the home counted from the gallery, not typed.
import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite, readWords } from "../build.mjs";
import { HOME_APPS } from "../src/home.mjs";
import { readGallery, shownApps } from "../../gallery/src/data.mjs";

const here = new URL("..", import.meta.url).pathname;
let out = "";
let home = "";
let apps = "";

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "potyro-site-"));
  await buildSite({ out });
  home = readFileSync(join(out, "index.html"), "utf8");
  apps = readFileSync(join(out, "apps", "index.html"), "utf8");
}, 120_000);

/** Every local path a page names: href, src, poster, and srcset candidates. */
function localPaths(html: string): string[] {
  const paths = new Set<string>();
  for (const m of html.matchAll(/\b(?:href|src|poster)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(?:https?:|mailto:|#)/.test(url)) continue;
    paths.add(url.split("?")[0].split("#")[0]);
  }
  return [...paths];
}

describe("the words", () => {
  it("every English word is there, and an empty one is refused", () => {
    const words = JSON.parse(readFileSync(join(here, "words.json"), "utf8"));
    expect(() => readWords(words)).not.toThrow();
    expect(() => readWords({ en: { ...words.en, h1: " " } })).toThrow(/h1/);
  });
});

describe("the home", () => {
  it("names only files the build wrote, by their path from the root", () => {
    for (const path of localPaths(home)) {
      expect(path.startsWith("/"), `${path} is not from the root`).toBe(true);
      const file = path.endsWith("/") ? join(out, path, "index.html") : join(out, path);
      expect(existsSync(file), `${path} was not written`).toBe(true);
    }
  });

  it("carries no inline style or script, and loads nothing from anyone else", () => {
    expect(home).not.toMatch(/ style="/);
    expect(home).not.toMatch(/<style[\s>]/);
    expect(home).not.toMatch(/<script(?![^>]*\bsrc=)/);
    for (const m of home.matchAll(/\b(?:href|src|poster)="(https?:\/\/[^"/]+)/g)) {
      expect(["https://potyro.app", "https://potyro.com", "https://github.com"], m[1]).toContain(m[1]);
    }
  });

  it("has one h1, the six apps with their real demo links, and the count from the gallery", () => {
    expect(home.match(/<h1\b/g)).toHaveLength(1);
    const gallery = readGallery(JSON.parse(readFileSync(join(here, "..", "gallery", "gallery.json"), "utf8")));
    const published = shownApps(gallery).published;
    expect(home).toContain(`See all ${published.length} apps`);
    for (const id of HOME_APPS) {
      const app = published.find((a) => a.id === id)!;
      expect(home).toContain(`href="${app.link}"`);
      expect(home).toContain(`href="${app.link}&amp;remix=1"`);
    }
  });

  it("shows the recordings with a poster and two formats, and plays nothing by itself", () => {
    const clips = home.match(/<video\b[^>]*>/g) ?? [];
    expect(clips.length).toBeGreaterThanOrEqual(4);
    for (const tag of clips) {
      expect(tag).toContain('preload="none"');
      expect(tag).toMatch(/poster="\/media\/[\w-]+-poster\.jpg"/);
      expect(tag).not.toContain("autoplay");
    }
    expect(home.match(/type="video\/mp4"/g)!.length).toBe(clips.length);
    expect(home.match(/type="video\/webm"/g)!.length).toBe(clips.length);
  });
});

describe("the apps page", () => {
  it("is the gallery, with its files at the site's root", () => {
    expect(apps).toContain('<link rel="stylesheet" href="/gallery.css?v=');
    expect(apps).toContain('<script src="/gallery.js?v=');
    for (const path of localPaths(apps)) {
      const file = path.endsWith("/") ? join(out, path, "index.html") : join(out, path);
      expect(existsSync(file), `${path} was not written`).toBe(true);
    }
    expect(apps).toContain('id="apps"');
  });

  it("is where the shell sends people, or the shell sends them to the home, which shows apps too", () => {
    // Read as text: the shell's module reads import.meta.env, which this package's types do not know.
    const link = readFileSync(join(here, "..", "packages", "shell", "src", "gallery-link.ts"), "utf8");
    const url = /GALLERY_URL = "([^"]+)"/.exec(link)?.[1];
    expect(["https://potyro.com/", "https://potyro.com/apps/"]).toContain(url);
  });
});
