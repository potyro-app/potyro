// @potyro/capabilities — native-feature seam.
export type { Capabilities, CameraCap, NotificationCap, GeoCap, FileCap, NetworkCap, HapticsCap, AiCap, AiCall, AiReply, AiConsentWords } from "./types.js";
export { FakeCapabilities, FakeNotifications, FakeAi, type FakeOptions } from "./fake.js";
export { WebCapabilities, createWebCapabilities, pickFilesFromInput } from "./web.js";
export {
  createLiveCamera,
  sharedLiveCamera,
  liveConstraints,
  liveCameraError,
  failureOf,
  faceOptions,
  LIVE_MIN,
  LIVE_MAX,
  type LiveCameraCap,
  type LiveCameraDeps,
} from "./live-camera.js";
export {
  faceFrom,
  facesFailureOf,
  scriptedFinder,
  sketchFace,
  MESH,
  SHAPES,
  type FaceFinder,
  type FaceLoader,
  type FaceSketch,
  type FindOptions,
  type RawFace,
} from "./faces.js";
export { createFakeLiveCamera, type FakeLiveCamera, type FakeLiveCameraOptions } from "./fake-live-camera.js";
export { CONFORMANCE_CHECKS, type ConformanceCheck, type TargetExpectations } from "./conformance.js";
