// @vitest-environment happy-dom
// A row's display read from an app that was put away mid-read (a shared app's box closed when the
// person switched apps in place): "this app was closed" was an uncaught rejection, in Firefox on every
// switch back. Now the rows keep what they showed, and a failure while the app is open is a warning.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { PotyroRuntime } from "@potyro/runtime";
import type { Resolved } from "potyro";
import { useDisplayCells } from "../src/cells.js";

function closingRuntime(): PotyroRuntime {
  return {
    ctx: {},
    definition: {
      entities: { note: { label: "Note", fields: { title: { type: "text" } } } },
      pages: [{ id: "notes", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" } } }],
    },
    resolveBinding: () => new Promise((_, reject) => setTimeout(() => reject(new Error("this app was closed")), 5)),
  } as unknown as PotyroRuntime;
}

const rows = [{ id: "1", title: "First" }] as unknown as Resolved[];
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => void unhandled.push(e);

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  unhandled.length = 0;
  vi.restoreAllMocks();
});

describe("display cells of an app that closes under them", () => {
  it("are let go quietly once the view has gone, and warned about while it is there", async () => {
    process.on("unhandledRejection", onUnhandled);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const gone = renderHook(() => useDisplayCells(closingRuntime(), "notes", rows));
    gone.unmount();
    await new Promise((r) => setTimeout(r, 30));
    expect(unhandled).toEqual([]);
    expect(warn).not.toHaveBeenCalled();

    const open = renderHook(() => useDisplayCells(closingRuntime(), "notes", rows));
    await new Promise((r) => setTimeout(r, 30));
    expect(unhandled).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(open.result.current).toEqual([]);
    open.unmount();
  });
});
