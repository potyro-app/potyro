// One text, one edit at a time (docs/04 "Writing together").
//
// Where no store merges, `ctx.text(...).edit` is a read, a splice and a write — and two of them in
// flight for the same field interleave: both read the old text, and the second write puts the
// first keystroke back. The letters were on the screen; the store had lost them. So edits to one
// field wait for each other, per store, whichever ctx they come through.
import type { Store } from "@potyro/store";

const chains = new WeakMap<Store, Map<string, Promise<unknown>>>();

/** Run `work` after every earlier edit to the same field of the same record on this store has landed. */
export function afterEarlierEdits<T>(store: Store, entity: string, id: string, field: string, work: () => Promise<T>): Promise<T> {
  let perStore = chains.get(store);
  if (!perStore) {
    perStore = new Map();
    chains.set(store, perStore);
  }
  const key = `${entity}\u0000${id}\u0000${field}`;
  const earlier = perStore.get(key) ?? Promise.resolve();
  const mine = earlier.then(work, work);
  const settled = mine.then(
    () => undefined,
    () => undefined,
  );
  perStore.set(key, settled);
  void settled.then(() => {
    if (perStore!.get(key) === settled) perStore!.delete(key);
  });
  return mine;
}
