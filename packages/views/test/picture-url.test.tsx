// @vitest-environment happy-dom
// A page's picture is asked for once, and its URL holds still — even though `runtime.ctx`, which the
// views pass in, is a NEW object on every access. Keyed by ctx, the hook asked again on every render
// and set a new URL each time, so the page's background picture never finished loading (#368).

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { usePictureUrl } from "../src/picture.js";

afterEach(cleanup);

describe("usePictureUrl", () => {
  it("asks once for a picture, though the ctx it is given is new on every render", async () => {
    let n = 0;
    const url = vi.fn(async (path: string) => `blob:test/${path}/${(n += 1)}`);
    // Like `runtime.ctx`: a fresh object each time it is read.
    const freshCtx = () => ({ media: { url: async () => "", put: async () => ({ key: "", mime: "" }) }, files: { url } }) as never;
    const seen: Array<string | null> = [];
    function Probe({ tick }: { tick: number }) {
      const u = usePictureUrl(freshCtx(), "art/bg.webp");
      seen.push(u);
      return <img alt="" src={u ?? undefined} data-tick={tick} />;
    }
    const { rerender } = render(<Probe tick={0} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    for (let tick = 1; tick < 5; tick++) {
      rerender(<Probe tick={tick} />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    expect(url).toHaveBeenCalledTimes(1);
    const src = document.querySelector("img")!.getAttribute("src");
    expect(src).toBe("blob:test/art/bg.webp/1");
  });
});
