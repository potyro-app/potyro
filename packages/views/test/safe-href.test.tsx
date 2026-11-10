// @vitest-environment happy-dom
// A link made from data only ever leads out: to the web, or to a mail program. A record's value can
// come from anyone the app is shared with, and the page that renders it holds the person's apps.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { FieldValue } from "../src/field-value.js";
import { safeHref } from "../src/safe-href.js";

afterEach(cleanup);

describe("safeHref", () => {
  it("lets the web and mail through as they are", () => {
    expect(safeHref("https://example.org/a?b=1#c")).toBe("https://example.org/a?b=1#c");
    expect(safeHref("http://example.org")).toBe("http://example.org/");
    expect(safeHref("mailto:ana@example.org")).toBe("mailto:ana@example.org");
  });

  it("reads an address typed without its scheme as a web address", () => {
    expect(safeHref("example.org/menu")).toBe("https://example.org/menu");
    expect(safeHref("  www.example.org  ")).toBe("https://www.example.org/");
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " \u0001javascript:alert(1)",
    "java\nscript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://example.org/1",
    "intent://scan/#Intent;scheme=zxing;end",
    "//example.org/x",
    "/relative/path",
    "just some words",
    "",
  ])("makes no link from %j", (value) => {
    expect(safeHref(value)).toBeNull();
  });

  it("makes no link from something that is not text", () => {
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref({ toString: () => "https://example.org" })).toBeNull();
  });
});

const app = defineApp({
  id: "links",
  name: "Links",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { place: { displayField: "name", fields: { name: { type: "text", required: true }, site: { type: "url" } } } },
  pages: [{ id: "list", title: "Places", view: { type: "list", entity: "place", display: { primary: "name" } } }],
});

async function makeRuntime(): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open(app.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
}

describe("a url field on the page", () => {
  it("is a link when it leads to the web", async () => {
    const { container } = render(<FieldValue runtime={await makeRuntime()} entity="place" fieldKey="site" value="https://example.org/a" />);

    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.org/a");
  });

  it("is plain text, not a link, when it would run in this page", async () => {
    const { container } = render(
      <FieldValue runtime={await makeRuntime()} entity="place" fieldKey="site" value="javascript:alert(document.domain)" />,
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("javascript:alert(document.domain)");
  });
});
