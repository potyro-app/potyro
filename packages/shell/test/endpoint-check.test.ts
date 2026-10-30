// "Test connection" (#121): what the person reads after pressing it. Each failure must say what to
// change, since a status code alone tells someone who has never run a server nothing.

import { describe, expect, it } from "vitest";
import { checkEndpoint, type FetchLike } from "../src/endpoint-check.js";

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
    expect((await checkEndpoint(setting(), answer(401, {}))).text).toMatch(/refused the key \(401\)/);
    expect((await checkEndpoint(setting(), answer(404, {}))).text).toMatch(/usually ends in \/v1/);
    expect((await checkEndpoint(setting(), answer(500, {}))).text).toMatch(/error \(500\)/);
    expect((await checkEndpoint(setting(), answer(200, { hello: 1 }))).text).toMatch(/not with a list of models/);
    const unreachable = await checkEndpoint(setting(), async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(unreachable.ok).toBe(false);
    expect(unreachable.text).toMatch(/OLLAMA_ORIGINS/);
  });
});
