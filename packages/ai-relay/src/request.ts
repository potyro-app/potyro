// One AI request for an app (docs/23), as the shell sends it — to the free relay, or straight to
// OpenRouter on the person's own key — and as the relay reads it.
//
// Shared by both ends so they cannot disagree: the shell builds a payload, both paths turn it into
// the same OpenRouter body with `openRouterBody`, and the relay refuses anything `readAiPayload` does
// not accept. Browser-safe — no imports at all, and no Node globals.
//
// What travels: the host's instructions to the model, the parts the app's call named (its words and
// its pictures, already resized), the JSON Schema the answer must follow, a token cap, and a random
// device id for the allowance. Never a key, never a record the app did not pass.

export const AI_FORMAT = "potyro-ai/1";

/**
 * Google's Gemini 2.5 Flash Lite on OpenRouter: vision, structured outputs, $0.10 / $0.40 a million
 * tokens — about $0.0003 for a resized receipt. Reasoning is off by default, so the cost and the wait
 * are predictable. Why this one: docs/23 "Model".
 */
export const AI_MODEL = "google/gemini-2.5-flash-lite";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** `audio`: one recording to write down (voice input where the browser cannot, docs/29) — 16 kHz mono WAV as a data URL. */
export type AiPart = { type: "text"; text: string } | { type: "image"; data: string } | { type: "audio"; data: string };

export interface AiPayload {
  format: typeof AI_FORMAT;
  /** A random id kept on the device, for the allowance only. */
  device: string;
  system: string;
  parts: AiPart[];
  /** The JSON Schema the answer must follow; absent = words back. */
  json?: Record<string, unknown>;
  maxTokens: number;
}

/** The most a request may be. Over any of them it is refused, never cut. */
export const AI_LIMITS = {
  /** The whole body, checked before parsing. */
  bytes: 6 * 1024 * 1024,
  device: 100,
  system: 8_000,
  parts: 12,
  /** All text parts together. */
  text: 40_000,
  images: 4,
  /** One picture, as a data URL. A 1600 px JPEG is well under. */
  image: 3 * 1024 * 1024,
  /** The schema, as JSON. */
  json: 20_000,
  maxTokens: 4_000,
  /** Recordings in one request: one. */
  audios: 1,
  /**
   * One recording, as a data URL: a minute of 16 kHz mono 16-bit WAV is 1.92 MB, 2.56 MB in base64 —
   * the cloud engine's limit (docs/29). A longer one is refused, never cut.
   */
  audio: 2_700_000,
} as const;

const IMAGE_URL = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const AUDIO_URL = /^data:audio\/wav;base64,[A-Za-z0-9+/]+={0,2}$/;

export type ReadResult = { ok: true; payload: AiPayload } | { ok: false; error: string };

/** The payload, or why not. Accepts only the fields above; anything else is refused, not dropped. */
export function readAiPayload(v: unknown): ReadResult {
  const bad = (error: string): ReadResult => ({ ok: false, error });
  if (v == null || typeof v !== "object" || Array.isArray(v)) return bad("not an object");
  const o = v as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !["format", "device", "system", "parts", "json", "maxTokens"].includes(k));
  if (extra.length) return bad(`unknown field ${extra[0]}`);
  if (o.format !== AI_FORMAT) return bad("format");
  if (typeof o.device !== "string" || o.device.length < 8 || o.device.length > AI_LIMITS.device) return bad("device");
  if (typeof o.system !== "string" || o.system.length > AI_LIMITS.system) return bad("system");
  if (!Array.isArray(o.parts) || o.parts.length === 0 || o.parts.length > AI_LIMITS.parts) return bad("parts");
  let text = 0;
  let images = 0;
  let audios = 0;
  const parts: AiPart[] = [];
  for (const p of o.parts as unknown[]) {
    const part = p as Record<string, unknown> | null;
    if (part?.type === "text" && typeof part.text === "string" && Object.keys(part).length === 2) {
      text += part.text.length;
      parts.push({ type: "text", text: part.text });
    } else if (part?.type === "image" && typeof part.data === "string" && Object.keys(part).length === 2) {
      if (part.data.length > AI_LIMITS.image || !IMAGE_URL.test(part.data)) return bad("image");
      images++;
      parts.push({ type: "image", data: part.data });
    } else if (part?.type === "audio" && typeof part.data === "string" && Object.keys(part).length === 2) {
      if (part.data.length > AI_LIMITS.audio || !AUDIO_URL.test(part.data)) return bad("audio");
      audios++;
      parts.push({ type: "audio", data: part.data });
    } else return bad("part");
  }
  if (text > AI_LIMITS.text) return bad("text too long");
  if (images > AI_LIMITS.images) return bad("too many images");
  if (audios > AI_LIMITS.audios) return bad("too many recordings");
  if (audios && images) return bad("a recording goes alone");
  if (o.json !== undefined) {
    if (o.json === null || typeof o.json !== "object" || Array.isArray(o.json) || JSON.stringify(o.json).length > AI_LIMITS.json) return bad("json");
  }
  if (typeof o.maxTokens !== "number" || !Number.isInteger(o.maxTokens) || o.maxTokens < 1 || o.maxTokens > AI_LIMITS.maxTokens) return bad("maxTokens");
  return {
    ok: true,
    payload: { format: AI_FORMAT, device: o.device, system: o.system, parts, ...(o.json ? { json: o.json as Record<string, unknown> } : {}), maxTokens: o.maxTokens },
  };
}

/**
 * The OpenRouter chat-completions body for a payload. The model, the provider rules and the token cap
 * are decided HERE, not by whoever sent the payload: on the relay that is what keeps Potyro's key
 * doing one job.
 */
export function openRouterBody(p: AiPayload, model: string = AI_MODEL): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: p.system },
      { role: "user", content: p.parts.map(contentOf) },
    ],
    max_tokens: Math.min(p.maxTokens, AI_LIMITS.maxTokens),
    temperature: p.json ? 0 : 0.3,
    ...(p.json ? { response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: p.json } } } : {}),
    // Only providers that do not keep or train on what they are sent; with a schema, only those
    // that honour it.
    provider: { data_collection: "deny", ...(p.json ? { require_parameters: true } : {}) },
  };
}

/** One part as OpenRouter's chat content: a recording is `input_audio`, its base64 without the data-URL prefix. */
function contentOf(part: AiPart): Record<string, unknown> {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "image") return { type: "image_url", image_url: { url: part.data } };
  return { type: "input_audio", input_audio: { data: part.data.slice(part.data.indexOf(",") + 1), format: "wav" } };
}

export type UpstreamReply = { ok: true; text: string; cost?: number } | { ok: false; status: number; message: string };

/** What OpenRouter answered, as one of two shapes. A 200 that carries an error is an error. */
export function readOpenRouterReply(status: number, body: string): UpstreamReply {
  let json: unknown = null;
  try {
    // OpenRouter pads a slow answer with ": OPENROUTER PROCESSING" lines; they are not JSON.
    json = JSON.parse(body.split("\n").filter((l) => !l.startsWith(":")).join("\n"));
  } catch {
    // not JSON
  }
  const err = (json as { error?: { message?: string } } | null)?.error;
  if (status < 200 || status >= 300 || err) return { ok: false, status: status >= 200 && status < 300 ? 502 : status, message: err?.message ?? body.slice(0, 300) };
  const choice = (json as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0];
  const content = choice?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("") : "";
  if (!text.trim()) return { ok: false, status: 502, message: "the model answered with nothing" };
  const cost = (json as { usage?: { cost?: unknown } }).usage?.cost;
  return { ok: true, text, ...(typeof cost === "number" && Number.isFinite(cost) ? { cost } : {}) };
}
