// CapacitorCapabilities — the native (Android/iOS) implementation of the capability seam (KA-03).
// It is the one place the app gains powers the web can't offer reliably — chiefly EXACT offline
// local notifications (`supportsExactScheduling = true`): a reminder that fires with the app closed.
//
// The class depends only on minimal plugin *interfaces* (not the concrete @capacitor/* modules), so
// it unit-tests without a device/WebView; `createCapacitorCapabilities()` dynamically imports the
// real plugins. The QuickJS isolate and the host's per-app mediation are unchanged — only the
// composition root swaps this in for WebCapabilities when running under Capacitor.

import type { Geo } from "potyro";
import type { Capabilities, CameraCap, FileCap, GeoCap, HapticsCap, LiveCameraCap, NetworkCap, NotificationCap, ShareCap, SocketCap, SpeechCap } from "@potyro/capabilities";
import { pickFilesFromInput, sharedLiveCamera, sharedWebSockets, sharedWebSpeech } from "@potyro/capabilities";
import { localOpenerOver, type LocalSocketPlugin } from "./local-sockets.js";
import { speechOverPlugin, type SpeechPlugin } from "./native-speech.js";

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
   *
   * And NEVER for `photos` alone: that alias carries no Android permission, so with CAMERA declared
   * the plugin hands Capacitor an empty request whose callback never comes — "Choose one" did
   * nothing while "Take a photo" worked. Found on a Pixel, 2026-10-13.
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

export interface SharePlugin {
  share(opts: { title?: string; text?: string; url?: string; files?: string[]; dialogTitle?: string }): Promise<unknown>;
}

export interface CapacitorPlugins {
  Camera: CameraPlugin;
  Geolocation: GeolocationPlugin;
  LocalNotifications: LocalNotificationsPlugin;
  Filesystem: FilesystemPlugin;
  Haptics: HapticsPlugin;
  /** @capacitor/share; absent = no share sheet (the dialog copies and saves). */
  Share?: SharePlugin;
}

/** A file's name as it goes into the cache folder: no folders, nothing a path would trip on. */
const cacheName = (name: string): string => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "file";

/** The phone's share sheet as a `ShareCap`: files land in the cache, then go by their file:// URLs. */
export function nativeShare(Share: SharePlugin, Filesystem: FilesystemPlugin, blobToBase64: (b: Blob) => Promise<string>): ShareCap {
  return {
    // The sheet takes words, links and any file; nothing here is refused.
    canShare: () => true,
    share: async (p) => {
      const files: string[] = [];
      const batch = `potyro-share/${Date.now()}`;
      for (const [i, f] of (p.files ?? []).entries()) {
        const { uri } = await Filesystem.writeFile({ path: `${batch}/${i + 1}-${cacheName(f.name)}`, data: await blobToBase64(f), directory: "CACHE", recursive: true });
        files.push(uri);
      }
      try {
        await Share.share({ ...(p.title ? { title: p.title, dialogTitle: p.title } : {}), ...(p.text ? { text: p.text } : {}), ...(p.url ? { url: p.url } : {}), ...(files.length ? { files } : {}) });
      } catch (e) {
        // The plugin rejects "Share canceled" when the person backs out: not a failure.
        if (/cancel/i.test(e instanceof Error ? e.message : String(e))) throw new DOMException("Share canceled", "AbortError");
        throw e;
      }
    },
  };
}

/** Injectable host helpers (overridable in tests; default to the WebView globals). */
export interface CapacitorHostHelpers {
  fetchImpl: (input: string) => Promise<{ blob(): Promise<Blob> }>;
  blobToBase64: (blob: Blob) => Promise<string>;
  pickFile: () => Promise<Blob>;
  /** The live camera; the page's shared one by default. */
  liveCamera: LiveCameraCap | null;
  /**
   * How many notifications the OS keeps pending for one app, or null for no limit worth managing.
   * iOS keeps 64 and silently drops the rest (IOS_PENDING_LIMIT); Android's limit is in the hundreds.
   */
  maxPendingNotifications: number | null;
  /** Live connections; the page's shared set by default (docs/28). */
  sockets: SocketCap | null;
  /** Android's `PotyroLocalSocket` plugin, for ws:// to the local network (docs/28 §6). */
  localSockets: LocalSocketPlugin;
  /** Voice input; the recognizer plugin over the WebView's own speech by default (docs/29). */
  speech: SpeechCap | null;
  /** Android's `PotyroSpeech` plugin: the phone's own recognizer, on the device where it can (docs/29). */
  speechPlugin: SpeechPlugin;
}

/**
 * iOS keeps at most 64 pending local notifications per app — "a system limit and there is no way
 * around it" (Apple, developer forums thread 811171) — and one scheduled past it is dropped without
 * an error. The reconciler schedules one per record per reminder, across every app, so a person with
 * a few busy apps passes 64 quickly, and which ones iOS kept would be arbitrary. `makeRoom` keeps the
 * SOONEST 64 instead: a later reminder waits, and is scheduled again when its app next reconciles.
 */
export const IOS_PENDING_LIMIT = 64;

export interface PendingRef {
  id: number;
  /** Epoch ms; NaN when the pending notification carries no readable time. */
  at: number;
}

/**
 * Whether a notification at `at` may be scheduled with `pending` already held, and which pending ones
 * to cancel first so the soonest `max` are what the OS holds. Pure. `pending` must not contain the
 * candidate itself (rescheduling the same id replaces it, it does not add one).
 */
export function makeRoom(pending: readonly PendingRef[], at: number, max: number): { keep: boolean; drop: number[] } {
  if (pending.length < max) return { keep: true, drop: [] };
  // Latest first; one with no readable time counts as the latest, since nothing says it is near.
  const when = (p: PendingRef): number => (Number.isNaN(p.at) ? Infinity : p.at);
  const byLatest = [...pending].sort((a, b) => when(b) - when(a));
  const out = byLatest.slice(0, pending.length - max + 1); // enough to make room for one
  // The candidate must be sooner than every one it would push out; otherwise it is the one to wait.
  if (out.some((p) => when(p) <= at)) return { keep: false, drop: [] };
  return { keep: true, drop: out.map((p) => p.id) };
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
  /**
   * The live camera is the WebView's own getUserMedia — the same one-per-page session as on the web
   * (docs/25). The camera plugin takes photos; it does not stream. Capacitor's BridgeWebChromeClient
   * answers the WebView's VIDEO_CAPTURE request by asking for CAMERA, which the manifest declares.
   */
  readonly liveCamera: LiveCameraCap | null;
  /**
   * Live connections (docs/28): the WebView's own WebSocket — wss://, which the rooms relay lets in from
   * https://localhost — and, on Android, ws:// to the local network over Potyro's own plugin.
   */
  readonly sockets: SocketCap | null;
  /**
   * The phone's own share sheet, through @capacitor/share: the WebView has no `navigator.share`, so
   * without this the share dialog could only copy. Files are written to the app's cache first (the
   * plugin shares file:// URLs through Capacitor's FileProvider); the OS clears that folder.
   */
  readonly share: ShareCap | null;
  /** The phone's recognizer (Android's plugin), else the WebView's speech, else a recording to write down (docs/29). */
  readonly speech: SpeechCap | null;

  constructor(plugins: CapacitorPlugins, helpers?: Partial<CapacitorHostHelpers>) {
    const fetchImpl = helpers?.fetchImpl ?? ((input: string) => globalThis.fetch(input));
    const blobToBase64 = helpers?.blobToBase64 ?? defaultBlobToBase64;
    const pickFile = helpers?.pickFile ?? domPickFile;
    const maxPending = helpers?.maxPendingNotifications ?? null;
    const { Camera, Geolocation, LocalNotifications, Filesystem, Haptics } = plugins;

    this.camera = {
      capture: async (o) => {
        const fromLibrary = o?.source === "library";
        // Only what this capture needs: asking for both aliases fails over a storage permission the
        // camera path never uses (see CameraPlugin above). The library needs nothing — the plugin's
        // `photos` alias names no Android permission, and a request for it never answers.
        if (!fromLibrary) await Camera.requestPermissions?.({ permissions: ["camera"] });
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
        const id = stableNotificationId(n.id);
        if (maxPending !== null) {
          const held = (await LocalNotifications.getPending()).notifications
            .filter((p) => p.id !== id)
            .map((p) => ({ id: p.id, at: Date.parse(p.extra?.at ?? p.schedule?.at ?? "") }));
          const room = makeRoom(held, new Date(n.at).getTime(), maxPending);
          if (!room.keep) return; // sooner ones fill the OS's list; its app's next reconcile tries again
          if (room.drop.length) await LocalNotifications.cancel({ notifications: room.drop.map((d) => ({ id: d })) });
        }
        await LocalNotifications.schedule({
          notifications: [
            {
              id,
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
    this.liveCamera = helpers?.liveCamera !== undefined ? helpers.liveCamera : sharedLiveCamera();
    this.sockets = helpers?.sockets !== undefined ? helpers.sockets : sharedWebSockets(helpers?.localSockets ? localOpenerOver(helpers.localSockets) : undefined);
    this.share = plugins.Share ? nativeShare(plugins.Share, Filesystem, blobToBase64) : null;
    const web = sharedWebSpeech();
    this.speech = helpers?.speech !== undefined ? helpers.speech : helpers?.speechPlugin ? speechOverPlugin(helpers.speechPlugin, web) : web;
  }
}

/** Wire the real @capacitor/* plugins (native runtime only). Dynamically imported so the web bundle
 *  never pulls Capacitor. */
export async function createCapacitorCapabilities(): Promise<Capabilities> {
  const [{ Capacitor }, { Camera }, { Geolocation }, { LocalNotifications }, { Filesystem, Directory }, { Haptics }, { Share }] = await Promise.all([
    import("@capacitor/core"),
    import("@capacitor/camera"),
    import("@capacitor/geolocation"),
    import("@capacitor/local-notifications"),
    import("@capacitor/filesystem"),
    import("@capacitor/haptics"),
    import("@capacitor/share"),
  ]);
  // Adapt the real plugins to our minimal shapes (enums → the string/const values we declared).
  const plugins: CapacitorPlugins = {
    Camera: Camera as unknown as CameraPlugin,
    Geolocation: Geolocation as unknown as GeolocationPlugin,
    LocalNotifications: LocalNotifications as unknown as LocalNotificationsPlugin,
    Filesystem: {
      // Saved copies go to Documents; files on their way to the share sheet wait in the cache.
      writeFile: (opts) => Filesystem.writeFile({ ...opts, directory: opts.directory === "CACHE" ? Directory.Cache : Directory.Documents }),
    },
    Haptics: Haptics as unknown as HapticsPlugin,
    Share: Share as unknown as SharePlugin,
  };
  // getPlatform() is a plain function on the core object, not a plugin proxy, so nothing awaits a plugin.
  // ws:// to the local network is Android's own plugin (docs/28 §6); iOS connects to wss:// only for now.
  // Held in the helpers, never returned or awaited: an awaited plugin hangs (deep-links.ts).
  const localSockets = Capacitor.getPlatform() === "android" ? Capacitor.registerPlugin<LocalSocketPlugin>("PotyroLocalSocket") : undefined;
  // The phone's recognizer (docs/29): Android's own plugin; on iOS only once the iOS developer has
  // added PotyroSpeech (ios-templates/, docs/27), else the WebView's speech.
  const speechPlugin = Capacitor.isPluginAvailable("PotyroSpeech") ? Capacitor.registerPlugin<SpeechPlugin>("PotyroSpeech") : undefined;
  return new CapacitorCapabilities(plugins, {
    maxPendingNotifications: Capacitor.getPlatform() === "ios" ? IOS_PENDING_LIMIT : null,
    ...(localSockets ? { localSockets } : {}),
    ...(speechPlugin ? { speechPlugin } : {}),
  });
}
