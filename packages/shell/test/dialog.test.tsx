// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DialogHost, Dialogs } from "../src/dialog.js";

// The share dialog (#79). It used to be a generic prompt: the link copied silently before it opened
// (with the failure swallowed), a text box, an OK button. What a person needs from it is one
// control — Copy — and an honest word about whether it worked.

const LINK = "http://localhost:5173/#join=abc.def";

function mount(): { host: DialogHost; done: Promise<void> } {
  const host = new DialogHost();
  render(<Dialogs host={host} />);
  let done!: Promise<void>;
  // The host pushes to the React tree from outside it, as the launcher does.
  act(() => {
    done = host.share("Send this link. Whoever opens it joins your app and its data.", LINK);
  });
  return { host, done };
}

function clipboard(writeText: (t: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
});

describe("share dialog", () => {
  it("shows the link read-only, with a Copy button that says when it has copied", async () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    mount();

    const field = screen.getByRole("textbox", { name: "Share link" }) as HTMLInputElement;
    expect(field.value).toBe(LINK);
    expect(field.readOnly).toBe(true);
    expect(screen.getByText(/Whoever opens it joins/)).toBeTruthy();
    // Nothing has been copied yet: the dialog does not claim it.
    expect(screen.queryByText(/^Copied/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^Copied/));
  });

  it("says so when copying fails, and leaves the link selected for copying by hand", async () => {
    clipboard(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    mount();

    const field = screen.getByRole("textbox", { name: "Share link" }) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Couldn't copy/));
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LINK.length);
  });

  it("does the same with no clipboard at all (insecure context)", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Couldn't copy/));
  });

  it("offers the device's own share sheet only where there is one", async () => {
    mount();
    expect(screen.queryByRole("button", { name: /^Share/ })).toBeNull();
    cleanup();

    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Share/ }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: LINK }));
  });

  it("closes on Done and settles the promise", async () => {
    const { done } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await done;
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never swallows the clipboard failure", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const file of ["src/dialog.tsx", "src/launcher.tsx"]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/clipboard[^\n]*\.catch\(\(\) => \{\}\)/);
    }
  });
});
