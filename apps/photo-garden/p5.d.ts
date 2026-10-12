// The part of p5 1.x's instance mode this app uses, for the URL it imports p5 from (#266). Written
// here rather than pulled from @types/p5: the app needs a dozen members, not the whole library.
declare module "https://esm.sh/p5@1.11.11?bundle" {
  export default class p5 {
    constructor(sketch: (p: p5) => void, node?: HTMLElement);
    /** Off: the friendly-error layer checks every call, which costs frames on a phone. */
    static disableFriendlyErrors: boolean;
    setup: () => void;
    draw: () => void;
    readonly width: number;
    readonly height: number;
    readonly deltaTime: number;
    readonly frameCount: number;
    readonly drawingContext: CanvasRenderingContext2D;
    readonly canvas: HTMLCanvasElement;
    createCanvas(w: number, h: number): { elt: HTMLCanvasElement };
    resizeCanvas(w: number, h: number, noRedraw?: boolean): void;
    pixelDensity(d?: number): number;
    frameRate(fps: number): void;
    noise(x: number, y?: number, z?: number): number;
    noiseSeed(seed: number): void;
    noiseDetail(lod: number, falloff?: number): void;
    millis(): number;
    loop(): void;
    noLoop(): void;
    isLooping(): boolean;
    redraw(): void;
    remove(): void;
  }
}
