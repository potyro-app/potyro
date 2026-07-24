// A tiny toast store: ctx.ui.toast (via the ui-bridge) pushes here; the App subscribes.
export interface Toast {
  id: number;
  msg: string;
}

export class Toaster {
  private toasts: Toast[] = [];
  private listeners = new Set<() => void>();
  private seq = 0;

  push = (msg: string): void => {
    const toast = { id: ++this.seq, msg };
    this.toasts = [...this.toasts, toast];
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
