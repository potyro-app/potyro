// @karta/identity — who you are on this device (KA-16 · ADR 0001 D2 amended, D2a).
export {
  peekIdentity,
  ensureIdentity,
  renameIdentity,
  identityAccount,
  recoveryPassphrase,
  signInWithPassphrase,
  DEFAULT_NAME,
  type Identity,
  type IdentityAccount,
  type IdentityKeys,
} from "./identity.js";
