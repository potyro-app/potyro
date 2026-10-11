// @vitest-environment happy-dom
//
// The editor is a textarea with a coloured `<pre>` painted behind it. That only works while the two
// layers hold exactly the same characters — one dropped space and every colour after it sits under
// the wrong glyph — so that invariant is what these tests pin, along with the textarea still being a
// plain, editable, labelled textarea.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CodeEditor } from "../src/code-editor.js";
import { resetHighlighter } from "../src/highlight.js";

afterEach(() => {
  cleanup();
  resetHighlighter();
});

const paintText = (): string => document.querySelector(".k-code-paint code")!.textContent ?? "";

function renderEditor(value: string, onChange = vi.fn()) {
  render(<CodeEditor value={value} onChange={onChange} label="App source" />);
  return { textarea: screen.getByRole("textbox", { name: "App source" }) as HTMLTextAreaElement, onChange };
}

describe("CodeEditor", () => {
  it("paints exactly the textarea's text, once highlighted", async () => {
    const src = 'import { defineApp } from "potyro";\n\nconst n = 1; // one\n';
    const { textarea } = renderEditor(src);

    await waitFor(() => expect(document.querySelector(".k-code-paint .token")).not.toBeNull());
    expect(paintText()).toBe(src);
    expect(textarea.value).toBe(src);
  });

  it("shows the text before highlighting arrives, rather than a blank layer", () => {
    // Synchronously after mount, Prism has not answered yet. Painting nothing here would flash an
    // empty editor on every open.
    renderEditor("const a = 1;");
    expect(paintText()).toBe("const a = 1;");
  });

  it("keeps blank lines, so line N of the paint is line N of the code", async () => {
    const src = "a\n\n\nb";
    renderEditor(src);
    await waitFor(() => expect(paintText()).toBe(src));
    expect(document.querySelectorAll(".k-code-line")).toHaveLength(4);
  });

  it("stays a real editable textarea", async () => {
    const { textarea, onChange } = renderEditor("const a = 1;");
    // Everything the browser gives a textarea for free — caret, undo, IME, selection, a11y name —
    // depends on this staying a textarea rather than a contenteditable.
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.readOnly).toBe(false);

    fireEvent.change(textarea, { target: { value: "const a = 2;" } });
    expect(onChange).toHaveBeenCalledWith("const a = 2;");
  });

  it("hides the paint from assistive tech — the textarea already carries the text", async () => {
    renderEditor("const a = 1;");
    expect(document.querySelector(".k-code-paint")!.getAttribute("aria-hidden")).toBe("true");
    // One accessible node for the source, not two.
    expect(screen.getAllByRole("textbox", { name: "App source" })).toHaveLength(1);
  });

  it("renders source as text, never as markup", async () => {
    const src = 'const evil = "<img src=x onerror=alert(1)>";';
    renderEditor(src);

    await waitFor(() => expect(document.querySelector(".k-code-paint .token")).not.toBeNull());
    expect(paintText()).toBe(src);
    // The decisive check: no element was created from the source's angle brackets.
    expect(document.querySelector(".k-code-paint img")).toBeNull();
  });

  it("tracks the value as it changes", async () => {
    const { textarea } = renderEditor("const a = 1;");
    await waitFor(() => expect(document.querySelector(".k-code-paint .token")).not.toBeNull());

    render(<CodeEditor value={"const a = 1;\nconst b = 2;"} onChange={vi.fn()} label="Second" />);
    await waitFor(() => {
      const paints = document.querySelectorAll(".k-code-paint code");
      expect(paints[paints.length - 1]!.textContent).toBe("const a = 1;\nconst b = 2;");
    });
    expect(textarea.value).toBe("const a = 1;");
  });
});
