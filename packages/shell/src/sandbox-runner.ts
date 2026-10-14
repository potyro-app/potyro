// Which sealed box a shared app's logic runs in (#272, docs/22).
//
// The browser realm — a Worker inside an opaque-origin sandboxed iframe — is the default wherever the
// page can build one. QuickJS-WASM stays as the fallback until the owner removes it (docs/22 §8 phase
// 4), and is chosen:
//   - for a whole build or dev server: `VITE_POTYRO_SANDBOX=quickjs` at build time
//     (`VITE_POTYRO_SANDBOX=quickjs pnpm --filter @potyro/shell build:web`), or the dev server's
//     `sandbox-quickjs` mode (`pnpm dev:sandbox:quickjs`);
//   - on one device: `localStorage["potyro:sandbox"] = "quickjs"` (and `"realm"` to go back);
//   - by itself where no realm can be built (no DOM or no Worker: tests in Node, a very old WebView).
// Both are sealed: the choice is which engine, never whether the app gets ambient authority.

export type SandboxRunner = "realm" | "quickjs";

export const SANDBOX_FLAG = "potyro:sandbox";

/** Whether this page can build a realm: an iframe with `srcdoc`, Workers and MessageChannels. */
export function realmAvailable(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof Worker === "function" &&
    typeof MessageChannel === "function" &&
    typeof HTMLIFrameElement === "function" &&
    "srcdoc" in HTMLIFrameElement.prototype
  );
}

function asked(): string | undefined {
  try {
    const local = globalThis.localStorage?.getItem(SANDBOX_FLAG);
    if (local) return local;
  } catch {
    // storage blocked: the build's choice stands
  }
  if (import.meta.env?.MODE === "sandbox-quickjs") return "quickjs";
  return (import.meta.env?.VITE_POTYRO_SANDBOX as string | undefined)?.trim() || undefined;
}

let realmFailed = false;

/**
 * The realm could not start on this browser (`RealmStartError`: no frame, no Worker). For the rest of
 * the session shared apps run in QuickJS — still sealed — and the missing-feature card says what that
 * box lacks. An app's own failure never lands here.
 */
export function markRealmUnavailable(): void {
  realmFailed = true;
}

export function sandboxRunner(): SandboxRunner {
  if (asked() === "quickjs" || realmFailed) return "quickjs";
  return realmAvailable() ? "realm" : "quickjs";
}
