// Who you are on this device (KA-16 · ADR 0001 D2 as amended, D2a).
//
// A person is a display name plus a **cojson account**. The original D2 specified an Ed25519
// keypair of our own; that predates adopting Jazz, and running a second identity alongside
// cojson's would mean two ids per person where only cojson's can prove anything — it signs every
// transaction, while an id carried as a field value is forgeable. `createdBy` has to be the
// provable one.
//
// ## No database, no node, no network
//
// The account id is derivable from the secret seed alone:
//
//     seed -> agentSecretFromSecretSeed -> accountHeaderForInitialAgentSecret -> idforHeader
//
// which is exactly how `PassphraseAuth.logIn` recognises you on a new device. So minting an
// identity needs *crypto only* — no SQLite file, no `LocalNode`, no storage. The account CoValue is
// materialised later, lazily, the first time an app actually syncs, and the ids agree by
// construction because both come from the same seed. (Pinned by `derives the same id cojson
// assigns`, which is the assumption this whole module rests on.)
//
// That is what keeps the promise in docs/01 literally true: a person who never turns on sync has an
// identity, and has still never loaded a CRDT engine, opened a database, or touched a network.
// After the first run even the crypto stays unloaded — `peekIdentity` answers from the cache.
//
// ## The id is for life
//
// It must never change once minted. Every `createdBy` ever stamped points at it, so a rotating id
// silently orphans authorship across a shared ledger — the same shape of failure `toggleAppSync`
// exists to prevent, and the reason identity is NOT derived from whichever app happened to sync
// first.

import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { currentVault, type SecretVault } from "./vault.js";

/** Where identity is remembered. `localStorage` in the browser; a Map in tests. */
export interface IdentityKeys {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove?(key: string): void;
  /**
   * Where the SECRET keys go — the seed and the agent secret (vault.ts, #57). Absent = kept with the
   * rest, which is what a test's plain map does and what a browser without a vault falls back to.
   */
  secrets?: SecretVault;
}

export interface Identity {
  /** The cojson account id. Stable for life — see the header. */
  id: string;
  /** Display name. Only ever seen by other people, so it is asked for late and freely renameable. */
  name: string;
}

/** The material an app's store needs to open the account this identity names. */
export interface IdentityAccount {
  id: string;
  secret: string;
}

const SEED = "karta:identity:seed";
const SECRET = "karta:identity:secret";
const ID = "karta:identity:id";
const NAME = "karta:identity:name";

/**
 * Where `packages/store` used to keep the account, before identity moved here.
 *
 * A device that synced anything before that move already HAS an account, and its spaces and records
 * are signed by it. Minting a fresh one would not merely lose the passphrase — it would make every
 * existing space unreadable, because they belong to the old account. So an existing account is
 * ADOPTED, never replaced.
 *
 * Adopted accounts have no seed (the old code let cojson generate a random agent secret), so
 * `recoveryPassphrase` refuses for them and says why. That is the honest outcome: the words for such
 * an account do not exist and cannot be derived after the fact.
 */
const LEGACY_ID = "karta:jazz:accountID";
const LEGACY_SECRET = "karta:jazz:accountSecret";
const LEGACY_SEED = "karta:jazz:accountSeed";

/**
 * How the identity on this device came to be: `minted` | `adopted` | `passphrase`.
 *
 * It exists to tell an identity this package INVENTED from one the user chose. A build shipped
 * between the move and the fix minted a fresh account on devices that already had one, so those
 * devices now hold an identity that owns none of their data. Reclaiming the real account is only
 * safe if a deliberate sign-in can be told apart from that automatic mint — otherwise linking a
 * device would be silently undone by leftover keys from before.
 */
const ORIGIN = "karta:identity:origin";

/**
 * The name a brand-new identity gets.
 *
 * Deliberately not a question at first run. Nothing in a solo app ever displays it, so asking would
 * be signup-shaped friction for no benefit; the shell asks at the first moment someone else can see
 * it (sharing or joining) and it is renameable forever after.
 */
export const DEFAULT_NAME = "Me";

const toHex = (b: Uint8Array): string => [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string): Uint8Array => new Uint8Array(s.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);

function browserKeys(): IdentityKeys {
  return {
    get: (k) => globalThis.localStorage?.getItem(k) ?? null,
    set: (k, v) => globalThis.localStorage?.setItem(k, v),
    remove: (k) => globalThis.localStorage?.removeItem(k),
    secrets: currentVault(),
  };
}

/** Every key that is a secret: whoever holds one can sign as this person. */
const SECRET_KEYS = [SEED, SECRET, LEGACY_SECRET, LEGACY_SEED] as const;

async function vaultOf(keys: IdentityKeys): Promise<SecretVault | null> {
  return keys.secrets && (await keys.secrets.available()) ? keys.secrets : null;
}

/**
 * Read a secret — from the vault, moving it there first if an older build left it in plain storage.
 *
 * The plain copy is removed only once the vault has been read back and AGREES. A move that failed
 * halfway must leave the secret where it was: the only thing worse than a secret in the clear is no
 * secret at all.
 */
async function getSecret(keys: IdentityKeys, key: string): Promise<string | null> {
  const vault = await vaultOf(keys);
  if (!vault) return keys.get(key);
  const sealed = await vault.get(key);
  if (sealed != null) {
    if (keys.get(key) != null) keys.remove?.(key); // a leftover plain copy from an interrupted move
    return sealed;
  }
  const plain = keys.get(key);
  if (plain == null) return null;
  try {
    await vault.set(key, plain);
    if ((await vault.get(key)) === plain) keys.remove?.(key);
  } catch {
    // Left in plain storage, still usable; the next read tries the move again.
  }
  return plain;
}

async function setSecret(keys: IdentityKeys, key: string, value: string): Promise<void> {
  const vault = await vaultOf(keys);
  if (!vault) return keys.set(key, value);
  await vault.set(key, value);
  keys.remove?.(key);
}

/**
 * Move every secret this device holds out of plain storage and into the vault.
 *
 * Called once at boot so the move does not wait for the first time an app syncs — a device that
 * never syncs again would otherwise keep its secret in the clear forever.
 */
export async function secureIdentitySecrets(keys: IdentityKeys = browserKeys()): Promise<void> {
  for (const key of SECRET_KEYS) await getSecret(keys, key);
}

/** What a synced app needs and this device no longer has. */
export class IdentityKeysMissingError extends Error {
  constructor() {
    super(
      "This device's sign-in keys are missing, so shared apps cannot open. If you saved your recovery words, enter them under You to link this device again.",
    );
    this.name = "IdentityKeysMissingError";
  }
}

/** cojson's crypto + the two internals that turn a seed into an account id, loaded on demand. */
async function loadCrypto(): Promise<{
  agentSecretFromSecretSeed(seed: Uint8Array): string;
  newRandomSecretSeed(): Uint8Array;
  idFor(secret: string): string;
}> {
  const [{ WasmCrypto }, { cojsonInternals }] = await Promise.all([
    import("cojson/crypto/WasmCrypto"),
    import("cojson"),
  ]);
  const crypto = (await WasmCrypto.create()) as unknown as {
    agentSecretFromSecretSeed(seed: Uint8Array): string;
    newRandomSecretSeed(): Uint8Array;
  };
  const internals = cojsonInternals as unknown as {
    idforHeader(header: unknown, crypto: unknown): string;
    accountHeaderForInitialAgentSecret(secret: unknown, crypto: unknown): unknown;
  };
  return {
    agentSecretFromSecretSeed: (seed) => crypto.agentSecretFromSecretSeed(seed),
    newRandomSecretSeed: () => crypto.newRandomSecretSeed(),
    idFor: (secret) =>
      internals.idforHeader(internals.accountHeaderForInitialAgentSecret(secret, crypto), crypto),
  };
}

/**
 * The identity already on this device, or `null` if there is none yet.
 *
 * Synchronous and cache-only **on purpose**: `ctx.me` is read on every evaluation pass, and it must
 * not be able to drag a wasm crypto module into a local-only app that never asked for one.
 */
export function peekIdentity(keys: IdentityKeys = browserKeys()): Identity | null {
  const id = keys.get(ID);
  return id ? { id, name: keys.get(NAME) ?? DEFAULT_NAME } : null;
}

/**
 * The identity on this device, minting one on first run.
 *
 * Costs a single wasm crypto load, once ever. Every later run answers from `peekIdentity`.
 */
export async function ensureIdentity(keys: IdentityKeys = browserKeys()): Promise<Identity> {
  const legacyId = keys.get(LEGACY_ID);
  const legacySecret = legacyId ? await getSecret(keys, LEGACY_SECRET) : null;
  const existing = peekIdentity(keys);

  if (existing) {
    // Reclaim, for devices caught by the build that minted over an existing account.
    //
    // Only ever overrides an identity this package minted by itself (`minted`, or absent from before
    // the marker existed). An `adopted` one already IS the legacy account, and a `passphrase` one was
    // chosen by the user — reverting that would silently unlink a device they had just linked.
    const origin = keys.get(ORIGIN);
    const automatic = origin === null || origin === "minted";
    if (automatic && legacyId && legacySecret && legacyId !== existing.id) {
      await setSecret(keys, SECRET, legacySecret);
      const legacySeed = await getSecret(keys, LEGACY_SEED);
      if (legacySeed) await setSecret(keys, SEED, legacySeed);
      keys.set(ID, legacyId);
      keys.set(ORIGIN, "adopted");
      return peekIdentity(keys)!;
    }
    return existing;
  }

  // Adopt the account the store minted before identity lived here. Doing this FIRST — before any
  // minting — is what keeps a device that already synced from waking up as a stranger to its own
  // data.
  if (legacyId && legacySecret) {
    await setSecret(keys, SECRET, legacySecret);
    keys.set(NAME, keys.get(NAME) ?? DEFAULT_NAME);
    // Only if the store had already started keeping one. Usually absent, hence no passphrase.
    const legacySeed = await getSecret(keys, LEGACY_SEED);
    if (legacySeed) await setSecret(keys, SEED, legacySeed);
    keys.set(ORIGIN, "adopted");
    keys.set(ID, legacyId);
    return peekIdentity(keys)!;
  }

  const crypto = await loadCrypto();
  const seed = crypto.newRandomSecretSeed();
  const secret = crypto.agentSecretFromSecretSeed(seed);

  // Order matters: the id is written LAST, because `peekIdentity` treats it as the marker that a
  // complete identity exists. Interrupted halfway, the next run mints cleanly instead of reporting
  // an identity whose seed is missing — which would be an account that can never be linked.
  await setSecret(keys, SEED, toHex(seed));
  await setSecret(keys, SECRET, secret);
  keys.set(NAME, DEFAULT_NAME);
  keys.set(ORIGIN, "minted");
  keys.set(ID, crypto.idFor(secret));

  return peekIdentity(keys)!;
}

/** Rename yourself. The id is untouched — a name is a label, not an identity. */
export function renameIdentity(name: string, keys: IdentityKeys = browserKeys()): Identity {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A name cannot be blank.");
  if (!keys.get(ID)) throw new Error("No identity on this device yet.");
  keys.set(NAME, trimmed);
  return peekIdentity(keys)!;
}

/**
 * The account material an app's store opens.
 *
 * This is what makes `packages/store` stop minting accounts of its own: one place is responsible
 * for the most security-sensitive value we hold, and the store is handed the result.
 */
export async function identityAccount(keys: IdentityKeys = browserKeys()): Promise<IdentityAccount> {
  await ensureIdentity(keys);
  const secret = await getSecret(keys, SECRET);
  if (!secret) throw new IdentityKeysMissingError();
  return { id: keys.get(ID)!, secret };
}

/**
 * The recovery passphrase for this device — BIP39 words over the secret seed (ADR D2a).
 *
 * Recoverable at any time *because the seed was kept at creation*. cojson's default account
 * creation uses `newRandomAgentSecret()`, which has no seed behind it and therefore no passphrase,
 * ever — and no migration can invent one for an existing key.
 */
export async function recoveryPassphrase(keys: IdentityKeys = browserKeys()): Promise<string> {
  await ensureIdentity(keys);
  const seed = await getSecret(keys, SEED);
  if (!seed) {
    throw new Error(
      "This device's identity was created without a recovery seed, so it cannot be linked to another device.",
    );
  }
  return entropyToMnemonic(fromHex(seed), wordlist);
}

/**
 * Adopt the identity these words describe — the second half of linking a device.
 *
 * Purely local: the words yield the seed, the seed the secret, and the secret the account id, with
 * no lookup anywhere. **Loading the account's data is a separate matter** — a device that has never
 * synced has no copy of the account CoValue and needs a peer to fetch it from, which is why linking
 * in practice rides the relay the user already syncs through.
 *
 * Replaces whatever identity was here. The caller is responsible for reopening any store, because
 * every space this device belonged to under the old identity is no longer ours to read.
 */
export async function signInWithPassphrase(
  passphrase: string,
  keys: IdentityKeys = browserKeys(),
): Promise<Identity> {
  let seed: Uint8Array;
  try {
    seed = mnemonicToEntropy(passphrase.trim().toLowerCase().replace(/\s+/g, " "), wordlist);
  } catch {
    // The words are the only thing standing between someone and their data, so the message says
    // what to check rather than "invalid input".
    throw new Error("Those words don't look right. Check for typos, and that all of them are there.");
  }

  const crypto = await loadCrypto();
  const secret = crypto.agentSecretFromSecretSeed(seed);
  const name = keys.get(NAME) ?? DEFAULT_NAME;

  await setSecret(keys, SEED, toHex(seed));
  await setSecret(keys, SECRET, secret);
  keys.set(NAME, name);
  // Deliberate: never reclaimed over by leftover legacy keys.
  keys.set(ORIGIN, "passphrase");
  keys.set(ID, crypto.idFor(secret));

  return peekIdentity(keys)!;
}
