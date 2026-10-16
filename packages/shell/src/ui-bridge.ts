// The shell's ctx.ui / navigation implementations (docs/07). Toasts route to a sink the App renders;
// `pick` routes to the Picker modal and `confirm`/`prompt` to the Dialogs modal when hosts are
// supplied. Nothing here uses a platform dialog: those block the page, cannot be themed, announce the
// origin rather than the app, and become OS dialogs on the native target.

import type { NavBridge, UiBridge } from "@potyro/host";
import type { PickerHost } from "./picker.js";
import type { DialogHost } from "./dialog.js";
import type { UiHost } from "./ui-host.js";

/**
 * What only an OPEN app gets: the screen held on for it, and its countdowns (docs/04). Both are the
 * shell's for one app — they need to know whose they are, and let go when it is left.
 */
export type AppUiExtras = Pick<UiBridge, "keepAwake" | "timers">;

export function createUiBridge(onToast: (msg: string) => void, picker?: PickerHost, dialogs?: DialogHost, questions?: UiHost, extras?: AppUiExtras): UiBridge {
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
    // Words or a link to send on, through the share dialog; headless, nothing is sent.
    ...(dialogs ? { share: (opts: { text?: string; url?: string; title?: string }) => dialogs.send(opts) } : {}),
    // #112. Without a host (headless) these are left out, and ctx answers them as dismissed.
    ...(questions ? { sheet: questions.sheet, menu: questions.menu, form: questions.form, progress: questions.progress } : {}),
    // Headless (validation, tests), left out: ctx holds nothing and keeps no timer.
    ...(extras?.keepAwake ? { keepAwake: extras.keepAwake } : {}),
    ...(extras?.timers ? { timers: extras.timers } : {}),
  };
}

export function createNavBridge(onNavigate: (pageId: string, params?: Record<string, string>) => void): NavBridge {
  return { navigate: onNavigate };
}
