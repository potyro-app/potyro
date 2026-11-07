// Isolate-only stub for React. Custom views never run untrusted (docs/05), so a bundled app's
// custom-view component is dead code inside the isolate; stubbing React keeps it out of the
// QuickJS bundle entirely.
//
// It exports EVERY public name React exports, each as a harmless stand-in. The list was once a
// handful of hooks, and the first app to import `useLayoutEffect` could not be added at all: the
// trial build failed with "No matching export" before anything ran (2026-11-07). An app may reach
// for any part of React in a view; the stub must never be the reason it does not bundle.
// `test/react-stub.test.ts` keeps this in step with the installed React.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (...args: any[]) => any;
const noop = (): void => {};
const same = <T,>(x: T): T => x;

// ---- elements ----
export function jsx(): null {
  return null;
}
export const jsxs = jsx;
export const jsxDEV = jsx;
export const createElement = jsx;
export const cloneElement = jsx;
export const createFactory = (): Fn => jsx;
export const isValidElement = (): boolean => false;
export const Fragment = "fragment";
export const StrictMode = "fragment";
export const Suspense = "fragment";
export const Profiler = "fragment";
export const Children = {
  map: (): never[] => [],
  forEach: noop,
  count: (): number => 0,
  only: same,
  toArray: (): never[] => [],
};
export class Component<P = unknown, S = unknown> {
  props: P;
  state: S = {} as S;
  constructor(props: P) {
    this.props = props;
  }
  setState(): void {}
  forceUpdate(): void {}
  render(): null {
    return null;
  }
}
export class PureComponent<P = unknown, S = unknown> extends Component<P, S> {}
export const memo = same;
export const forwardRef = same;
export const lazy = same;
export const createRef = <T,>(): { current: T | null } => ({ current: null });
export function createContext<T>(value: T): { Provider: string; Consumer: string; _currentValue: T } {
  return { Provider: "fragment", Consumer: "fragment", _currentValue: value };
}

// ---- hooks ----
export function useState<T>(initial: T): [T, () => void] {
  return [typeof initial === "function" ? (initial as () => T)() : initial, noop];
}
export function useReducer<S>(_reducer: Fn, initial: S, init?: (arg: S) => S): [S, () => void] {
  return [init ? init(initial) : initial, noop];
}
export function useEffect(): void {}
export function useLayoutEffect(): void {}
export function useInsertionEffect(): void {}
export function useImperativeHandle(): void {}
export function useDebugValue(): void {}
export function useMemo<T>(factory: () => T): T {
  return factory();
}
export function useRef<T>(initial: T): { current: T } {
  return { current: initial };
}
export function useCallback<T>(fn: T): T {
  return fn;
}
export function useContext<T>(ctx: { _currentValue?: T }): T | undefined {
  return ctx?._currentValue;
}
export const useId = (): string => "id";
export const useDeferredValue = same;
export const useTransition = (): [boolean, (fn: Fn) => void] => [false, (fn) => void fn()];
export const useSyncExternalStore = <T,>(_subscribe: Fn, get: () => T): T => get();
export const startTransition = (fn: Fn): void => void fn();
export const act = (fn: Fn): unknown => fn();
export const version = "stub";

export default {
  jsx,
  jsxs,
  jsxDEV,
  createElement,
  cloneElement,
  createFactory,
  isValidElement,
  Fragment,
  StrictMode,
  Suspense,
  Profiler,
  Children,
  Component,
  PureComponent,
  memo,
  forwardRef,
  lazy,
  createRef,
  createContext,
  useState,
  useReducer,
  useEffect,
  useLayoutEffect,
  useInsertionEffect,
  useImperativeHandle,
  useDebugValue,
  useMemo,
  useRef,
  useCallback,
  useContext,
  useId,
  useDeferredValue,
  useTransition,
  useSyncExternalStore,
  startTransition,
  act,
  version,
};
