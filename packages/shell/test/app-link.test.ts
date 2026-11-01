// @vitest-environment happy-dom
//
// Links that open an app at one of its pages (docs/24 §11): what a link says, read back the way a
// hostile one is (cut, silently); which app on this device it opens; the demo link it is made from.
import { beforeEach, describe, expect, it } from "vitest";
import { LINK_LIMITS } from "potyro";
import { packAppPackage, readAppPackage } from "@potyro/store";
import {
  derivedLine,
  holdArrival,
  lineFor,
  matchLinkedApp,
  newLine,
  readAppTarget,
  takeArrival,
  targetFragment,
  withAppTarget,
} from "../src/app-link.js";
import { demoLinkText, readDemoLink, remixLink } from "../src/demo-link.js";
import { demoSignature, makeAppLink } from "../src/app-link-make.js";
import { shareRequest } from "../src/ui-bridge.js";
import type { UserApp } from "../src/user-apps.js";

const ID = "AbCdEfGhIjKlMnOpQrStUv";
const DEMO = `https://potyro.app/s/${ID}#k=secret`;

describe("a link's target", () => {
  it("goes on a demo link after its key, and reads back", () => {
    const link = withAppTarget(DEMO, { line: "id:draw-guess", page: "play", params: { code: "KQ7MXR4P2DHC" } });
    expect(link).toBe(`${DEMO}&app=id%3Adraw-guess&to=play&p.code=KQ7MXR4P2DHC`);
    const hash = link.slice(link.indexOf("#"));
    expect(readAppTarget(hash)).toEqual({ line: "id:draw-guess", page: "play", params: { code: "KQ7MXR4P2DHC" } });
    // The demo is still the demo: its key, unchanged.
    expect(readDemoLink(`/s/${ID}`, hash)).toEqual({ kind: "hosted", id: ID, key: "secret" });
  });

  it("replaces a target the link had, and keeps the remix intent where it was", () => {
    const once = withAppTarget(remixLink(DEMO), { line: "L1", page: "a", params: { x: "1" } });
    const twice = withAppTarget(once, { line: "L2", page: "b", params: {} });
    expect(twice).toBe(`${DEMO}&remix=1&app=L2&to=b`);
    expect(readDemoLink(`/s/${ID}`, twice.slice(twice.indexOf("#")))).toMatchObject({ remix: true });
  });

  it("is a link on its own when there is no demo to carry", () => {
    expect(withAppTarget("https://potyro.app/", { line: "id:x", params: {} })).toBe("https://potyro.app/#app=id%3Ax");
  });

  it("round-trips text a URL has to escape", () => {
    const params = { name: "Zoë & Ana = #1 ?", code: "a/b+c" };
    expect(readAppTarget(`#${targetFragment({ line: "id:x", page: "p", params })}`)?.params).toEqual(params);
  });

  it("is no target without a line, or with one that is not a line", () => {
    expect(readAppTarget("#to=play&p.code=K")).toBeNull();
    expect(readAppTarget("#app=has%20space&to=play")).toBeNull();
    expect(readAppTarget(`#app=${"x".repeat(97)}`)).toBeNull();
    expect(readAppTarget("")).toBeNull();
  });
});

describe("a hostile link", () => {
  it("loses what does not fit, silently: huge values, odd names, second values, an absurd page", () => {
    const huge = "x".repeat(LINK_LIMITS.chars + 1);
    const target = readAppTarget(`#app=id%3Ax&to=${"p".repeat(65)}&p.code=${huge}&p.a-b=1&p.ok=yes&p.ok=again&p.=&p.1x=2`);
    expect(target).toEqual({ line: "id:x", params: { ok: "yes" } });
  });

  it("cannot set a prototype through a param's name", () => {
    const target = readAppTarget("#app=id%3Ax&p.__proto__=polluted&p.constructor=c");
    expect(Object.getPrototypeOf(target!.params)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(target!.params).toEqual(JSON.parse('{"__proto__":"polluted","constructor":"c"}'));
  });

  it("reads only so many params, however many it carries", () => {
    const many = Array.from({ length: 500 }, (_, i) => `p.n${i}=v`).join("&");
    expect(Object.keys(readAppTarget(`#app=id%3Ax&${many}`)!.params)).toHaveLength(32);
  });
});

describe("which app a link opens", () => {
  const apps = [
    { id: "draw-guess-remix", line: "R1", lineOf: "id:draw-guess" },
    { id: "groceries", line: "id:groceries" },
    { id: "draw-guess-2", line: "id:draw-guess" },
    { id: "draw-guess", line: "id:draw-guess" },
  ];

  it("is a copy of that app, whatever it is called here — the first, most recent, one", () => {
    expect(matchLinkedApp(apps, "id:draw-guess")?.id).toBe("draw-guess-2");
  });

  it("is a remix of it when that is all there is", () => {
    expect(matchLinkedApp(apps.filter((a) => !a.id.startsWith("draw-guess-2") && a.id !== "draw-guess"), "id:draw-guess")?.id).toBe("draw-guess-remix");
  });

  it("is none for an app this device does not have", () => {
    expect(matchLinkedApp(apps, "id:piano")).toBeNull();
    expect(matchLinkedApp(apps, "R2")).toBeNull();
  });

  it("knows an app without a line of its own by its declared id; one made here by its own", () => {
    expect(lineFor({}, "draw-guess")).toBe("id:draw-guess");
    expect(lineFor({ line: "R1" }, "draw-guess")).toBe("R1");
    expect(derivedLine(undefined)).toBeUndefined();
    const a = newLine();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newLine()).not.toBe(a);
  });

  it("is carried by a package, so a kept copy is the same app", () => {
    const zip = packAppPackage({ source: "export default 1", sourceName: "app.ts", files: [], seed: undefined, chat: undefined, line: "R1" });
    expect(readAppPackage(zip).line).toBe("R1");
    const none = packAppPackage({ source: "export default 1", sourceName: "app.ts", files: [], seed: undefined, chat: undefined, line: "not a line!" });
    expect(readAppPackage(none).line).toBeUndefined();
  });
});

describe("landing after the page loads again", () => {
  beforeEach(() => sessionStorage.clear());

  it("is for the app it was held for, once", () => {
    holdArrival("draw-guess", { page: "play", params: { code: "K" } });
    expect(takeArrival("groceries")).toBeNull();
    expect(takeArrival("draw-guess")).toEqual({ page: "play", params: { code: "K" } });
    expect(takeArrival("draw-guess")).toBeNull();
  });

  it("brings back only text", () => {
    sessionStorage.setItem("potyro:link-arrival", JSON.stringify({ appId: "a", page: 3, params: { code: "K", n: 1, o: {} } }));
    expect(takeArrival("a")).toEqual({ params: { code: "K" } });
  });
});

describe("making a link to an app's page", () => {
  beforeEach(() => localStorage.clear());
  const app = (over: Partial<UserApp> = {}): UserApp => ({ id: "draw-guess", name: "Draw", source: "S1", updatedAt: "2026-10-16T00:00:00Z", ...over });

  it("is the app's demo link with where to land, made once per version of the app", async () => {
    let made = 0;
    const deps = { demoLink: async () => `https://potyro.app/s/${ID}${++made}#k=key${made}`, stillShared: () => true };
    const first = await makeAppLink(app(), "draw-guess", { page: "play", params: { code: "A" } }, deps);
    expect(first).toBe(`https://potyro.app/s/${ID}1#k=key1&app=id%3Adraw-guess&to=play&p.code=A`);
    // Another invite, same app: the same demo, no new upload.
    const again = await makeAppLink(app(), "draw-guess", { page: "play", params: { code: "B" } }, deps);
    expect(again).toBe(`https://potyro.app/s/${ID}1#k=key1&app=id%3Adraw-guess&to=play&p.code=B`);
    expect(made).toBe(1);
    // The app changed: a new demo, so a friend gets the version they are invited to.
    await makeAppLink(app({ source: "S2" }), "draw-guess", { page: "play", params: {} }, deps);
    expect(made).toBe(2);
  });

  it("makes a new demo when the old one was taken down", async () => {
    let made = 0;
    const deps = { demoLink: async () => `https://potyro.app/s/${ID}#k=key${++made}`, stillShared: () => false };
    await makeAppLink(app(), "draw-guess", { page: "play", params: {} }, deps);
    await makeAppLink(app(), "draw-guess", { page: "play", params: {} }, deps);
    expect(made).toBe(2);
  });

  it("still opens the app for whoever has it when no demo can be made", async () => {
    const link = await makeAppLink(app({ line: "R1" }), "draw-guess", { page: "play", params: { code: "A" } }, {
      demoLink: async () => {
        throw new Error("too big for a link");
      },
    });
    expect(link).toBe(`${location.origin}/#app=R1&to=play&p.code=A`);
  });

  it("tells versions apart by their code and what they ship, never their records", () => {
    expect(demoSignature(app())).toBe(demoSignature(app({ updatedAt: "2027-01-01T00:00:00Z", name: "Renamed" })));
    expect(demoSignature(app())).not.toBe(demoSignature(app({ shipped: ["levels.json"] })));
  });

  it("from inside a demo starts from that demo's own link, without its intents", () => {
    expect(demoLinkText({ kind: "hosted", id: ID, key: "secret", remix: true }, "https://potyro.app", `/s/${ID}`)).toBe(DEMO);
  });
});

describe("the share dialog's request", () => {
  it("makes the link while the dialog is up, when this app can have one", async () => {
    const req = shareRequest({ text: "Join", app: { page: "play", params: { code: "A" } } }, async (to) => `https://x/#to=${to.page}`);
    expect(req?.text).toBe("Join");
    expect(await req?.makeLink?.()).toBe("https://x/#to=play");
  });

  it("sends the words alone where no link can be made, and nothing when there are none", () => {
    expect(shareRequest({ text: "Join", app: { page: "play", params: {} } })).toEqual({ text: "Join" });
    expect(shareRequest({ app: { page: "play", params: {} } })).toBeNull();
  });
});
