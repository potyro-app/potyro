// The shell's ctx.ui / navigation implementations (docs/07). Toasts route to a sink the App
// renders; confirm/prompt/pick use the platform dialogs for M1 (a designed modal can replace
// them later).

import type { NavBridge, UiBridge } from "@karta/host";

export function createUiBridge(onToast: (msg: string) => void): UiBridge {
  return {
    toast: (msg) => onToast(msg),
    confirm: async (msg) => globalThis.confirm(msg),
    prompt: async (msg, opts) => globalThis.prompt(msg, opts?.default ?? "") ?? null,
    pick: async (items, opts) => {
      // Minimal picker: index prompt. A real modal lands with the design pass.
      const label = opts?.label ?? ((t: unknown) => String(t));
      const list = items.map((t, i) => `${i}: ${label(t)}`).join("\n");
      const raw = globalThis.prompt(`Pick one (number):\n${list}`);
      if (raw == null) return null;
      const idx = Number(raw);
      return Number.isInteger(idx) && idx >= 0 && idx < items.length ? items[idx]! : null;
    },
  };
}

export function createNavBridge(onNavigate: (pageId: string, params?: Record<string, string>) => void): NavBridge {
  return { navigate: onNavigate };
}
