// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { DEFAULT_ENGINE_CONFIG } from "../src/engines.js";
import { getEngineConfig, setEngineConfig, useEngineConfig } from "../src/engine-store.js";

afterEach(() => {
  cleanup();
  // The store is module-level (that's the point — it's the one thing App.tsx and Studio both read),
  // so a test that changes it must put it back, or the next test starts from whatever the previous
  // one left behind instead of a known state.
  setEngineConfig(DEFAULT_ENGINE_CONFIG);
});

// A minimal reader/writer so the hook is exercised the way a real component would use it, not called
// directly outside of React (useSyncExternalStore requires a component to subscribe from).
function Reader() {
  const [cfg, setCfg] = useEngineConfig();
  return (
    <div>
      <span data-testid="engine">{cfg.engine}</span>
      <button type="button" onClick={() => setCfg({ ...cfg, engine: "openrouter", openrouterKey: "sk-or-x" })}>
        switch
      </button>
    </div>
  );
}

describe("engine-store", () => {
  it("starts every reader at the same default config", () => {
    expect(getEngineConfig()).toEqual(DEFAULT_ENGINE_CONFIG);
    render(<Reader />);
    expect(screen.getByTestId("engine").textContent).toBe(DEFAULT_ENGINE_CONFIG.engine);
  });

  it("a change from one place is visible to a plain getEngineConfig() read, not just to hooked components", () => {
    setEngineConfig({ ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "sk-or-x" });
    expect(getEngineConfig().engine).toBe("openrouter");
    expect(getEngineConfig().openrouterKey).toBe("sk-or-x");
  });

  it("a component using the hook re-renders when the store changes underneath it", () => {
    render(<Reader />);
    expect(screen.getByTestId("engine").textContent).toBe("cli");
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    expect(screen.getByTestId("engine").textContent).toBe("openrouter");
  });

  it("two independent readers observe the same change — one source of truth, not two", () => {
    function OtherReader() {
      const [cfg] = useEngineConfig();
      return <span data-testid="engine-2">{cfg.engine}</span>;
    }
    render(
      <>
        <Reader />
        <OtherReader />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    expect(screen.getByTestId("engine").textContent).toBe("openrouter");
    expect(screen.getByTestId("engine-2").textContent).toBe("openrouter");
  });
});
