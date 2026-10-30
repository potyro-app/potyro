// "Test connection" for an OpenAI-compatible endpoint (#121): one GET of `{base}/models`, before the
// person spends a request on a create that would fail for the same reason. Every failure comes back
// as words that say what to change — a base URL, a key, the server's CORS — never a status code alone.

import { plural, t } from "@lingui/core/macro";
import type { EndpointSetting } from "./engines.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type EndpointCheck =
  | { ok: true; text: string; models: string[] }
  | { ok: false; text: string };

/** Long enough for a server on a slow link; short enough that a wrong address does not hang the button. */
const CHECK_TIMEOUT_MS = 15_000;

/** The model ids a `/models` reply lists: `{ data: [{ id }] }` in the OpenAI shape. */
function modelIds(body: unknown): string[] | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  return data.map((m) => (m as { id?: unknown })?.id).filter((id): id is string => typeof id === "string");
}

export async function checkEndpoint(setting: EndpointSetting, fetchImpl: FetchLike = (u, i) => globalThis.fetch(u, i)): Promise<EndpointCheck> {
  const base = setting.baseUrl.trim().replace(/\/+$/, "");
  if (!base) return { ok: false, text: t`Give the server’s address first.` };
  let url: URL;
  try {
    url = new URL(`${base}/models`);
  } catch {
    return { ok: false, text: t`That is not a web address. It looks like http://localhost:11434/v1.` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, text: t`The address has to start with http:// or https://.` };
  const key = setting.key.trim();
  let res: Response;
  try {
    res = await fetchImpl(url.href, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      ...(typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) } : {}),
    });
  } catch {
    // The browser does not say which: no server there, a page that is not allowed to ask it, or a
    // plain http address an https page may not reach. All three are named, since any may be it.
    return {
      ok: false,
      text: t`No answer from ${base}. Check the server is running and the address is right. A server on your own machine must also allow requests from this page (for Ollama, set OLLAMA_ORIGINS).`,
    };
  }
  const status = res.status;
  if (status === 401 || status === 403) return { ok: false, text: t`The server refused the key (${status}). Check the key.` };
  if (status === 404) return { ok: false, text: t`Nothing at ${base}/models. Check the address: it usually ends in /v1.` };
  if (!res.ok) return { ok: false, text: t`The server answered with an error (${status}).` };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const models = modelIds(body);
  if (!models) return { ok: false, text: t`The server answered, but not with a list of models. Check the address: it usually ends in /v1.` };
  const model = setting.model.trim();
  if (model && models.length && !models.includes(model)) {
    return { ok: true, models, text: t`Connected, but the server does not list ${model}. Check the model name.` };
  }
  return { ok: true, models, text: plural(models.length, { one: "Connected. The server lists # model.", other: "Connected. The server lists # models." }) };
}
