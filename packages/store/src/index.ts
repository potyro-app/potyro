// @karta/store — persistence seam.
export type { Store, StoreSchema, Unsubscribe, Narrow, MigrationPlan, FieldEdit, ChatMessage } from "./types.js";
export { isSetField, setFieldsOf, foldSet, foldSetFields, setWrites } from "./set-field.js";
export { ROOM_THREAD, recordThread } from "./types.js";
export { MemoryStore } from "./memory-store.js";
export { LocalStore, type StorageLike } from "./local-store.js";
export { SqliteStore, type SqliteDbHandle } from "./sqlite-store.js";
export { JazzStore, type JazzStoreDeps } from "./jazz-store.js";
export { createJazzStore, openJazzStore, createSpaceInvite, joinSpace, spaceMembers, myRole, publishName, subscribeSpace, subscribeMemberProfiles, type CreateJazzStoreOpts, type JazzStoreHandle, type JazzKeyStore } from "./jazz-backend.js";
export { createJazzSqliteDriver, type SqliteDriverAsync } from "./jazz-sqlite-driver.js";
export {
  createSqliteStore,
  createMemorySqliteStore,
  importSqliteStore,
  initSqlite,
  openOpfsDb,
  type SqliteStoreFactoryResult,
} from "./sqlite-backend.js";
export { applyMigrationStep, type EntityRecords } from "./migrate.js";
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
