import { test, expect, type Page } from "@playwright/test";
import { startProbe, type Probe } from "./realm.js";

// The shell's `frame-src 'none'` (#272, docs/22 §3.2), checked where it is served. A sandboxed srcdoc
// frame — what a realm is — may navigate ITSELF anywhere: its sandbox allows that and its own CSP
// cannot stop it. Only the embedding page's frame-src can, and that is the shell's policy. So this
// builds exactly such a frame in the shell and counts what reaches a probe; a control on a page with
// no policy shows the same frame does reach it.
//
// Shared by shell-csp-sandbox.spec.ts (the dev server) and shell-csp-prod.spec.ts (a production
// build). `POTYRO_CSP_HEADER=0` is for a server that sends no headers at all — what the Capacitor
// WebView is — where the <meta> in index.html must do it alone.

/** Build a srcdoc frame that navigates itself to the probe; resolve with the CSP violations seen. */
async function selfNavigatingFrame(page: Page, url: string): Promise<string[]> {
  return page.evaluate(
    (target) =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = [];
        document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`));
        const f = document.createElement("iframe");
        f.setAttribute("sandbox", "allow-scripts");
        f.srcdoc = `<!doctype html><script>location.href = ${JSON.stringify(target)};<\/script>`;
        document.body.appendChild(f);
        setTimeout(() => resolve(seen), 2000);
      }),
    url,
  );
}

export function shellCspTests(): void {
  let probe: Probe;
  test.beforeAll(async () => {
    probe = await startProbe();
  });
  test.afterAll(async () => {
    await probe.close();
  });

  test("the shell is served with frame-src 'none', and a sandboxed frame cannot navigate itself out", async ({ page }) => {
    probe.hits.length = 0;
    const res = await page.goto("/");
    if (process.env.POTYRO_CSP_HEADER !== "0") expect(res?.headers()["content-security-policy"]).toBe("frame-src 'none'");
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", "frame-src 'none'");
    await selfNavigatingFrame(page, `${probe.origin}/self-nav?data=stolen`);
    expect(probe.hits).toEqual([]);
  });

  test("control: the same frame on a page without the shell's policy does reach the probe", async ({ page }) => {
    probe.hits.length = 0;
    // A page on a plain http origin that sends no policy: the probe itself.
    await page.goto(`${probe.origin}/control`);
    await page.setContent("<!doctype html><body></body>");
    await selfNavigatingFrame(page, `${probe.origin}/self-nav?data=stolen`);
    await expect.poll(() => probe.hits, { timeout: 5_000 }).toContain("GET /self-nav?data=stolen");
  });
}
