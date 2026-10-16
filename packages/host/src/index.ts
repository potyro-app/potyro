// @potyro/host — loading, execution & trust.
export type {
  Host,
  LoadedApp,
  Provenance,
  AppSource,
  BindingRef,
  UiBridge,
  NavBridge,
  MakeCtxBase,
  ShownUiItem,
  ShownShare,
} from "./types.js";
export {
  formatLocaleFor,
  formatMessage,
  hostPure,
  loadMessageFormat,
  makeFormat,
  translate,
  FORMAT_LIMITS,
  PURE_OPS,
  PURE_OK,
  PURE_ERROR,
  type WordsContext,
} from "./format.js";
export { createHost, type CreateHostOptions } from "./create-host.js";
export { DirectLoadedApp } from "./direct-host.js";
export { buildCtx } from "./make-ctx.js";
export { GuestBook, guestBookOf, type GuestWho } from "./guests.js";
export { TIMER_LIMITS, checkTimer, plainTimer, timerHandle, type TimerBridge, type TimerData, type TimerVerb } from "./timers.js";
export { mediateCaps, type AiContext } from "./mediate.js";
export { makeAi, checkShape, fitShape, jsonSchemaFor, parseJsonReply, numberIn, languageName, AiError, AI_LIMITS, type AiDeps, type AiErrorCode, type Fit } from "./ai.js";
export { resolveRecord, type ResolveDeps } from "./resolve.js";
export {
  makeLiveNetwork,
  closeAppSockets,
  retireAppSockets,
  openSocketsOf,
  permittedHosts,
  socketHostAllowed,
  roomsAllowed,
  englishSocketConsent,
  SocketError,
  SOCKET_LIMITS,
  HostSocket,
  HostRoom,
  type LiveNetwork,
  type LiveNetworkArgs,
} from "./sockets.js";
export { makeSpeech, englishSpeechConsent, leavesDevice, HostSpeechSession, SpeechError, SPEECH_LIMITS, type MakeSpeechArgs } from "./speech.js";
export { SpeechBridge, type BoxSpeechEvent, type BoxSpeechInfo } from "./speech-bridge.js";
export { onAppFailure, reportAppFailure, activeFailureListeners, type AppFailure } from "./failures.js";
