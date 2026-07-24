// Isolate-only stub for React. Custom views never run untrusted (docs/05), so a bundled app's
// custom-view component is dead code inside the isolate; stubbing React keeps it out of the
// QuickJS bundle entirely.
export function jsx(): null {
  return null;
}
export const jsxs = jsx;
export const Fragment = "fragment";
const noop = (): void => {};
export function useState<T>(initial: T): [T, () => void] {
  return [typeof initial === "function" ? (initial as () => T)() : initial, noop];
}
export function useEffect(): void {}
export function useMemo<T>(factory: () => T): T {
  return factory();
}
export function useRef<T>(initial: T): { current: T } {
  return { current: initial };
}
export function useCallback<T>(fn: T): T {
  return fn;
}
export default { jsx, jsxs, Fragment, useState, useEffect, useMemo, useRef, useCallback, createElement: jsx };
