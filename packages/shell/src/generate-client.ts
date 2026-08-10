// The ONE client for the dev generator endpoint (see packages/shell/vite.config.ts).
//
// There were two hand-rolled copies — the Studio's and Edit mode's — and when the endpoint became
// job-based only one was updated. The other kept reading `.text` off a response that now carries
// `{ id }`, so every Edit-mode change died with "can't access property 'match', text is undefined".
// Both callers go through here now; the request shape lives in exactly one place.

const POLL_MS = 1_500;
const TIMEOUT_MS = 300_000;

/**
 * Can this build reach a model at all?
 *
 * `/__generate` is a **Vite dev-server middleware**, so it exists only while `pnpm dev` is running.
 * A deployed build has no such route — and every AI surface still offered itself, failed on the
 * fetch, and showed a stranger the words "Is `pnpm dev` still running?".
 *
 * So the Studio and the agent half of Edit mode are hidden unless a model is actually reachable.
 * `VITE_KARTA_GENERATOR` is the switch for a deployment that stands one up (a server route holding a
 * key, or an in-browser backend); until something does, a production build says nothing about
 * generating apps rather than offering a button that cannot work.
 *
 * Structural editing and History are NOT gated on this. Neither calls a model — reordering a field
 * and rolling back a version work perfectly well on a deployment with no generator, and removing
 * them would be a bigger loss than the one this is fixing.
 */
export function canGenerate(): boolean {
  return Boolean(import.meta.env?.DEV || import.meta.env?.VITE_KARTA_GENERATOR);
}

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
