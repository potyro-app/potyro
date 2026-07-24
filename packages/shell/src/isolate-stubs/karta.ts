// Isolate-only stub for `karta`. When bundling an app for the untrusted isolate, `defineApp`
// only needs to yield the app object (validation already happened at author time, and pulling
// Zod into QuickJS is unnecessary weight). `f` mirrors the real field builders.

export function defineApp(def: unknown): unknown {
  return def;
}

export const f = new Proxy(
  {},
  {
    get(_t, type: string) {
      return (...args: unknown[]) => {
        if (type === "relation") return { type: "relation", to: args[0], ...(args[1] as object) };
        if (type === "list") return { type: "list", of: args[0], ...(args[1] as object) };
        if (type === "enum") return { type: "enum", options: args[0], ...(args[1] as object) };
        return { type, ...(args[0] as object) };
      };
    },
  },
);
