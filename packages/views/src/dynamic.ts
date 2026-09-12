// `Dynamic<T>` options in views (#133): a literal renders as itself; a function of ctx (or, for an
// untrusted app, the sentinel where the function was) is resolved through the runtime — on both
// hosts — and resolved again whenever the runtime says something a ctx depends on changed (the
// selection, membership). A view never calls an app function itself; that is the host's job.

import type { KartaRuntime } from "@karta/runtime";
import { basePageId, resolveView } from "karta";
import { useEffect, useState } from "react";

function declared(runtime: KartaRuntime, pageRef: string, key: string, where: "view" | "page"): unknown {
  if (where === "view") return (resolveView(runtime.definition, pageRef) as unknown as Record<string, unknown>)[key];
  const page = runtime.definition.pages.find((p) => p.id === basePageId(pageRef)) as Record<string, unknown> | undefined;
  return page?.[key];
}

/**
 * A string option that may be a function of ctx. Returns the literal at once, the fallback until a
 * function resolves, and the resolved text after. Re-resolves on `runtime.core.onInvalidate`.
 */
export function useDynamicText(runtime: KartaRuntime, pageId: string, key: string, where: "view" | "page", fallback: string): string {
  const raw = declared(runtime, pageId, key, where);
  const literal = typeof raw === "string" ? raw : raw === undefined ? fallback : null;
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (literal !== null) return;
    let live = true;
    const resolve = (): void => {
      const call = where === "page" ? runtime.pageOption(pageId, key) : runtime.viewOption(pageId, key);
      void call.then(
        (v) => {
          if (live) setResolved(v == null ? fallback : String(v));
        },
        (e: unknown) => {
          console.warn(`[karta] could not resolve ${where} option ${pageId}.${key}:`, e);
          if (live) setResolved(fallback);
        },
      );
    };
    resolve();
    const stop = runtime.core.onInvalidate(resolve);
    return () => {
      live = false;
      stop();
    };
  }, [runtime, pageId, key, where, literal, fallback]);

  return literal ?? resolved ?? fallback;
}

/**
 * Every page's title, resolved. Literal titles are returned as they are; function titles resolve
 * through the runtime and follow the selection. What the tab bar and the page header read.
 */
export function usePageTitles(runtime: KartaRuntime): Record<string, string> {
  const pages = runtime.definition.pages;
  const initial = (): Record<string, string> =>
    Object.fromEntries(pages.map((p) => [p.id, typeof p.title === "string" ? p.title : p.id]));
  const [titles, setTitles] = useState<Record<string, string>>(initial);

  useEffect(() => {
    let live = true;
    const dynamic = pages.filter((p) => typeof p.title !== "string");
    if (!dynamic.length) {
      setTitles(initial());
      return;
    }
    const resolve = (): void => {
      void Promise.all(
        dynamic.map(async (p) => {
          try {
            const v = await runtime.pageOption(p.id, "title");
            return [p.id, v == null ? p.id : String(v)] as const;
          } catch {
            return [p.id, p.id] as const;
          }
        }),
      ).then((entries) => {
        if (live) setTitles({ ...initial(), ...Object.fromEntries(entries) });
      });
    };
    resolve();
    const stop = runtime.core.onInvalidate(resolve);
    return () => {
      live = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  return titles;
}
