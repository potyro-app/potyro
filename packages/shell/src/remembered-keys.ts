// "Remember on this device" for a model key (#455): off by default, and when on, the key is kept in
// the device's secret vault (@potyro/identity: the platform keystore on Android, a non-extractable AES
// key in this browser), as Ask's source keys are (ask-sources.ts) — never in localStorage. With no
// vault here the switch is not offered: a key that could only be kept in the clear is not kept.
//
// Which keys are remembered is the vault's own answer (a key is there or it is not), read once at
// start (`loadRemembered`) and then followed as the person switches. An OpenAI-compatible endpoint is
// remembered whole (address, key and model): its key is no use without the address it opens.
//
// The honest limit is the vault's (vault.ts): code on Potyro's own origin can still ask it to decrypt.
//
// ORDER. A remembered key is written again on every change to its field, and a vault write is not
// instant (the browser vault encrypts before it opens its transaction), so two writes, or a write and
// a Forget, could land in either order and leave an older key, or a forgotten one, in the vault. So
// the writes for each kind run one after another (`queued`), and only the latest asked for runs: each
// takes a number from `wanted`, and a write whose number is no longer the latest does nothing.

import { useSyncExternalStore } from "react";
import { currentVault, type SecretVault } from "@potyro/identity";

export type KeyKind = "openrouter" | "anthropic" | "endpoint";
export const KEY_KINDS: readonly KeyKind[] = ["openrouter", "anthropic", "endpoint"];

export const keyId = (kind: KeyKind): string => `potyro:model-key:${kind}`;

let vaultFor: () => SecretVault | undefined = currentVault;
let remembered: ReadonlySet<KeyKind> = new Set();
const listeners = new Set<() => void>();
function setRemembered(next: ReadonlySet<KeyKind>): void {
  remembered = next;
  for (const cb of listeners) cb();
}

async function usable(): Promise<SecretVault | null> {
  const vault = vaultFor();
  try {
    return vault && (await vault.available()) ? vault : null;
  } catch {
    return null;
  }
}

/** Can a key be remembered on this device at all? */
export async function canRemember(): Promise<boolean> {
  return (await usable()) !== null;
}

export const isRemembered = (kind: KeyKind): boolean => remembered.has(kind);

export function useRemembered(): ReadonlySet<KeyKind> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => remembered,
    () => remembered,
  );
}

/** Per kind: the number of the latest write asked for, and the end of the writes queued so far. */
const wanted = new Map<KeyKind, number>();
const tails = new Map<KeyKind, Promise<unknown>>();
/** The latest write's own outcome, for a write it replaced: that one's caller hears how the latest went. */
const latest = new Map<KeyKind, Promise<boolean>>();
const SKIPPED = Symbol("skipped");

function queued(kind: KeyKind, write: (isLatest: () => boolean) => Promise<boolean>): Promise<boolean> {
  const n = (wanted.get(kind) ?? 0) + 1;
  wanted.set(kind, n);
  const isLatest = (): boolean => wanted.get(kind) === n;
  const run = (tails.get(kind) ?? Promise.resolve()).then<boolean | typeof SKIPPED>(() => (isLatest() ? write(isLatest) : SKIPPED));
  tails.set(kind, run.catch(() => undefined));
  const result = run.then((r): boolean | Promise<boolean> => (r === SKIPPED ? (latest.get(kind) ?? false) : r));
  latest.set(kind, result);
  return result;
}

/** Keep it in the vault. False when there is no vault, or it refused: nothing was kept. */
export function rememberKey(kind: KeyKind, value: string): Promise<boolean> {
  return queued(kind, async (isLatest) => {
    const vault = await usable();
    if (!vault) return false;
    try {
      await vault.set(keyId(kind), value);
    } catch {
      return false;
    }
    // A Forget asked for while this was being written comes next and takes it out again: not remembered.
    if (isLatest() && !remembered.has(kind)) setRemembered(new Set([...remembered, kind]));
    return true;
  });
}

/** Take it out of the vault. Not remembered from now on, whatever writes are still out. */
export async function forgetKey(kind: KeyKind): Promise<void> {
  if (remembered.has(kind)) setRemembered(new Set([...remembered].filter((k) => k !== kind)));
  await queued(kind, async () => {
    const vault = await usable();
    try {
      await vault?.remove(keyId(kind));
    } catch {
      // The vault would not take it out: it is not offered again, and the next start finds it gone or not.
    }
    return false;
  });
}

/** What the vault holds, read at start. */
export async function loadRemembered(): Promise<Partial<Record<KeyKind, string>>> {
  const vault = await usable();
  if (!vault) return {};
  const found: Partial<Record<KeyKind, string>> = {};
  for (const kind of KEY_KINDS) {
    try {
      const v = await vault.get(keyId(kind));
      if (v) found[kind] = v;
    } catch {
      // unreadable: as if not there
    }
  }
  setRemembered(new Set(Object.keys(found) as KeyKind[]));
  return found;
}

/** Test seam: another vault, and nothing remembered. */
export function setVaultForTests(vault: (() => SecretVault | undefined) | null): void {
  vaultFor = vault ?? currentVault;
  wanted.clear();
  tails.clear();
  latest.clear();
  setRemembered(new Set());
}
