// The identity's secrets in the platform keystore (#57).
//
// On Android `capacitor-secure-storage-plugin` keeps each value in the app's private preferences,
// encrypted with a key held by the Android Keystore — hardware-backed where the device has it, and
// never readable by the app's own JavaScript. (iOS: the Keychain.) The browser build never loads this:
// the composition root asks for it only when running inside the native shell.
//
// Shaped as `@potyro/identity`'s `SecretVault` structurally, so this package does not depend on it.

export interface NativeSecretVault {
  available(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

interface SecureStoragePlugin {
  get(o: { key: string }): Promise<{ value: string }>;
  set(o: { key: string; value: string }): Promise<{ value: boolean }>;
  remove(o: { key: string }): Promise<{ value: boolean }>;
  keys(): Promise<{ value: string[] }>;
}

/** Build a vault over the plugin. Split out so it can be tested without a device. */
export function vaultOver(plugin: SecureStoragePlugin): NativeSecretVault {
  return {
    available: async () => {
      try {
        await plugin.keys();
        return true;
      } catch {
        return false; // plugin not registered in this build: plain storage, as before
      }
    },
    async get(key) {
      // The plugin REJECTS for a key it does not hold; that is "nothing stored", not a failure.
      const held = await plugin.keys().then((r) => r.value, () => [] as string[]);
      if (!held.includes(key)) return null;
      try {
        return (await plugin.get({ key })).value;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await plugin.set({ key, value });
    },
    async remove(key) {
      await plugin.remove({ key }).catch(() => {});
    },
  };
}

/** The keystore vault when running inside the native shell, else `null`. */
export async function maybeCreateNativeVault(): Promise<NativeSecretVault | null> {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const { SecureStoragePlugin } = await import("capacitor-secure-storage-plugin");
  return vaultOver(SecureStoragePlugin as unknown as SecureStoragePlugin);
}
