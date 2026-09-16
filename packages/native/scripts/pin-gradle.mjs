// Pin the generated Android project to build tools the installed Android Studio can open.
//
// `cap add android` writes whatever the Capacitor version ships with — today AGP 8.13 and Gradle
// 8.14 — and a Studio older than that refuses to open the project at all: "The project is using an
// incompatible version (AGP 8.13.0) of the Android Gradle plugin. Latest supported version is AGP
// 8.9.2." The generated `android/` is gitignored, so the pin cannot live in a committed file; it is
// re-applied here after every `cap add` / `cap sync`, beside the manifest patch, and is idempotent.
//
// Why pin down rather than tell people to upgrade Studio: the Android target is built by whoever has
// a device, and a toolchain that will not open is a worse default than one release behind. Override
// with `KARTA_AGP=8.13.0 KARTA_GRADLE=8.14.3 pnpm cap:sync` (or `KARTA_AGP=keep`) on a newer Studio.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const AGP = process.env.KARTA_AGP ?? "8.9.2";
const GRADLE = process.env.KARTA_GRADLE ?? "8.11.1"; // the newest Gradle AGP 8.9 accepts

if (AGP === "keep") {
  console.log("[pin-gradle] KARTA_AGP=keep — leaving the generated versions alone.");
  process.exit(0);
}

const at = (p) => fileURLToPath(new URL(`../android/${p}`, import.meta.url));
const root = at("build.gradle");
if (!existsSync(root)) {
  console.error("[pin-gradle] android/ not found — run `pnpm cap:add:android` first.");
  process.exit(1);
}

let changed = [];

const gradleFile = readFileSync(root, "utf8");
const pinned = gradleFile.replace(/com\.android\.tools\.build:gradle:[\d.]+/, `com.android.tools.build:gradle:${AGP}`);
if (pinned !== gradleFile) {
  writeFileSync(root, pinned);
  changed.push(`AGP ${AGP}`);
}

const wrapperPath = at("gradle/wrapper/gradle-wrapper.properties");
const wrapper = readFileSync(wrapperPath, "utf8");
const wrapped = wrapper.replace(/gradle-[\d.]+-(all|bin)\.zip/, `gradle-${GRADLE}-$1.zip`);
if (wrapped !== wrapper) {
  writeFileSync(wrapperPath, wrapped);
  changed.push(`Gradle ${GRADLE}`);
}

// AGP 8.9 has not been tested against compileSdk 36 and stops the build over it. The warning is the
// honest state of things; failing the build for it is not, when every dependency here targets 36.
const propsPath = at("gradle.properties");
const props = readFileSync(propsPath, "utf8");
if (!props.includes("android.suppressUnsupportedCompileSdk")) {
  const compileSdk = /compileSdkVersion\s*=\s*(\d+)/.exec(readFileSync(at("variables.gradle"), "utf8"))?.[1] ?? "36";
  appendFileSync(propsPath, `\n# AGP ${AGP} predates compileSdk ${compileSdk}; the warning is fine, stopping the build is not.\nandroid.suppressUnsupportedCompileSdk=${compileSdk}\n`);
  changed.push("suppressUnsupportedCompileSdk");
}

console.log(changed.length ? `[pin-gradle] pinned ${changed.join(", ")}.` : "[pin-gradle] already pinned — nothing to do.");
