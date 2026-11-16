// The toast stack is short however many toasts are pushed (#90): an app that toasts in a loop — a
// sealed one can post thousands of `ui.toast` a second — must not make the shell hold and draw a
// stack as long as its loop.
import { describe, expect, it, vi } from "vitest";
import { MAX_TOASTS, Toaster } from "../src/toaster.js";

describe("the toaster", () => {
  it("keeps the newest few, and lets each go after its time", () => {
    vi.useFakeTimers();
    const toaster = new Toaster();
    let told = 0;
    toaster.subscribe(() => told++);
    for (let i = 0; i < 1000; i++) toaster.push(`toast ${i}`);
    expect(toaster.get().map((t) => t.msg)).toEqual(Array.from({ length: MAX_TOASTS }, (_, i) => `toast ${1000 - MAX_TOASTS + i}`));
    expect(told).toBe(1000);
    vi.advanceTimersByTime(3000);
    expect(toaster.get()).toEqual([]);
    vi.useRealTimers();
  });
});
