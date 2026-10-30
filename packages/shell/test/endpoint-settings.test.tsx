// @vitest-environment happy-dom
// The endpoint's own settings (#121): the models a test found stay offered while the model is typed,
// and a test that was still running when the settings changed never reports on the old ones.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";
import type { EndpointCheck } from "../src/endpoint-check.js";

/** Each test of the connection waits here until the test settles it. */
const pending: Array<(r: EndpointCheck) => void> = [];
vi.mock("../src/endpoint-check.js", async (orig) => ({
  ...(await orig<object>()),
  checkEndpoint: () => new Promise<EndpointCheck>((resolve) => pending.push(resolve)),
}));

const { EndpointSettings } = await import("../src/endpoint-settings.js");

const start: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "endpoint", endpoint: { baseUrl: "http://localhost:11434/v1", key: "", model: "" } };
function Harness() {
  const [config, setConfig] = useState(start);
  return <EndpointSettings config={config} onChange={setConfig} />;
}
const listed = (): string[] => [...document.querySelectorAll("datalist option")].map((o) => (o as HTMLOptionElement).value);
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const settle = async (r: EndpointCheck) => {
  await act(async () => {
    pending.shift()!(r);
  });
};
const OK: EndpointCheck = { ok: true, models: ["qwen3", "llama3.1"], text: "Connected. The server lists 2 models." };

afterEach(() => {
  cleanup();
  pending.length = 0;
});

describe("the endpoint's settings", () => {
  it("keeps the models a test found while the model name is typed", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await settle(OK);
    expect(listed()).toEqual(["qwen3", "llama3.1"]);

    fireEvent.change(field("Endpoint model"), { target: { value: "q" } });
    expect(field("Endpoint model").value).toBe("q");
    expect(field("Endpoint model").getAttribute("list")).toBeTruthy();
    expect(listed()).toEqual(["qwen3", "llama3.1"]);
    // The result is about settings that changed, so it goes.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("drops them when the address or the key changes: then they may be another server's", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await settle(OK);
    fireEvent.change(field("Endpoint address"), { target: { value: "http://localhost:1234/v1" } });
    expect(listed()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await settle(OK);
    fireEvent.change(field("Endpoint API key"), { target: { value: "sk-x" } });
    expect(listed()).toEqual([]);
  });

  it("ignores a test that was still running when the settings changed", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(screen.getByRole("button", { name: "Testing…" })).toBeTruthy();

    // An edit while it runs: back to idle, the button free again.
    fireEvent.change(field("Endpoint address"), { target: { value: "http://localhost:1234/v1" } });
    expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy();

    await settle({ ok: false, text: "No answer from http://localhost:11434/v1." });
    expect(screen.queryByRole("status")).toBeNull();
    expect(listed()).toEqual([]);

    // A test of the settings as they are now is reported.
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await settle(OK);
    expect(screen.getByRole("status").textContent).toBe("Connected. The server lists 2 models.");
  });
});
