// The ONE client for the dev generator endpoint (see packages/shell/vite.config.ts).
//
// There were two hand-rolled copies — the Studio's and Edit mode's — and when the endpoint became
// job-based only one was updated. The other kept reading `.text` off a response that now carries
// `{ id }`, so every Edit-mode change died with "can't access property 'match', text is undefined".
// Both callers go through here now; the request shape lives in exactly one place.

const POLL_MS = 1_500;
const TIMEOUT_MS = 300_000;

export interface GenerateOptions {
  /** The contract. Sent separately so the server passes it via --system-prompt-file. */
  system: string;
  prompt: string;
  /** Progress callback — a multi-minute wait with no feedback reads as a hang. */
  onProgress?: (seconds: number) => void;
}

/** Start a generation and poll until it finishes. Resolves with the model's raw text. */
export async function generateViaCli({ system, prompt, onProgress }: GenerateOptions): Promise<string> {
  let start: Response;
  try {
    start = await fetch("/__generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system, prompt }),
    });
  } catch (e) {
    throw new Error(
      `couldn't reach the dev server's generator. Is \`pnpm dev\` still running? (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (!start.ok) {
    throw new Error(((await start.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${start.status}`);
  }
  const { id } = (await start.json()) as { id?: string };
  if (!id) throw new Error("generator did not return a job id");

  // Polling rather than one long-held request: a page reload (HMR, a config restart, a stray
  // refresh) aborts an in-flight fetch and looks like a network failure while the job was fine.
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`timed out after ${TIMEOUT_MS / 1000}s — try a shorter description`);
    await new Promise((r) => setTimeout(r, POLL_MS));
    let body: { status?: string; text?: string; error?: string; elapsedMs?: number };
    try {
      body = (await (await fetch(`/__generate?id=${encodeURIComponent(id)}`)).json()) as typeof body;
    } catch {
      continue; // a dropped poll is harmless; the job keeps running server-side
    }
    if (body.status === "running") {
      onProgress?.(Math.round((body.elapsedMs ?? 0) / 1000));
      continue;
    }
    if (body.status === "done") return body.text ?? "";
    throw new Error(body.error ?? "generation failed");
  }
}
