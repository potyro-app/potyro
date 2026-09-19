// @vitest-environment happy-dom
//
// Dragging with a finger, when the browser will not hand over the pointer.
//
// `setPointerCapture` throws if the pointer is no longer active, and the hold timer called it on the
// line before arming the drag — so one throw meant the drag never started and the row would not move
// however long you held it. Reported on Firefox for Android, on the top row of a list, where a hold
// the browser has decided to treat as an overscroll leaves exactly that dead pointer behind.
//
// Capture is a convenience: without it the events still arrive through the element under the finger.
// Arming is not, so it must not depend on capture succeeding.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useReorder } from "../src/reorder.js";

afterEach(cleanup);

const KEYS = ["a", "b", "c"];

function List({ onDrop, capture }: { onDrop: (key: string, over: string | null) => void; capture: () => void }) {
  const reorder = useReorder({
    keys: KEYS,
    names: (k) => k,
    onReorder: () => {},
    onDrop,
    enabled: true,
    handle: ".grip",
  });
  return (
    <ul>
      {KEYS.map((k) => {
        const item = reorder.item(k);
        return (
          <li key={k} {...item} data-testid={`row-${k}`}>
            <span
              className="grip"
              data-testid={`grip-${k}`}
              // happy-dom has no pointer capture; this stands in for the browser's answer.
              ref={(el) => {
                if (el) (el as HTMLElement).setPointerCapture = capture;
              }}
            />
            {k}
          </li>
        );
      })}
    </ul>
  );
}

/** A finger: press the grip, hold past the arming delay, move onto another row, lift. */
async function dragWithFinger(grip: HTMLElement, onto: HTMLElement): Promise<void> {
  fireEvent.pointerDown(grip, { pointerId: 1, pointerType: "touch", button: 0, clientX: 10, clientY: 10 });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300)); // past the quarter-second hold
  });
  // `elementsFromPoint` is how the hook asks what is under the finger; happy-dom has no layout, so
  // it answers with the row we are dragging onto.
  (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = () => [onto];
  fireEvent.pointerMove(grip, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 90 });
  fireEvent.pointerUp(grip, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 90 });
}

describe("dragging to reorder", () => {
  it("moves the row even when the browser refuses the pointer", async () => {
    const onDrop = vi.fn();
    const refuses = () => {
      throw new DOMException("Invalid pointer id.", "NotFoundError");
    };

    const view = render(<List onDrop={onDrop} capture={refuses} />);
    await dragWithFinger(view.getByTestId("grip-a"), view.getByTestId("row-b"));

    expect(onDrop).toHaveBeenCalledWith("a", "b");
  });

  it("still moves it when the browser allows the capture", async () => {
    const onDrop = vi.fn();
    const allows = vi.fn();

    const view = render(<List onDrop={onDrop} capture={allows} />);
    await dragWithFinger(view.getByTestId("grip-a"), view.getByTestId("row-b"));

    expect(allows).toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledWith("a", "b");
  });
});
