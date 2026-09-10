// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ViewErrorBoundary } from "../src/view-error-boundary.js";

afterEach(cleanup);

function Boom(): never {
  throw new Error('no page "map" in this app');
}

describe("ViewErrorBoundary", () => {
  it("renders its children normally when nothing throws", () => {
    render(
      <ViewErrorBoundary pageLabel='the "Map" page' onRecover={() => {}}>
        <p>all good</p>
      </ViewErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeTruthy();
  });

  it("renders a fallback instead of unmounting when a child throws during render", () => {
    // Silence React's own "the above error occurred" console.error noise for this one render —
    // it's expected, and asserting on it would be asserting on React's internals, not this
    // boundary's behaviour.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <div data-testid="shell">
          <header>chrome</header>
          <ViewErrorBoundary pageLabel='the "Map" page' onRecover={() => {}}>
            <Boom />
          </ViewErrorBoundary>
        </div>,
      );
      // The whole tree survives — this is the entire point: a crash in the boundary's children
      // must not unmount the shell rendered ALONGSIDE it, not just inside it.
      expect(screen.getByTestId("shell")).toBeTruthy();
      expect(screen.getByText("chrome")).toBeTruthy();
      expect(screen.getByText(/couldn.t be shown/)).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("shows the page label and the underlying error message, not a bare blank panel", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ViewErrorBoundary pageLabel='the "Map" page' onRecover={() => {}}>
          <Boom />
        </ViewErrorBoundary>,
      );
      expect(screen.getByText(/the "Map" page/)).toBeTruthy();
      expect(screen.getByText(/no page "map" in this app/)).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("calls onRecover when the recovery button is clicked", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRecover = vi.fn();
    try {
      render(
        <ViewErrorBoundary pageLabel='the "Map" page' onRecover={onRecover}>
          <Boom />
        </ViewErrorBoundary>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Back to a working page" }));
      expect(onRecover).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
