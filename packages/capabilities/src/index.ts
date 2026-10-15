// @potyro/capabilities — native-feature seam.
export type { Capabilities, CameraCap, NotificationCap, GeoCap, FileCap, NetworkCap, HapticsCap, AiCap, AiCall, AiReply, AiConsentWords } from "./types.js";
export { FakeCapabilities, FakeNotifications, FakeAi, type FakeOptions } from "./fake.js";
export { WebCapabilities, createWebCapabilities, pickFilesFromInput } from "./web.js";
export { CONFORMANCE_CHECKS, type ConformanceCheck, type TargetExpectations } from "./conformance.js";
