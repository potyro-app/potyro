// @potyro/capabilities — native-feature seam.
export type { Capabilities, CameraCap, NotificationCap, GeoCap, FileCap, NetworkCap, HapticsCap, AiCap, AiCall, AiReply, AiConsentWords, PrivacyTopic, ShareCap, SharePayload } from "./types.js";
export { FakeCapabilities, FakeNotifications, FakeAi, type FakeOptions } from "./fake.js";
export { WebCapabilities, createWebCapabilities, pickFilesFromInput, webShare } from "./web.js";
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
  type SessionFaces,
} from "./live-camera.js";
export {
  faceFrom,
  facesFailureOf,
  scriptedFinder,
  sketchFace,
  sketchMatrix,
  projectFacePoint,
  isSoftwareRenderer,
  graphicsOf,
  CANONICAL,
  FACE_FOV_DEGREES,
  MESH,
  SHAPES,
  type FaceFinder,
  type FaceLoader,
  type FaceSketch,
  type FindOptions,
  type RawFace,
} from "./faces.js";
export { createFakeLiveCamera, type FakeLiveCamera, type FakeLiveCameraOptions } from "./fake-live-camera.js";
export {
  createWebSockets,
  sharedWebSockets,
  isLocalAddress,
  isLoopback,
  parseLocalAddress,
  SocketOpenError,
  type ConsentNote,
  type AddressAskWords,
  CONNECT_TIMEOUT_MS,
  HIDDEN_CLOSE_MS,
  HIDDEN_KEEP_MAX_MS,
  type PlatformOpenOptions,
  type SocketCap,
  type SocketTarget,
  type SocketOpenFailure,
  type PlatformSocket,
  type PlatformSocketEvents,
  type PlatformCloseWhy,
  type ConsentWords,
  type LocalOpener,
  type WebSocketsDeps,
} from "./sockets.js";
export { createFakeSockets, type FakeSockets, type FakeSocketsOptions, type FakeConnection, type FakeHostBehaviour, type FakeRoomPeer } from "./fake-sockets.js";
export { CONFORMANCE_CHECKS, type ConformanceCheck, type TargetExpectations } from "./conformance.js";
export {
  createWebSpeech,
  sharedWebSpeech,
  speechLanguage,
  joinPieces,
  pickEngine,
  mayAskLocal,
  browserService,
  recognitionCtor,
  SpeechError,
  SPEECH_MAX_MS,
  CLOUD_MAX_MS,
  type SpeechCap,
  type SpeechWhere,
  type SpeechEndWhy,
  type ListenOptions,
  type PlatformSpeechEvents,
  type PlatformListening,
  type Transcriber,
  type Recognition,
  type RecognitionCtor,
  type WebSpeechDeps,
  type RecorderDeps,
} from "./speech.js";
export { encodeWav, recordingToWav, WAV_RATE } from "./wav.js";
export { createFakeSpeech, type FakeSpeech, type FakeSpeechOptions, type FakeListening } from "./fake-speech.js";
