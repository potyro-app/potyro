// @vitest-environment happy-dom
// A picture's address is read once per picture. `runtime.ctx` is a fresh object on every access, so a
// hook that watched the ctx read the picture again on every render: a page header re-rendering with
// its page minted a new address each time, and its backdrop <img> never finished loading one before
// the next replaced it — a grey band where the photo should be.

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { usePictureUrl } from "../src/picture.js";

afterEach(cleanup);

describe("usePictureUrl", () => {
  it("asks for a file's address once, however often the page re-renders with a fresh ctx", async () => {
    let asked = 0;
    const fresh = () => ({
      media: { put: async () => ({ key: "k", mime: "image/webp" }), url: async () => "blob:media" },
      files: { url: async () => `blob:file-${++asked}` },
    });
    let rerender: () => void = () => {};
    function Header() {
      const [, set] = useState(0);
      rerender = () => set((n) => n + 1);
      const url = usePictureUrl(fresh() as never, "art/plates.webp");
      return <img alt="" src={url ?? ""} />;
    }
    const { container } = render(<Header />);
    await act(async () => {});
    for (let i = 0; i < 5; i++) await act(async () => rerender());
    expect(asked).toBe(1);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("blob:file-1");
  });
});
