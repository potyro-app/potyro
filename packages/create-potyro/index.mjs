// `npm create potyro <name>` — a folder with a Potyro app in it that packs, tests and typechecks.
//
// The template is template/ beside this file, copied as it is with three words filled in: __NAME__
// (the folder's name, which is also the app's id and its file's name), __TITLE__ (the name people see)
// and __POTYRO_VERSION__ (the `potyro` this release goes with: the two are released together).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = fileURLToPath(new URL("./template", import.meta.url));
const VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
/** Files npm will not publish under their own name: shipped renamed, given their name back here. */
const RENAMED = { _gitignore: ".gitignore" };

/** The app's id, from what the person typed: a lowercase slug, as `defineApp` wants its `id`. */
export function slugOf(name) {
  return basename(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "reading-list" → "Reading list". */
export function titleOf(slug) {
  const words = slug.replace(/-+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Copy the template into `dir`. Returns what was written, relative to `dir`. */
export function create(dir, { title } = {}) {
  const name = slugOf(dir);
  if (!name) throw new Error(`"${dir}" has no letters or digits to name the app by`);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty: choose a new folder`);
  const words = { __NAME__: name, __TITLE__: title ?? titleOf(name), __POTYRO_VERSION__: VERSION };
  const fill = (text) => text.replace(/__NAME__|__TITLE__|__POTYRO_VERSION__/g, (k) => words[k]);
  const written = [];
  const copy = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
      const src = join(from, entry);
      const dst = join(to, fill(RENAMED[entry] ?? entry));
      if (statSync(src).isDirectory()) copy(src, dst);
      else {
        writeFileSync(dst, fill(readFileSync(src, "utf8")));
        written.push(relative(dir, dst));
      }
    }
  };
  copy(TEMPLATE, dir);
  return written.sort();
}

