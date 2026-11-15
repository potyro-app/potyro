// The memory one untrusted app's engine lives in, with a ceiling the engine itself cannot pass.
//
// QuickJS's own limit (`runtime.setMemoryLimit`) is not a total in this build: quickjs-emscripten
// 0.31 is compiled without `malloc_usable_size` (its memory dump says so), so the runtime never adds
// up what it has been given, and the limit refuses only one allocation larger than itself. A box
// that keeps many buffers under it grew its WebAssembly memory to the build's own maximum, 2 GB —
// and WebAssembly memory is never handed back while its instance lives.
//
// What does hold is the memory's `maximum`: every byte the engine has — objects, strings, array
// buffers, its own stack — is inside one `WebAssembly.Memory`, and a `grow` past the maximum is
// refused by the browser, whatever the code inside does. The variant's loader takes a memory of
// ours (`wasmMemory`), so each box is built on one made here: one app, one module, one memory.

import type { QuickJSAsyncContextLike } from "./isolate-host.js";

const PAGE = 65536;
/** What the engine's module asks for to start with (its build's INITIAL_MEMORY). */
const START_BYTES = 16 * 1024 * 1024;
/**
 * How many times the engine's glue asks for one piece of memory, each smaller than the last (20%,
 * 10% and 5% ahead of its need: `emscripten_resize_heap` in quickjs-emscripten 0.31's module). Only
 * for knowing a refusal the app's code then hid by carrying on; the ceiling does not depend on it.
 */
const ATTEMPTS = 3;

/** One box's memory, and whether the engine was refused more of it. */
export interface BoxMemory {
  readonly memory: WebAssembly.Memory;
  /** The most it may ever be, in bytes. */
  readonly limit: number;
  /** What it is now, in bytes. It only grows. */
  bytes(): number;
  /**
   * True once the engine asked for memory past the limit and got none. The engine's allocator asks
   * for more than it needs first and settles for less (`ATTEMPTS` times), so one refusal means
   * nothing: it is refused when the last answer was a refusal, and stays refused once every attempt
   * of one request was.
   */
  refused(): boolean;
  /** True when an engine was really built on this memory (it wrote its own data there). */
  used(): boolean;
}

export function boxMemory(limitBytes: number): BoxMemory {
  const pages = Math.floor(limitBytes / PAGE);
  if (!(pages >= START_BYTES / PAGE)) throw new Error(`a shared app's memory limit is at least ${START_BYTES / (1024 * 1024)} MB`);
  const memory = new WebAssembly.Memory({ initial: START_BYTES / PAGE, maximum: pages });
  // Refusals in a row, and whether a whole request was ever refused.
  let streak = 0;
  let denied = false;
  const grow = memory.grow.bind(memory);
  // Only to know that it happened. The ceiling is the memory's own: growing it from inside, by any
  // route, is refused the same.
  memory.grow = (delta: number): number => {
    try {
      const before = grow(delta);
      streak = 0;
      return before;
    } catch (e) {
      if (++streak >= ATTEMPTS) denied = true;
      throw e;
    }
  };
  return {
    memory,
    limit: pages * PAGE,
    bytes: () => memory.buffer.byteLength,
    refused: () => denied || streak > 0,
    used: () => {
      // The module's data sits at the bottom of its memory; one that was never used is all zeroes.
      const words = new Uint32Array(memory.buffer, 0, PAGE / 4);
      for (let i = 0; i < words.length; i++) if (words[i] !== 0) return true;
      return false;
    },
  };
}

/** What of `quickjs-emscripten` this needs (structural: no hard type dependency). */
export interface QuickJSEngine {
  RELEASE_ASYNC: { importModuleLoader: () => Promise<unknown> };
  newQuickJSAsyncWASMModule(variant: unknown): Promise<{ newContext(): unknown; getWasmMemory?(): WebAssembly.Memory }>;
}

type ModuleLoader = (options?: Record<string, unknown>) => Promise<unknown>;

/** A module loader out of whatever the import gave (an ES default, or a CommonJS one wrapped twice). */
function loaderOf(v: unknown): ModuleLoader {
  let it = v as { default?: unknown } | ModuleLoader;
  for (let i = 0; i < 2 && typeof it !== "function" && it && "default" in it; i++) it = it.default as typeof it;
  if (typeof it !== "function") throw new Error("quickjs: the engine's module loader was not found");
  return it;
}

/**
 * `newContext` for `createIsolateLoader`: a fresh engine — its own WebAssembly module — built on the
 * memory it is handed, so that memory's maximum is the most the box can ever hold.
 */
export function boundedContexts(engine: QuickJSEngine): (memory: WebAssembly.Memory) => Promise<QuickJSAsyncContextLike> {
  return async (memory) => {
    const variant = {
      ...engine.RELEASE_ASYNC,
      importModuleLoader: async (): Promise<ModuleLoader> => {
        const load = loaderOf(await engine.RELEASE_ASYNC.importModuleLoader());
        return (options) => load({ ...options, wasmMemory: memory });
      },
    };
    const module = await engine.newQuickJSAsyncWASMModule(variant);
    if (module.getWasmMemory && module.getWasmMemory() !== memory) throw new Error("quickjs: the engine did not take the memory it was given");
    return module.newContext() as QuickJSAsyncContextLike;
  };
}
