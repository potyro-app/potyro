// @potyro/identity — who you are on this device (KA-16 · ADR 0001 D2 amended, D2a).
export {
  peekIdentity,
  ensureIdentity,
  renameIdentity,
  identityAccount,
  recoveryPassphrase,
  signInWithPassphrase,
  portableIdentity,
  adoptPortableIdentity,
  secureIdentitySecrets,
  IdentityKeysMissingError,
  DEFAULT_NAME,
  type Identity,
  type IdentityAccount,
  type IdentityKeys,
  type PortableIdentity,
  type AdoptOutcome,
} from "./identity.js";
export { browserVault, currentVault, deferredVault, memoryVault, setSecretVault, type SecretVault } from "./vault.js";
