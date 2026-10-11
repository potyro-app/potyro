// App code that failed and was contained (#262).
//
// Some failures are deliberately not thrown: a computed that throws shows as empty instead of taking
// its whole page down (resolve.ts). That is right for the person using the app, and it used to make
// those failures invisible to everything but the console — where they are said once per session, so
// a second run of the same broken code is silent. Whoever needs to know every time (the Studio,
// checking a candidate before it ships) listens here. Nothing about the containment changes.

export interface AppFailure {
  /** The app's definition id. */
  app: string;
  /** What failed, in the app's own names: `computed meal.kcal`. */
  what: string;
  message: string;
}

type Listener = (failure: AppFailure) => void;

const listeners = new Set<Listener>();

/** Hear every contained failure until the returned function is called. */
export function onAppFailure(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportAppFailure(failure: AppFailure): void {
  for (const listener of listeners) {
    try {
      listener(failure);
    } catch {
      // a listener's own bug must not turn a contained failure back into a thrown one
    }
  }
}
