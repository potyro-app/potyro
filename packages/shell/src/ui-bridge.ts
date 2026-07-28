// The shell's ctx.ui / navigation implementations (docs/07). Toasts route to a sink the App renders;
// `pick` routes to the Picker modal when a host is supplied (see picker.tsx). confirm/prompt still
// use the platform dialogs.

import type { NavBridge, UiBridge } from "@karta/host";
import type { PickerHost } from "./picker.js";

export function createUiBridge(onToast: (msg: string) => void, picker?: PickerHost): UiBridge {
  return {
    toast: (msg) => onToast(msg),
    confirm: async (msg) => globalThis.confirm(msg),
    prompt: async (msg, opts) => globalThis.prompt(msg, opts?.default ?? "") ?? null,
    pick: async (items, opts) => {
      if (picker) return picker.pick(items, opts);
      // Headless fallback (validate-app's throwaway runtime, tests): no UI, so nothing is chosen.
      return null;
    },
  };
}

export function createNavBridge(onNavigate: (pageId: string, params?: Record<string, string>) => void): NavBridge {
  return { navigate: onNavigate };
}
