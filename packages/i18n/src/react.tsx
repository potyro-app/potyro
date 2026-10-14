// `useLingui` and `<Trans>` for the macros, without a provider.
//
// The macros are pointed here by `runtimeConfigModule` (lingui.config.ts): `<Trans>` in a component
// compiles to this `Trans`, and `const { t } = useLingui()` to this `useLingui`. Lingui's own
// versions throw outside an `I18nProvider`; the shell renders through more than one React root (the
// dialog host, the restore panel, observed renders) and its tests render one component at a time,
// and every one of those would need wrapping, forever. There is one instance per page anyway, so
// these read it directly and re-render when it changes language.

import { useSyncExternalStore, type ReactElement } from "react";
import type { I18nContext, TransProps } from "@lingui/react";
import { TransNoContext } from "@lingui/react/server";
import { i18n } from "./i18n.js";

function make(): I18nContext {
  return { i18n, _: i18n._.bind(i18n) };
}

// A new object on every change, so anything memoised on the context sees the language move.
let snapshot = make();
const listeners = new Set<() => void>();
i18n.on("change", () => {
  snapshot = make();
  for (const l of listeners) l();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const read = (): I18nContext => snapshot;

/** The active language's translator; the component re-renders when the language changes. */
export function useLingui(): I18nContext {
  return useSyncExternalStore(subscribe, read, read);
}

/** What `<Trans>` compiles to. */
export function Trans(props: TransProps): ReactElement | null {
  const ctx = useLingui();
  return <TransNoContext {...props} lingui={{ i18n: ctx.i18n }} />;
}

/** The active language tag, live. */
export function useLocale(): string {
  return useLingui().i18n.locale;
}
