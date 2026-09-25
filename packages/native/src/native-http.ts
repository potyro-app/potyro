// Ask's source requests over the app's own HTTP stack (#213), for the Android/iOS build.
//
// In a browser, a request to another origin is refused unless the API opts in (CORS), and most APIs
// never do: they expect a server to call them. Karta has no server in that path on purpose, because a
// server would hold the person's keys. The native app does not need one: `CapacitorHttp` goes through
// the platform's HTTP stack, where CORS does not exist.
//
// Shaped as the one call Ask's fetcher makes (`packages/shell/src/ask-sources.ts`), and it keeps that
// call's rules: GET only, a redirect is an error rather than a hop to wherever the server points, and
// a slow API times out. Nothing else in the app uses it; global `fetch` is not patched.

/** The slice of `CapacitorHttp` this uses. */
export interface HttpPlugin {
  request(options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    responseType: "text";
    disableRedirects: boolean;
    connectTimeout: number;
    readTimeout: number;
  }): Promise<{ status: number; headers: Record<string, string>; data: unknown; url: string }>;
}

export type SourceHttp = (url: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 20_000;

function aborted(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    const stop = (): void => reject(signal.reason instanceof Error ? signal.reason : new Error("The request was stopped."));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}

/** A `fetch`-shaped GET over the plugin. */
export function fetchOver(plugin: HttpPlugin): SourceHttp {
  return async (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET") throw new TypeError("Only GET requests are made for sources.");
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    // The plugin cannot be cancelled; a stop still ends the wait for it.
    const res = await Promise.race([
      plugin.request({ url, method, headers, responseType: "text", disableRedirects: true, connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS }),
      aborted(init.signal),
    ]);
    if (res.status >= 300 && res.status < 400) throw new TypeError(`The API answered with a redirect (${res.status}), which is refused.`);
    if (res.status < 200 || res.status > 599) throw new TypeError(`Unusable HTTP status ${res.status}.`);
    const body = typeof res.data === "string" ? res.data : res.data == null ? "" : JSON.stringify(res.data);
    return new Response(body, { status: res.status, headers: res.headers });
  };
}

/**
 * The native HTTP call when running inside the native shell, else `null` (the browser's `fetch` is
 * used). Boxed in an object, never returned bare: an awaited Capacitor plugin hangs forever on
 * Android (see deep-links.ts), and a function is one refactor away from being the plugin itself.
 */
export async function maybeCreateNativeSourceHttp(): Promise<{ http: SourceHttp } | null> {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const { CapacitorHttp } = await import("@capacitor/core");
  return { http: fetchOver(CapacitorHttp as unknown as HttpPlugin) };
}
