// A probe for the faces specs (docs/25 §Faces): starts the live camera with the options its buttons
// name and writes what the frames carried into `<pre data-testid="probe">` as JSON — how often frames
// and faces came, how stale the faces were, how late `sameFrame` frames were, and where `Face.matrix`
// puts the canonical nose tip next to where the finder put the nose. Not an app anyone uses: a ruler.

import { defineApp, type FaceOptions, type LiveCamera, type LiveFrameInfo, type ViewProps } from "potyro";

/** MediaPipe's canonical nose tip (cm) and the projection docs/25 gives, written out as an app would. */
const NOSE = { x: 0, y: -1.126865, z: 7.475604 };
function project(m: number[], p: { x: number; y: number; z: number }, w: number, h: number) {
  const t = Math.tan(((63 / 2) * Math.PI) / 180);
  const X = m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!;
  const Y = m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!;
  const Z = m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!;
  return { x: ((1 + X / (-Z * t * (w / h))) / 2) * w, y: ((1 - Y / (-Z * t)) / 2) * h };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number };

function mountProbe(el: HTMLElement, props: ViewProps): () => void {
  const ctx = props.runtime.ctx;
  const out = document.createElement("pre");
  out.dataset.testid = "probe";
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const modes: Record<string, FaceOptions> = { normal: { points: true }, same: { points: true, sameFrame: true }, high: { points: true, detail: "high" } };
  let cam: LiveCamera | null = null;
  let alive = true;

  const run = async (mode: string) => {
    cam?.stop();
    const live = ctx.caps.camera?.live;
    if (!live) return void (out.textContent = JSON.stringify({ error: "no live camera" }));
    // As big as the camera gives: the fixture decides (640×480, or a bigger one for measuring detail).
    const next = await live({ width: 1920, height: 1080, faces: modes[mode]! });
    if (!alive) return next.stop();
    cam = next;
    // When each video frame was on the video (performance.now()), by its time: what sameFrame lags by.
    const seenAt = new Map<number, number>();
    const v = next.video as FrameVideo;
    const watch = () => v.requestVideoFrameCallback?.((now, meta) => {
      seenAt.set(Math.round(meta.mediaTime * 1000), now);
      if (next.active) watch();
    });
    watch();
    const began = performance.now();
    let frames = 0;
    let stills = 0;
    const findTimes = new Set<number>();
    const stale: number[] = [];
    /** The nose of each find, for how much it wobbles on a still picture. */
    const noses: Array<{ x: number; y: number }> = [];
    const jitter = () => {
      const last = noses.slice(-60);
      if (last.length < 2) return null;
      const mx = last.reduce((a, p) => a + p.x, 0) / last.length;
      const my = last.reduce((a, p) => a + p.y, 0) / last.length;
      return Math.sqrt(last.reduce((a, p) => a + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / last.length);
    };
    const lag: number[] = [];
    let noseOff: number | null = null;
    let nose: { x: number; y: number } | null = null;
    let projected: { x: number; y: number } | null = null;
    let z: number | null = null;
    next.onFrame((video, info: LiveFrameInfo) => {
      frames++;
      const g = canvas.getContext("2d")!;
      g.drawImage(info.frame ?? video, 0, 0, canvas.width, canvas.height);
      if (info.frame) stills++;
      const f = info.faces?.[0];
      if (!f || info.facesTime === undefined) return;
      if (!findTimes.has(info.facesTime)) noses.push({ x: f.nose.x, y: f.nose.y });
      findTimes.add(info.facesTime);
      stale.push(info.time - info.facesTime);
      const at = seenAt.get(Math.round(info.time));
      if (info.frame && at !== undefined) lag.push(performance.now() - at);
      if (f.matrix) {
        projected = project(f.matrix, NOSE, info.width, info.height);
        nose = f.nose;
        noseOff = Math.hypot(projected.x - f.nose.x, projected.y - f.nose.y);
      }
      z = f.points?.[1]?.z ?? null;
      const secs = (performance.now() - began) / 1000;
      out.textContent = JSON.stringify({
        mode,
        graphics: next.graphics,
        size: [info.width, info.height],
        secs,
        fps: frames / secs,
        facesPerSec: findTimes.size / secs,
        stills,
        staleMedian: median(stale),
        lagMedian: median(lag),
        lagSamples: lag.length,
        noseOff,
        nose,
        projected,
        noseZ: z,
        eyeWidth: f.eyes.left.width,
        noseJitter: jitter(),
      });
    });
  };

  for (const mode of Object.keys(modes)) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `Probe ${mode}`;
    b.addEventListener("click", () => void run(mode));
    el.append(b);
  }
  el.append(canvas, out);
  return () => {
    alive = false;
    cam?.stop();
    el.replaceChildren();
  };
}

export default defineApp({
  id: "faces-probe",
  name: "Faces probe",
  version: "1.0.0",
  schemaVersion: 1,
  permissions: { camera: true },
  entities: { note: { label: "Note", displayField: "title", fields: { title: { type: "text" } } } },
  pages: [{ id: "probe", title: "Probe", view: { type: "custom", entity: "note", mount: mountProbe } }],
});
