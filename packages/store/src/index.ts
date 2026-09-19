// @karta/store — persistence seam.
export type { Store, StoreSchema, StoreRules, Unsubscribe, Narrow, MigrationPlan, FieldEdit, ChatMessage } from "./types.js";
export { isSetField, setFieldsOf, foldSet, foldSetFields, setWrites } from "./set-field.js";
export { ROOM_THREAD, recordThread } from "./types.js";
export { MemoryStore } from "./memory-store.js";
export { LocalStore, QuotaError, type StorageLike } from "./local-store.js";
export { publishAppToAccount, readAccountApps, publishNameToAccount, readAccountName, removeAppFromAccount, type AccountApp } from "./account-apps.js";
export { SqliteStore, type SqliteDbHandle } from "./sqlite-store.js";
export { JazzStore, type JazzStoreDeps } from "./jazz-store.js";
export { openWorkerSqliteHandle, workersAvailable } from "./sqlite-worker-client.js";
export { createJazzStore, openAccountNode, openAccountNodeInBrowser, warmDeviceDatabase, rememberAppSpace, openJazzStore, createSpaceInvite, joinSpace, removeSpaceMember, spaceMembers, myRole, publishName, publishAccountName, readProfileName, subscribeSpace, subscribeMemberProfiles, type CreateJazzStoreOpts, type JazzStoreHandle, type JazzKeyStore } from "./jazz-backend.js";
export { createJazzSqliteDriver, type SqliteDriverAsync } from "./jazz-sqlite-driver.js";
export {
  createSqliteStore,
  createMemorySqliteStore,
  importSqliteStore,
  initSqlite,
  openOpfsDb,
  type SqliteStoreFactoryResult,
} from "./sqlite-backend.js";
export { applyMigrationStep, migrationChain, type EntityRecords } from "./migrate.js";
export { copyStoreData, type CopyStoreResult } from "./copy-store.js";
export {
  packBundle,
  unpackBundle,
  rowsToCsv,
  type ExportManifest,
  type ExportMode,
  type BundleInputs,
  type UnpackedBundle,
} from "./export.js";
export { ulid } from "./ulid.js";
export { createPeerPair, type PeerPair } from "./peer-harness.js";
