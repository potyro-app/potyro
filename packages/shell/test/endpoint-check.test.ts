// "Test connection" (#121): what the person reads after pressing it. Each failure must say what to
// change, since a status code alone tells someone who has never run a server nothing.

import { describe, expect, it } from "vitest";
import { checkEndpoint, noAnswerText, unreachableText, type FetchLike } from "../src/endpoint-check.js";

const setting = (patch: Partial<{ baseUrl: string; key: string; model: string }> = {}) => ({ baseUrl: "http://localhost:11434/v1/", key: "", model: "", ...patch });
const answer = (status: number, body: unknown): FetchLike => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("checkEndpoint", () => {
  it("asks GET {base}/models, with the key when there is one", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetch: FetchLike = async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ data: [{ id: "qwen3" }, { id: "llama3.1" }] }), { status: 200 });
    };
    const out = await checkEndpoint(setting({ key: "sk-x" }), fetch);
    expect(seen[0]!.url).toBe("http://localhost:11434/v1/models");
    expect(seen[0]!.init?.headers).toEqual({ Authorization: "Bearer sk-x" });
    expect(out).toEqual({ ok: true, models: ["qwen3", "llama3.1"], text: "Connected. The server lists 2 models." });
  });

  it("sends no Authorization header without a key", async () => {
    let headers: unknown;
    await checkEndpoint(setting(), async (_u, init) => {
      headers = init?.headers;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    expect(headers).toEqual({});
  });

  it("says when the chosen model is not on the server", async () => {
    const out = await checkEndpoint(setting({ model: "gpt-9" }), answer(200, { data: [{ id: "qwen3" }] }));
    expect(out.ok).toBe(true);
    expect(out.text).toMatch(/does not list gpt-9/);
  });

  it("puts each failure in words", async () => {
    expect((await checkEndpoint(setting({ baseUrl: "" }))).text).toMatch(/address first/);
    expect((await checkEndpoint(setting({ baseUrl: "localhost:11434" }))).text).toMatch(/http:\/\/ or https:\/\/|not a web address/);
    expect((await checkEndpoint(setting({ key: "sk-x" }), answer(401, {}))).text).toMatch(/refused the key \(401\)/);
    expect((await checkEndpoint(setting(), answer(404, {}))).text).toMatch(/usually ends in \/v1/);
    expect((await checkEndpoint(setting(), answer(500, {}))).text).toMatch(/error \(500\)/);
    expect((await checkEndpoint(setting(), answer(200, { hello: 1 }))).text).toMatch(/not with a list of models/);
    const unreachable = await checkEndpoint(setting(), async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(unreachable.ok).toBe(false);
    expect(unreachable.text).toMatch(/OLLAMA_ORIGINS/);
  });

  it("with no key entered, a 401 or 403 says the server needs one, not that a key was refused", async () => {
    for (const status of [401, 403]) {
      const out = await checkEndpoint(setting({ key: "  " }), answer(status, {}));
      expect(out).toEqual({ ok: false, text: "This server needs a key. Add one above." });
    }
  });

  it("from an https page, says an http server elsewhere cannot be reached", async () => {
    const fail: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    const remote = await checkEndpoint(setting({ baseUrl: "http://192.168.1.20:11434/v1" }), fail, "https:");
    expect(remote.text).toBe(
      "No answer from http://192.168.1.20:11434/v1. This page is https, so it can only reach an http server on this same computer. Use an https address for this server.",
    );
    // This same computer is allowed over http from an https page: the general words apply.
    for (const baseUrl of ["http://localhost:11434/v1", "http://127.0.0.1:1234/v1", "http://[::1]:8000/v1"]) {
      expect((await checkEndpoint(setting({ baseUrl }), fail, "https:")).text).toMatch(/OLLAMA_ORIGINS/);
    }
    // From an http page, or to an https server, nothing is blocked for being http.
    expect((await checkEndpoint(setting({ baseUrl: "http://192.168.1.20:11434/v1" }), fail, "http:")).text).toMatch(/OLLAMA_ORIGINS/);
    expect(noAnswerText("https://example.com/v1", "https:")).toMatch(/OLLAMA_ORIGINS/);
  });

  it("says the same when a create or Ask could not reach it, and where to test it", () => {
    const text = unreachableText(" http://localhost:11434/v1/ ", "http:");
    expect(text).toBe(
      "No answer from http://localhost:11434/v1. Check the server is running and the address is right. A server on your own machine must also allow requests from this page (for Ollama, set OLLAMA_ORIGINS). You can test the connection in the Studio’s Model settings.",
    );
  });
});
