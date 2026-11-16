// Give the generated app module Potyro's version and its release signing (android/ is gitignored and
// regenerated): copies android-templates/potyro.gradle beside app/build.gradle with the product's
// version written in, and applies it from there. Idempotent.
//
// The template says where a keystore is read from — the environment, or a properties file outside
// the repository. This script never reads, creates or prints one.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const APPLY = "apply from: 'potyro.gradle'";

/**
 * A semver as Android's two version fields: the name as written, the code major·10000 + minor·100 +
 * patch and never below 1 (Android refuses 0). A pre-release tag stays in the name only. Throws on
 * anything that is not a version, and on a minor or patch that would spill into its neighbour.
 */
export function androidVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version).trim());
  if (!m) throw new Error(`"${version}" is not a version (major.minor.patch)`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (minor > 99 || patch > 99) throw new Error(`"${version}": a minor or patch above 99 does not fit the version code`);
  return { versionName: String(version).trim(), versionCode: Math.max(1, major * 10000 + minor * 100 + patch) };
}

/** The template with the version written in. Pure. */
export function withVersion(template, version) {
  const { versionName, versionCode } = androidVersion(version);
  return template.replaceAll("__VERSION_NAME__", versionName).replaceAll("__VERSION_CODE__", String(versionCode));
}

/** app/build.gradle applying potyro.gradle, once, after everything the template sets. Pure. */
export function withApplied(buildGradle) {
  if (buildGradle.includes(APPLY)) return { source: buildGradle, added: false };
  return { source: `${buildGradle.replace(/\s*$/, "")}\n\n// Potyro's version and release signing (scripts/release-gradle.mjs).\n${APPLY}\n`, added: true };
}

// Running it (rather than importing it) patches the generated project.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const at = (p) => fileURLToPath(new URL(p, import.meta.url));
  const buildGradle = at("../android/app/build.gradle");
  if (!existsSync(buildGradle)) {
    console.error("[release-gradle] android/ not found — run `pnpm cap:add:android` first.");
    process.exit(1);
  }
  const { version } = JSON.parse(readFileSync(at("../../../package.json"), "utf8"));
  writeFileSync(at("../android/app/potyro.gradle"), withVersion(readFileSync(at("../android-templates/potyro.gradle"), "utf8"), version));
  const applied = withApplied(readFileSync(buildGradle, "utf8"));
  if (applied.added) writeFileSync(buildGradle, applied.source);
  const v = androidVersion(version);
  console.log(`[release-gradle] version ${v.versionName} (code ${v.versionCode}), release signing from the environment${applied.added ? "; applied in app/build.gradle" : ""}.`);
}
