import { expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Helpers for the browser-realm specs (#272, docs/22): installing a shared app from source, and a
// probe server that counts every request and WebSocket upgrade that reaches it — the evidence an
// escape spec trusts over the app's own report.

/** Install a source as a shared (untrusted) app before the page loads, and open it. */
export async function installShared(page: Page, id: string, name: string, source: string): Promise<void> {
  await page.addInitScript(
    ([i, n, s]) => {
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: i, name: n, source: s, trusted: false, updatedAt: new Date().toISOString() }]));
    },
    [id, name, source] as const,
  );
  await page.goto(`/?user=${id}`);
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
}

export interface Probe {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  /** Every request and upgrade, as "METHOD /path". */
  hits: string[];
  close(): Promise<void>;
}

export async function startProbe(): Promise<Probe> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.setHeader("access-control-allow-origin", "*");
    res.end("probe");
  });
  server.on("upgrade", (req, socket) => {
    hits.push(`UPGRADE ${req.url}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The shell's own event loop: the largest gap between 10 ms ticks since `start`. */
export async function startGapMeter(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __gap: number; __gapTimer?: ReturnType<typeof setInterval> };
    w.__gap = 0;
    let last = performance.now();
    if (w.__gapTimer) clearInterval(w.__gapTimer);
    w.__gapTimer = setInterval(() => {
      const t = performance.now();
      w.__gap = Math.max(w.__gap, t - last);
      last = t;
    }, 10);
  });
  return () => page.evaluate(() => (window as unknown as { __gap: number }).__gap);
}
