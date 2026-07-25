// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebCapabilities } from "../src/index.js";

// WebCapabilities against a DOM (happy-dom): feature detection + the camera/filesystem code paths
// that don't need a real user dialog. Notifications stay null on web (in-app "due"); geolocation is
// absent in happy-dom, exercising the null branch.

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).showSaveFilePicker;
});

describe("createWebCapabilities feature detection", () => {
  it("exposes camera + filesystem + network in a DOM, and null geolocation without the API", () => {
    const caps = createWebCapabilities();
    expect(caps.camera).not.toBeNull();
    expect(caps.filesystem).toBeTruthy();
    expect(caps.network).toBeTruthy();
    expect(caps.notifications).toBeNull(); // deliberate: web degrades to in-app "due"
    expect(caps.geolocation).toBeNull(); // no navigator.geolocation in this env
  });
});

describe("camera capture", () => {
  it("cues the camera and resolves the selected file as a Blob", async () => {
    const inputs: HTMLInputElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "input") inputs.push(el as HTMLInputElement);
      return el;
    });

    const caps = createWebCapabilities();
    const pending = caps.camera!.capture({ source: "camera" });

    const input = inputs[0]!;
    expect(input.accept).toBe("image/*");
    expect(input.getAttribute("capture")).toBe("environment");

    const file = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.onchange!(new Event("change"));

    const blob = await pending;
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(3);
  });
});

describe("filesystem save", () => {
  it("uses the File System Access API when available", async () => {
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const showSaveFilePicker = vi.fn(async () => ({ createWritable: async () => ({ write, close }) }));
    (globalThis as Record<string, unknown>).showSaveFilePicker = showSaveFilePicker;

    const data = new Blob(["hello"], { type: "text/plain" });
    await createWebCapabilities().filesystem.save("note.txt", data);

    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: "note.txt" });
    expect(write).toHaveBeenCalledWith(data);
    expect(close).toHaveBeenCalled();
  });

  it("falls back to an <a download> when the API is absent", async () => {
    delete (globalThis as Record<string, unknown>).showSaveFilePicker;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const anchors: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {});
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    });

    await createWebCapabilities().filesystem.save("note.txt", new Blob(["hi"]));

    const a = anchors[0]!;
    expect(a.download).toBe("note.txt");
    expect(a.href).toContain("blob:mock");
    expect(a.click).toHaveBeenCalled();
  });
});
