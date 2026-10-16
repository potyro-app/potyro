// The shell's ctx.ui / navigation implementations (docs/07). Toasts route to a sink the App renders;
// `pick` routes to the Picker modal and `confirm`/`prompt` to the Dialogs modal when hosts are
// supplied. Nothing here uses a platform dialog: those block the page, cannot be themed, announce the
// origin rather than the app, and become OS dialogs on the native target.

import type { NavBridge, ShownShare, UiBridge } from "@potyro/host";
import type { PickerHost } from "./picker.js";
import type { DialogHost } from "./dialog.js";
import type { UiHost } from "./ui-host.js";

/** Makes the link `ctx.ui.share({ app })` asks for (docs/24 §11), for the app this bridge belongs to. */
export type AppLinkMaker = (target: NonNullable<ShownShare["app"]>) => Promise<string>;

/**
 * What the share dialog is handed. A link to an app's page is made by `makeLink` while the dialog is
 * already up; where no link can be made for this app (the Studio's preview, a headless runtime), the
 * words go alone — and with no words, there is nothing to send.
 */
export function shareRequest(opts: ShownShare, makeLink?: AppLinkMaker): { text?: string; url?: string; title?: string; files?: File[]; makeLink?: () => Promise<string> } | null {
  const { app, ...rest } = opts;
  if (app && makeLink) return { ...rest, makeLink: () => makeLink(app) };
  return rest.text || rest.url || rest.files?.length ? rest : null;
}

export function createUiBridge(onToast: (msg: string) => void, picker?: PickerHost, dialogs?: DialogHost, questions?: UiHost, makeLink?: AppLinkMaker): UiBridge {
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
    // Words, a link or files to send on, through the share dialog; headless, nothing is sent.
    ...(dialogs
      ? {
          share: async (opts: ShownShare) => {
            const request = shareRequest(opts, makeLink);
            return request ? dialogs.send(request) : false;
          },
        }
      : {}),
    // #112. Without a host (headless) these are left out, and ctx answers them as dismissed.
    ...(questions ? { sheet: questions.sheet, menu: questions.menu, form: questions.form, progress: questions.progress } : {}),
  };
}

export function createNavBridge(onNavigate: (pageId: string, params?: Record<string, string>) => void): NavBridge {
  return { navigate: onNavigate };
}
