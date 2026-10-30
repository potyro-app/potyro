// @vitest-environment happy-dom
//
// Which engine a deployed build starts on (#121, #455), a remembered key's round trip through the
// vault (#455), and the own-key count (#118) — through the one store the Studio reads. A deployed
// build is one with no `claude -p` (`canGenerate` false, mocked here); `fetch` is a script.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryVault } from "@potyro/identity";

vi.mock("../src/generate-client.js", async (importOriginal) => ({ ...(await importOriginal<object>()), canGenerate: () => false }));

const { checkFreeEngine, forgetRememberedKey, getEngineConfig, loadRememberedKeys, resetEngineConfig, setEngineConfig, setKeyRemembered, watchFreeEngine } = await import("../src/engine-store.js");
const { resetRelayMemory } = await import("../src/app-ai.js");
const { getFreeAi, resetFreeAi, subscribeFreeAi } = await import("../src/free-ai.js");
const { keyId, setVaultForTests, isRemembered } = await import("../src/remembered-keys.js");
const { deviceId } = await import("../src/device-id.js");

type Seen = { url: string; init: RequestInit };
let seen: Seen[] = [];
let healthBody: unknown = { ok: true, chat: true };
/** /health fails as a network does: no answer at all. */
let healthDown = false;

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  resetRelayMemory();
  resetFreeAi();
  resetEngineConfig();
  setVaultForTests(null);
  seen = [];
  healthBody = { ok: true, chat: true };
  healthDown = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ url, init });
    if (url.endsWith("/ai/health") && healthDown) throw new TypeError("Failed to fetch");
    if (url.endsWith("/ai/health")) return new Response(JSON.stringify(healthBody), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/ai/count")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    throw new TypeError("Failed to fetch");
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the starting engine on a deployed build", () => {
  it("is Potyro's free engine when the relay's chat route serves", async () => {
    expect(getEngineConfig().engine).toBe("openrouter");
    await checkFreeEngine();
    expect(getEngineConfig().engine).toBe("potyro");
    // Chosen by the shell, not the person: nothing kept in the tab.
    expect(sessionStorage.getItem("potyro:engine-config")).toBeNull();
  });

  it("picks the engine before the answer is heard: never the answer with the engine from before it", async () => {
    const seenPairs: string[] = [];
    const unsubscribe = subscribeFreeAi(() => seenPairs.push(`${getEngineConfig().engine}:${getFreeAi().health?.chat ?? "asking"}`));
    await checkFreeEngine();
    unsubscribe();
    expect(seenPairs).toEqual(["potyro:true"]);
  });

  it("stays OpenRouter (which asks for a key) when the relay has no chat route, or is not there", async () => {
    healthBody = { ok: true, chat: false };
    await checkFreeEngine();
    expect(getEngineConfig().engine).toBe("openrouter");
    resetRelayMemory();
    healthBody = "<!doctype html>";
    await checkFreeEngine();
    expect(getEngineConfig().engine).toBe("openrouter");
  });

  it("never takes the person's own choice away", async () => {
    setEngineConfig({ ...getEngineConfig(), engine: "anthropic", anthropicKey: "sk-ant-mine" });
    await checkFreeEngine();
    expect(getEngineConfig().engine).toBe("anthropic");
  });

  it("leaves Potyro for the build's start when its route no longer serves", async () => {
    setEngineConfig({ ...getEngineConfig(), engine: "potyro" });
    healthBody = { ok: true, chat: false };
    await checkFreeEngine();
    expect(getEngineConfig().engine).toBe("openrouter");
  });

  it("keeps a chosen Potyro when /health gives no answer, or a page that is not the relay's: only a definite 'no' moves it", async () => {
    setEngineConfig({ ...getEngineConfig(), engine: "potyro" });
    healthDown = true;
    await checkFreeEngine();
    expect(getEngineConfig().engine).toBe("potyro");
    resetRelayMemory();
    healthDown = false;
    healthBody = "<!doctype html>";
    await checkFreeEngine();
    expect(getEngineConfig().engine).toBe("potyro");
  });

  it("is decided at shell start, and asked again when the browser is back online", async () => {
    healthDown = true;
    watchFreeEngine();
    await vi.waitFor(() => expect(seen.filter((s) => s.url.endsWith("/ai/health"))).toHaveLength(1));
    expect(getEngineConfig().engine).toBe("openrouter");
    // Back online: no answer is not remembered past it.
    healthDown = false;
    globalThis.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(getEngineConfig().engine).toBe("potyro"));
  });
});

describe("Remember on this device", () => {
  it("keeps the key in the vault, never in localStorage; a new tab starts on it; Forget takes it off", async () => {
    const vault = memoryVault();
    setVaultForTests(() => vault);
    setEngineConfig({ ...getEngineConfig(), engine: "openrouter", openrouterKey: "sk-or-remember-me" });
    expect(await setKeyRemembered("openrouter", true)).toBe(true);
    expect(vault.map.get(keyId("openrouter"))).toBe("sk-or-remember-me");
    // A changed key is kept as it is now.
    setEngineConfig({ ...getEngineConfig(), openrouterKey: "sk-or-remember-me-2" });
    await vi.waitFor(() => expect(vault.map.get(keyId("openrouter"))).toBe("sk-or-remember-me-2"));
    expect(JSON.stringify({ ...localStorage })).not.toContain("sk-or-remember");

    // A new tab: nothing in sessionStorage, the vault read at start.
    sessionStorage.clear();
    resetEngineConfig();
    expect(getEngineConfig().openrouterKey).toBe("");
    await loadRememberedKeys();
    expect(getEngineConfig()).toMatchObject({ engine: "openrouter", openrouterKey: "sk-or-remember-me-2" });
    expect(isRemembered("openrouter")).toBe(true);
    // A remembered key's engine is where they start, even with the free route serving.
    await checkFreeEngine();
    expect(getEngineConfig().engine).toBe("openrouter");

    await forgetRememberedKey("openrouter");
    expect(vault.map.has(keyId("openrouter"))).toBe(false);
    expect(getEngineConfig().openrouterKey).toBe("");
    sessionStorage.clear();
    resetEngineConfig();
    await loadRememberedKeys();
    expect(getEngineConfig().openrouterKey).toBe("");
  });

  it("is off by default, and turning it off takes the key out of the vault but leaves it in the tab", async () => {
    const vault = memoryVault();
    setVaultForTests(() => vault);
    setEngineConfig({ ...getEngineConfig(), engine: "anthropic", anthropicKey: "sk-ant-x" });
    expect(vault.map.size).toBe(0);
    await setKeyRemembered("anthropic", true);
    await setKeyRemembered("anthropic", false);
    expect(vault.map.size).toBe(0);
    expect(getEngineConfig().anthropicKey).toBe("sk-ant-x");
  });

  it("keeps an endpoint whole: its key is no use without its address", async () => {
    const vault = memoryVault();
    setVaultForTests(() => vault);
    const endpoint = { baseUrl: "http://localhost:11434/v1", key: "k", model: "qwen3" };
    setEngineConfig({ ...getEngineConfig(), engine: "endpoint", endpoint });
    await setKeyRemembered("endpoint", true);
    sessionStorage.clear();
    resetEngineConfig();
    await loadRememberedKeys();
    expect(getEngineConfig()).toMatchObject({ engine: "endpoint", endpoint });
  });

  it("is not offered where there is no vault: nothing is kept", async () => {
    setVaultForTests(() => undefined);
    setEngineConfig({ ...getEngineConfig(), openrouterKey: "sk-or-x" });
    expect(await setKeyRemembered("openrouter", true)).toBe(false);
    expect(isRemembered("openrouter")).toBe(false);
  });
});

describe("the own-key count", () => {
  it("goes once a month, when a key is first typed, carrying nothing that names the device", async () => {
    setEngineConfig({ ...getEngineConfig(), openrouterKey: "s" });
    setEngineConfig({ ...getEngineConfig(), openrouterKey: "sk" });
    setEngineConfig({ ...getEngineConfig(), openrouterKey: "" });
    setEngineConfig({ ...getEngineConfig(), anthropicKey: "sk-ant" });
    await vi.waitFor(() => expect(localStorage.getItem(`potyro:counted:own-key:${new Date().toISOString().slice(0, 7)}`)).toBe("1"));
    const posts = seen.filter((s) => s.url.endsWith("/ai/count"));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.init.body).toBe('{"event":"own-key"}');
    expect(JSON.stringify(posts[0])).not.toContain(deviceId());
  });
});
