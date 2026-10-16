import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "./console-guard";

// Faces v2 from the REAL model (docs/25 §Faces): the same Mona Lisa fixture as
// mirror-faces-model-trusted, read by a probe app (fixtures/faces-probe.app.ts) that writes what each
// frame carried. The claims:
//   - `Face.matrix` is MediaPipe's facial transformation matrix, column-major, and docs/25's
//     projection takes the canonical nose tip through it onto the nose the finder found;
//   - `Face.points` carry depth (the nose tip in front of the head's middle: negative z);
//   - `info.facesTime` says which frame the faces came from;
//   - `faces: { sameFrame: true }` hands every frame with its own faces and a still of that frame;
//   - `faces: { detail: "high" }` still finds her;
//   - `cam.graphics` says what draws.
// Each run's numbers are attached to the report: they are the measurements docs/25 quotes.

test.use({
  viewport: { width: 412, height: 860 },
  colorScheme: "light",
  permissions: async ({ browserName }, use) => use(browserName === "chromium" ? ["camera"] : []),
  launchOptions: [
    async ({ browserName }, use) =>
      use(
        browserName === "chromium"
          ? { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${process.env.POTYRO_FACES_FIXTURE ?? "e2e/fixtures/face-mona-lisa.mjpeg"}`] }
          : {},
      ),
    { scope: "worker" },
  ],
});

interface Probe {
  mode: string;
  graphics: string;
  size: [number, number];
  secs: number;
  fps: number;
  facesPerSec: number;
  stills: number;
  staleMedian: number | null;
  lagMedian: number | null;
  lagSamples: number;
  noseOff: number | null;
  nose: { x: number; y: number } | null;
  projected: { x: number; y: number } | null;
  noseZ: number | null;
  eyeWidth: number;
}

async function openProbe(page: Page): Promise<void> {
  const source = readFileSync(fileURLToPath(new URL("./fixtures/faces-probe.app.ts", import.meta.url)), "utf8");
  await page.addInitScript((src) => {
    localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "faces-probe", name: "Faces probe", source: src, trusted: true, updatedAt: new Date().toISOString() }]));
  }, source);
  await page.goto("/?user=faces-probe");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
}

/** Run one mode until it has `secs` seconds of faces, and its last numbers. */
async function probe(page: Page, mode: string, secs: number): Promise<Probe> {
  await page.getByRole("button", { name: `Probe ${mode}` }).click();
  const out = page.getByTestId("probe");
  let last: Probe | null = null;
  await expect
    .poll(
      async () => {
        const text = (await out.textContent()) ?? "";
        if (!text.startsWith("{")) return "waiting";
        last = JSON.parse(text) as Probe;
        return last.mode === mode && last.noseOff !== null && last.secs >= secs ? "done" : "waiting";
      },
      { timeout: 120_000, intervals: [500] },
    )
    .toBe("done");
  return last!;
}

test("Faces v2: the matrix puts the canonical nose tip on her nose; facesTime, sameFrame and high detail say what they claim", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "only Chromium's fake camera can play a file");
  test.setTimeout(300_000);
  await openProbe(page);

  const normal = await probe(page, "normal", 6);
  await info.attach("normal", { body: JSON.stringify(normal, null, 2), contentType: "application/json" });
  const [w, h] = normal.size;
  // The canonical nose tip, through the matrix, lands within a few pixels of the finder's own nose tip
  // (her eye is ~30 px wide on this 640×480 frame: 6% of the width would be her whole eye).
  expect(normal.noseOff!).toBeLessThan(0.02 * w);
  expect(normal.nose!.x).toBeGreaterThan(0.3 * w);
  expect(normal.nose!.x).toBeLessThan(0.7 * w);
  expect(normal.nose!.y).toBeGreaterThan(0.2 * h);
  expect(normal.nose!.y).toBeLessThan(0.8 * h);
  // The nose tip is in front of the head's middle.
  expect(normal.noseZ!).toBeLessThan(0);
  // Faces come from an earlier frame or this one, never a later one; and they keep coming.
  expect(normal.staleMedian!).toBeGreaterThanOrEqual(0);
  expect(normal.facesPerSec).toBeGreaterThan(3);
  expect(normal.stills).toBe(0);
  expect(["gpu", "software", "unknown"]).toContain(normal.graphics);

  const same = await probe(page, "same", 6);
  await info.attach("sameFrame", { body: JSON.stringify(same, null, 2), contentType: "application/json" });
  // Every frame handed on carries the faces of that very frame, and its still.
  expect(same.staleMedian).toBe(0);
  expect(same.stills).toBeGreaterThan(10);
  expect(same.noseOff!).toBeLessThan(0.02 * w);
  expect(same.lagSamples).toBeGreaterThan(5);

  const high = await probe(page, "high", 6);
  await info.attach("high", { body: JSON.stringify(high, null, 2), contentType: "application/json" });
  expect(high.noseOff!).toBeLessThan(0.02 * high.size[0]);
  expect(high.facesPerSec).toBeGreaterThan(1);

  // The measurements, for docs/25.
  console.info(
    `[faces-v2] graphics=${normal.graphics} size=${w}x${h} | normal fps=${normal.fps.toFixed(1)} faces/s=${normal.facesPerSec.toFixed(1)} stale=${normal.staleMedian?.toFixed(1)}ms | ` +
      `sameFrame fps=${same.fps.toFixed(1)} lag=${same.lagMedian?.toFixed(1)}ms | high fps=${high.fps.toFixed(1)} faces/s=${high.facesPerSec.toFixed(1)} stale=${high.staleMedian?.toFixed(1)}ms | noseOff normal=${normal.noseOff?.toFixed(2)}px high=${high.noseOff?.toFixed(2)}px | eye normal=${normal.eyeWidth.toFixed(1)}px high=${high.eyeWidth.toFixed(1)}px`,
  );
});
