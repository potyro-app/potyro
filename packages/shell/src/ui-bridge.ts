// The shell's ctx.ui / navigation implementations (docs/07). Toasts route to a sink the App renders;
// `pick` routes to the Picker modal and `confirm`/`prompt` to the Dialogs modal when hosts are
// supplied. Nothing here uses a platform dialog: those block the page, cannot be themed, announce the
// origin rather than the app, and become OS dialogs on the native target.

import type { NavBridge, UiBridge } from "@karta/host";
import type { PickerHost } from "./picker.js";
import type { DialogHost } from "./dialog.js";
import type { UiHost } from "./ui-host.js";

export function createUiBridge(onToast: (msg: string) => void, picker?: PickerHost, dialogs?: DialogHost, questions?: UiHost): UiBridge {
  return {
    toast: (msg) => onToast(msg),
    // Headless fallback (validate-app's throwaway runtime, tests): no UI, so nothing is confirmed.
    // `false`, never `true` — an unanswerable confirm must not authorise a deletion.
    confirm: async (msg, opts) => (dialogs ? dialogs.confirm(msg, opts) : false),
    prompt: async (msg, opts) => (dialogs ? dialogs.prompt(msg, opts) : null),
    pick: async (items, opts) => {
      if (picker) return picker.pick(items, opts);
      // Headless fallback (validate-app's throwaway runtime, tests): no UI, so nothing is chosen.
      return null;
    },
    // #112. Without a host (headless) these are left out, and ctx answers them as dismissed.
    ...(questions ? { sheet: questions.sheet, menu: questions.menu, form: questions.form, progress: questions.progress } : {}),
  };
}

export function createNavBridge(onNavigate: (pageId: string, params?: Record<string, string>) => void): NavBridge {
  return { navigate: onNavigate };
}
