// Lets app code navigate.
//
// `ctx.navigate(page, params)` is part of the documented host surface and apps use it — the workout
// app's `startWorkout` creates a session and then navigates to the runner. But the bridge was built
// in the boot path as `createNavBridge(() => {})`: an empty function. So the action ran, the record
// was created, and nothing moved. From the outside that is indistinguishable from a dead button, and
// it silently piled up records nobody ever saw.
//
// The knot is ordering: the bridge has to exist before `ctx` is built, and the thing that can
// actually change pages is state inside `<App>`, which mounts later. So the host is a mutable slot —
// the same shape as `Toaster` and `PickerHost` — that App binds itself into on mount.

export type NavigateFn = (pageId: string, param?: Record<string, string>) => void;

export class NavHost {
  private target: NavigateFn | null = null;

  /** App calls this on mount; the returned function unbinds it again. */
  bind(fn: NavigateFn): () => void {
    this.target = fn;
    return () => {
      if (this.target === fn) this.target = null;
    };
  }

  navigate(pageId: string, param?: Record<string, string>): void {
    if (!this.target) {
      // Before mount, or after unmount. Say so rather than dropping it silently — a swallowed
      // navigation is exactly the failure this class exists to fix.
      console.warn(`[potyro] ctx.navigate("${pageId}") had nowhere to go — no view is mounted.`);
      return;
    }
    this.target(pageId, param);
  }
}
