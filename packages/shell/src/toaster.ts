// A tiny toast store: ctx.ui.toast (via the ui-bridge) pushes here; the App subscribes.
export interface Toast {
  id: number;
  msg: string;
}

/** Toasts on screen at once; an older one makes room. */
export const MAX_TOASTS = 4;

export class Toaster {
  private toasts: Toast[] = [];
  private listeners = new Set<() => void>();
  private seq = 0;

  push = (msg: string): void => {
    const toast = { id: ++this.seq, msg };
    // The newest few: an app that toasts in a loop gets a short stack, not one as long as its loop (#90).
    this.toasts = [...this.toasts.slice(-(MAX_TOASTS - 1)), toast];
    this.emit();
    setTimeout(() => this.dismiss(toast.id), 2600);
  };

  dismiss = (id: number): void => {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  };

  get = (): Toast[] => this.toasts;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}
