import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs build script, typed by use
import { APPLY, androidVersion, withApplied, withVersion } from "../scripts/release-gradle.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The generated app module gets Potyro's version and its release signing from
// android-templates/potyro.gradle (scripts/release-gradle.mjs).

const template = readFileSync(fileURLToPath(new URL("../android-templates/potyro.gradle", import.meta.url)), "utf8");

describe("release-gradle: the version", () => {
  it("turns the product's version into Android's name and code", () => {
    expect(androidVersion("1.2.3")).toEqual({ versionName: "1.2.3", versionCode: 10203 });
    expect(androidVersion("2.10.0")).toEqual({ versionName: "2.10.0", versionCode: 21000 });
    expect(androidVersion("1.0.0-beta.2")).toEqual({ versionName: "1.0.0-beta.2", versionCode: 10000 });
  });

  it("never gives the code 0, which Android refuses", () => {
    expect(androidVersion("0.0.0").versionCode).toBe(1);
  });

  it("orders versions as the codes order them", () => {
    const codes = ["0.0.1", "0.1.0", "0.1.1", "0.99.99", "1.0.0", "1.0.1"].map((v) => androidVersion(v).versionCode);
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("refuses what is not a version, or would not fit", () => {
    expect(() => androidVersion("latest")).toThrow(/not a version/);
    expect(() => androidVersion("1.100.0")).toThrow(/does not fit/);
  });

  it("writes it into the template, where the build's environment can still override it", () => {
    const out = withVersion(template, "1.2.3");
    expect(out).toContain("potyroEnv('POTYRO_VERSION_NAME') ?: '1.2.3'");
    expect(out).toContain("potyroEnv('POTYRO_VERSION_CODE') ?: '10203'");
    expect(out).not.toContain("__VERSION_");
  });
});

describe("release-gradle: signing", () => {
  it("reads the keystore from the environment or a file outside the repository, and holds no secret itself", () => {
    for (const name of ["POTYRO_KEYSTORE", "POTYRO_KEYSTORE_PASSWORD", "POTYRO_KEY_ALIAS", "POTYRO_KEY_PASSWORD", "POTYRO_KEYSTORE_PROPERTIES"]) {
      expect(template).toContain(`'${name}'`);
    }
    expect(template).toContain("System.getProperty('user.home'), '.potyro/keystore.properties'");
    // every password in the build file is a lookup, never a literal
    const code = template.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).toMatch(/storePassword potyroStorePassword/);
    expect(code).toMatch(/keyPassword potyroKeyPassword/);
    expect(code).not.toMatch(/(storePassword|keyPassword|keyAlias)\s+['"]/);
    expect(code).not.toMatch(/\.(jks|keystore)\b/);
  });

  it("signs a release only when a keystore is named, and says so when it is not", () => {
    expect(template).toMatch(/if \(potyroCanSign\) \{\s*signingConfigs \{/);
    expect(template).toMatch(/if \(potyroCanSign\) \{\s*signingConfig signingConfigs\.release/);
    expect(template).toContain("UNSIGNED");
  });
});

describe("release-gradle: applied from the generated build file", () => {
  const generated = "apply plugin: 'com.android.application'\n\nandroid {\n    defaultConfig {\n        versionCode 1\n        versionName \"1.0\"\n    }\n}\n\napply from: 'capacitor.build.gradle'\n";

  it("goes last, so it wins over the template's own version, once", () => {
    const { source, added } = withApplied(generated);
    expect(added).toBe(true);
    expect(source.trimEnd().endsWith(APPLY)).toBe(true);
    expect(source.indexOf(APPLY)).toBeGreaterThan(source.indexOf("versionCode 1"));
    expect(withApplied(source)).toEqual({ source, added: false });
  });
});
