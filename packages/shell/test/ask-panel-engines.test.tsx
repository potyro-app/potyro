// @vitest-environment happy-dom
// Ask on an engine other than OpenRouter (#121). The web search is OpenRouter's own, so its switch is
// not offered elsewhere — but looking proposed addresses up on the map (ask-geocode.ts, Potyro's own
// call to OpenStreetMap) still is, as a choice of its own. And what a request cost is OpenRouter's
// figure: on another server nothing is said about "your OpenRouter credit", and nothing is added to it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const seen = vi.hoisted(() => ({ placed: 0, asks: [] as Array<Record<string, unknown>> }));
vi.mock("../src/start-ask.js", async (orig) => ({
  ...(await orig<typeof import("../src/start-ask.js")>()),
  startAsk: async (opts: Record<string, unknown>) => {
    seen.asks.push(opts);
    return { kind: "proposal", spent: 0.02, proposal: { summary: "One place.", rows: [], actions: [] } };
  },
}));
vi.mock("../src/ask-geocode.js", () => ({
  placeByAddress: async (_def: unknown, rows: unknown[]) => {
    seen.placed += 1;
    return rows;
  },
}));

const { AskPanel } = await import("../src/ask-panel.js");
const { spentIn } = await import("../src/ask-spend.js");

const openrouter: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "sk-or" };
const endpoint: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "endpoint", endpoint: { baseUrl: "http://localhost:11434/v1", key: "", model: "qwen3" } };
const runtime = { definition: { name: "Places", pages: [], entities: {} }, ctx: { query: async () => [] } } as never;

const open = (engine: EngineConfig) => render(<AskPanel appId="places" runtime={runtime} engine={engine} onClose={() => {}} />);
const ask = async () => {
  fireEvent.change(screen.getByLabelText("What to add"), { target: { value: "five cafés" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
  await act(async () => {});
};
const chip = (name: RegExp) => screen.queryByRole("checkbox", { name }) as HTMLInputElement | null;

beforeEach(() => {
  localStorage.clear();
  seen.placed = 0;
  seen.asks.length = 0;
});
afterEach(cleanup);

describe("Ask's switches, per engine", () => {
  it("on OpenRouter: the one search switch, which also looks places up", async () => {
    open(openrouter);
    expect(chip(/Search the web/)).toBeTruthy();
    expect(chip(/Look up places on the map/)).toBeNull();
    await ask();
    expect(seen.placed).toBe(1);

    cleanup();
    open(openrouter);
    fireEvent.click(chip(/Search the web/)!);
    await ask();
    expect(seen.placed).toBe(1);
    expect(seen.asks.at(-1)!.webSearch).toBe(false);
  });

  it("on an endpoint: no search switch, a map switch that controls only the lookup, remembered on its own", async () => {
    open(endpoint);
    expect(chip(/Search the web/)).toBeNull();
    expect(chip(/Look up places on the map/)!.checked).toBe(true);
    await ask();
    expect(seen.placed).toBe(1);
    expect(seen.asks.at(-1)!.webSearch).toBe(false);

    cleanup();
    open(endpoint);
    fireEvent.click(chip(/Look up places on the map/)!);
    expect(localStorage.getItem("potyro:ask-places")).toBe("0");
    // The web search's own choice is untouched.
    expect(localStorage.getItem("potyro:ask-web")).toBeNull();
    await ask();
    expect(seen.placed).toBe(1);
  });

  it("turning the search off on OpenRouter leaves an endpoint's map lookup on", async () => {
    localStorage.setItem("potyro:ask-web", "0");
    open(endpoint);
    expect(chip(/Look up places on the map/)!.checked).toBe(true);
  });
});

describe("what Ask cost, per engine", () => {
  it("on OpenRouter: said, and added to the app's total", async () => {
    open(openrouter);
    await ask();
    expect(screen.getByText(/This request cost .* of your OpenRouter credit\./)).toBeTruthy();
    expect(spentIn("places")).toBeCloseTo(0.02);
  });

  it("on an endpoint: no cost line, nothing added, and no OpenRouter total shown", async () => {
    localStorage.setItem("potyro:ask-spent:places", "0.5");
    open(endpoint);
    expect(screen.queryByText(/OpenRouter credit/)).toBeNull();
    await ask();
    expect(screen.queryByText(/OpenRouter credit/)).toBeNull();
    expect(spentIn("places")).toBeCloseTo(0.5);
  });
});
