// CapacitorCapabilities — the native (Android/iOS) implementation of the capability seam (KA-03).
// It is the one place the app gains powers the web can't offer reliably — chiefly EXACT offline
// local notifications (`supportsExactScheduling = true`): a reminder that fires with the app closed.
//
// The class depends only on minimal plugin *interfaces* (not the concrete @capacitor/* modules), so
// it unit-tests without a device/WebView; `createCapacitorCapabilities()` dynamically imports the
// real plugins. The QuickJS isolate and the host's per-app mediation are unchanged — only the
// composition root swaps this in for WebCapabilities when running under Capacitor.

import type { Geo } from "potyro";
import type { Capabilities, CameraCap, FileCap, GeoCap, HapticsCap, NetworkCap, NotificationCap } from "@potyro/capabilities";
import { pickFilesFromInput } from "@potyro/capabilities";

// --- Minimal plugin shapes (a subset of the real @capacitor/* APIs we actually use) -------------

export interface CameraPlugin {
  getPhoto(opts: { resultType: "uri"; source: "CAMERA" | "PHOTOS" }): Promise<{ webPath?: string }>;
  /**
   * ASK FOR ONE ALIAS, never for all of them.
   *
   * `requestPermissions()` with no argument checks every alias the plugin has — camera AND photos —
   * and the photos one demands `READ_EXTERNAL_STORAGE` in the manifest. On a phone where that
   * permission does nothing (Android 13+ hands the photo back through the plugin's own provider),
   * the call still fails with "Missing the following permissions in AndroidManifest.xml", the
   * rejection travels back through `ctx.caps.camera`, and the menu simply closes: tapping "Take a
   * photo" did nothing at all. Found on a Pixel, 2026-09-16.
   */
  requestPermissions?(opts?: { permissions?: Array<"camera" | "photos"> }): Promise<unknown>;
}
export interface GeolocationPlugin {
  getCurrentPosition(opts?: { enableHighAccuracy?: boolean; timeout?: number }): Promise<{ coords: { latitude: number; longitude: number } }>;
  requestPermissions?(): Promise<unknown>;
}
export interface ScheduledNotification {
  id: number;
  title: string;
  body?: string;
  schedule: { at: Date; allowWhileIdle: boolean };
  extra: { potyroId: string; at: string };
}
export interface LocalNotificationsPlugin {
  requestPermissions(): Promise<{ display?: string }>;
  schedule(opts: { notifications: ScheduledNotification[] }): Promise<unknown>;
  cancel(opts: { notifications: Array<{ id: number }> }): Promise<unknown>;
  getPending(): Promise<{ notifications: Array<{ id: number; schedule?: { at?: string }; extra?: { potyroId?: string; at?: string } }> }>;
}
export interface FilesystemPlugin {
  writeFile(opts: { path: string; data: string; directory: string; recursive?: boolean }): Promise<{ uri: string }>;
}
export interface HapticsPlugin {
  vibrate(opts: { duration: number }): Promise<void>;
}

export interface CapacitorPlugins {
  Camera: CameraPlugin;
  Geolocation: GeolocationPlugin;
  LocalNotifications: LocalNotificationsPlugin;
  Filesystem: FilesystemPlugin;
  Haptics: HapticsPlugin;
}

/** Injectable host helpers (overridable in tests; default to the WebView globals). */
export interface CapacitorHostHelpers {
  fetchImpl: (input: string) => Promise<{ blob(): Promise<Blob> }>;
  blobToBase64: (blob: Blob) => Promise<string>;
  pickFile: () => Promise<Blob>;
}

// --- Helpers ------------------------------------------------------------------------------------

/** Capacitor notification ids are 32-bit ints; derive a stable positive one from the app's string
 *  id. The original string round-trips via the notification's `extra.potyroId` (see `list`). */
export function stableNotificationId(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2_147_483_646) + 1; // 1..2^31-1, never 0
}

function firstDuration(pattern: number | number[] | undefined): number {
  if (typeof pattern === "number") return pattern;
  if (Array.isArray(pattern) && typeof pattern[0] === "number") return pattern[0];
  return 30;
}

function defaultBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("failed to read blob"));
    reader.onloadend = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1)); // strip the data:...;base64, prefix
    };
    reader.readAsDataURL(blob);
  });
}

/** Read a Blob from a transient file input — the Android WebView renders the native chooser. */
function domPickFile(): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) resolve(file);
      else reject(new Error("no file selected"));
    };
    input.click();
  });
}

// --- Capabilities -------------------------------------------------------------------------------

export class CapacitorCapabilities implements Capabilities {
  readonly camera: CameraCap;
  readonly notifications: NotificationCap;
  readonly geolocation: GeoCap;
  readonly haptics: HapticsCap;
  readonly filesystem: FileCap;
  readonly network: NetworkCap;

  constructor(plugins: CapacitorPlugins, helpers?: Partial<CapacitorHostHelpers>) {
    const fetchImpl = helpers?.fetchImpl ?? ((input: string) => globalThis.fetch(input));
    const blobToBase64 = helpers?.blobToBase64 ?? defaultBlobToBase64;
    const pickFile = helpers?.pickFile ?? domPickFile;
    const { Camera, Geolocation, LocalNotifications, Filesystem, Haptics } = plugins;

    this.camera = {
      capture: async (o) => {
        const fromLibrary = o?.source === "library";
        // Only what this capture needs: asking for both aliases fails over a storage permission the
        // camera path never uses (see CameraPlugin above).
        await Camera.requestPermissions?.({ permissions: [fromLibrary ? "photos" : "camera"] });
        const photo = await Camera.getPhoto({ resultType: "uri", source: fromLibrary ? "PHOTOS" : "CAMERA" });
        if (!photo.webPath) throw new Error("camera returned no image");
        return (await fetchImpl(photo.webPath)).blob();
      },
    };

    this.geolocation = {
      current: async (): Promise<Geo> => {
        await Geolocation.requestPermissions?.();
        const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10_000 });
        return { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
    };

    this.notifications = {
      supportsExactScheduling: true, // the deciding native feature — exact, offline, app-closed
      schedule: async (n) => {
        await LocalNotifications.requestPermissions();
        await LocalNotifications.schedule({
          notifications: [
            {
              id: stableNotificationId(n.id),
              title: n.title,
              body: n.body,
              schedule: { at: new Date(n.at), allowWhileIdle: true },
              extra: { potyroId: n.id, at: n.at },
            },
          ],
        });
      },
      cancel: async (id) => {
        await LocalNotifications.cancel({ notifications: [{ id: stableNotificationId(id) }] });
      },
      list: async () => {
        const pending = await LocalNotifications.getPending();
        return pending.notifications.map((p) => ({
          id: p.extra?.potyroId ?? String(p.id),
          at: p.extra?.at ?? p.schedule?.at ?? "",
        }));
      },
    };

    this.haptics = {
      vibrate: async (pattern) => {
        await Haptics.vibrate({ duration: firstDuration(pattern) });
      },
    };

    this.filesystem = {
      pick: () => pickFile(),
      // The webview's own file input: on Android it opens the system picker, Files and Drive included.
      pickFiles: (opts) => pickFilesFromInput(opts),
      save: async (name, data) => {
        await Filesystem.writeFile({
          path: name,
          data: await blobToBase64(data),
          directory: "DOCUMENTS",
          recursive: true,
        });
      },
    };

    this.network = { fetch: (input, init) => globalThis.fetch(input, init) };
  }
}

/** Wire the real @capacitor/* plugins (native runtime only). Dynamically imported so the web bundle
 *  never pulls Capacitor. */
export async function createCapacitorCapabilities(): Promise<Capabilities> {
  const [{ Camera }, { Geolocation }, { LocalNotifications }, { Filesystem, Directory }, { Haptics }] = await Promise.all([
    import("@capacitor/camera"),
    import("@capacitor/geolocation"),
    import("@capacitor/local-notifications"),
    import("@capacitor/filesystem"),
    import("@capacitor/haptics"),
  ]);
  // Adapt the real plugins to our minimal shapes (enums → the string/const values we declared).
  const plugins: CapacitorPlugins = {
    Camera: Camera as unknown as CameraPlugin,
    Geolocation: Geolocation as unknown as GeolocationPlugin,
    LocalNotifications: LocalNotifications as unknown as LocalNotificationsPlugin,
    Filesystem: {
      writeFile: (opts) => Filesystem.writeFile({ ...opts, directory: Directory.Documents }),
    },
    Haptics: Haptics as unknown as HapticsPlugin,
  };
  return new CapacitorCapabilities(plugins);
}
