// The feed: what the gallery has published, as the gallery build writes it (gallery/src/feed.mjs,
// `feed.json` beside the gallery's page). It is the one thing this service reads from Potyro: a
// file, not a package, so the service depends on none (docs/33).
//
// The file is ours, but it is read from disk on a server, so it is checked like anything from
// outside: a feed with a problem is refused whole and the account stays as it was.

export const FEED_FORMAT = "potyro-gallery-feed/1";

/** One text in each language of the feed, by its BCP 47 tag. */
export type Words = Record<string, string>;

export interface FeedImage {
  /** Where the picture is, from the site's root: `shots/en/pantry-light-824.webp`. */
  path: string;
  mediaType: string;
  width: number;
  height: number;
}

export interface FeedApp {
  id: string;
  /** ISO time the app's demo link was made, when the gallery knows it. */
  publishedAt?: string;
  /** The demo link ("Try it"), and the same link asking for Make it mine. */
  link: string;
  remix: string;
  name: Words;
  line: Words;
  image?: FeedImage;
}

export interface Feed {
  format: typeof FEED_FORMAT;
  /** The languages every text is in; the first is the one a reader gets when theirs is not there. */
  languages: string[];
  words: { tryIt: Words; makeItMine: Words; shotAlt: Words };
  apps: FeedApp[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const MEDIA_RE = /^image\/(webp|png|jpeg|avif)$/;
const MAX_TEXT = 500;
const MAX_APPS = 500;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An https address with a host and no credentials, or null. */
export function httpsUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function wordProblems(words: unknown, where: string, languages: string[]): string[] {
  if (!isObject(words)) return [`${where} must have a text in each language`];
  const out: string[] = [];
  for (const lang of languages) {
    const w = words[lang];
    if (typeof w !== "string" || !w.trim()) out.push(`${where} has no ${lang}`);
    else if (w.length > MAX_TEXT) out.push(`${where}.${lang} is longer than ${MAX_TEXT} characters`);
  }
  return out;
}

function imageProblems(image: unknown, where: string): string[] {
  if (image === undefined) return [];
  if (!isObject(image)) return [`${where} must be an object`];
  const out: string[] = [];
  if (typeof image.path !== "string" || !PATH_RE.test(image.path) || image.path.includes("..")) out.push(`${where}.path is not a path under the site`);
  if (typeof image.mediaType !== "string" || !MEDIA_RE.test(image.mediaType)) out.push(`${where}.mediaType is not a picture's`);
  for (const side of ["width", "height"] as const) {
    const n = image[side];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 10_000) out.push(`${where}.${side} is not a size`);
  }
  return out;
}

function appProblems(app: unknown, where: string, languages: string[]): string[] {
  if (!isObject(app)) return [`${where} must be an object`];
  const out: string[] = [];
  if (typeof app.id !== "string" || !ID_RE.test(app.id)) out.push(`${where}.id is not an app's id`);
  if (app.publishedAt !== undefined && (typeof app.publishedAt !== "string" || Number.isNaN(Date.parse(app.publishedAt)))) out.push(`${where}.publishedAt is not a time`);
  for (const key of ["link", "remix"] as const) if (!httpsUrl(app[key])) out.push(`${where}.${key} is not an https address`);
  out.push(...wordProblems(app.name, `${where}.name`, languages), ...wordProblems(app.line, `${where}.line`, languages));
  out.push(...imageProblems(app.image, `${where}.image`));
  return out;
}

/** Every problem of a feed, in words; none when it can be posted from. */
export function feedProblems(data: unknown): string[] {
  if (!isObject(data)) return ["the feed must be an object"];
  if (data.format !== FEED_FORMAT) return [`the feed's format must be ${FEED_FORMAT}`];
  const languages = data.languages;
  if (!Array.isArray(languages) || !languages.length || !languages.every((l): l is string => typeof l === "string" && LANGUAGE_RE.test(l))) {
    return ["the feed names no languages"];
  }
  const out: string[] = [];
  const words = isObject(data.words) ? data.words : {};
  for (const key of ["tryIt", "makeItMine", "shotAlt"]) out.push(...wordProblems(words[key], `words.${key}`, languages));
  const apps = data.apps;
  // An empty list is refused: it would take every post down, and is far more likely a broken build.
  if (!Array.isArray(apps) || !apps.length) return [...out, "the feed has no apps"];
  if (apps.length > MAX_APPS) return [...out, `the feed has more than ${MAX_APPS} apps`];
  apps.forEach((app, i) => out.push(...appProblems(app, `apps[${i}]`, languages)));
  const ids = apps.map((a) => (isObject(a) ? a.id : undefined));
  if (new Set(ids).size !== ids.length) out.push("an app is in the feed twice");
  return out;
}

/** The feed, checked. Throws every problem at once. */
export function readFeed(data: unknown): Feed {
  const problems = feedProblems(data);
  if (problems.length) throw new Error(`The gallery's feed has problems:\n- ${problems.join("\n- ")}`);
  return data as Feed;
}
