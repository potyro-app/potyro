// @potyro/store — persistence seam.
export type { StoredFile, EarlierCopy, SpaceUsage } from "./types.js";
export { declareApp, describeApp, declarationProblem, parseDeclaration, FN_MARKER, type AppDeclaration } from "./app-declaration.js";
export { readAppPackage, packAppPackage, sourcePackage, isZip, AppPackageError, APP_PACKAGE_FORMAT, parseCredit, parseLine, LINE_RE, CREDIT_DEPTH, type AppCredit, type AppPackage, type PackagedFile } from "./app-package.js";
export {
  MODULES_DIR,
  SRC_DIR,
  srcKey,
  LockError,
  isReservedPath,
  sha256Hex,
  integrityOf,
  moduleFileFor,
  lockEntryFor,
  matchesLock,
  libraryLabel,
  libraryHost,
  isPinned,
  importsOf,
  urlImportsOf,
  relativeImportsOf,
  parseLock,
  libraryLock,
  lockJson,
  type AppLock,
  type LockEntry,
} from "./app-lock.js";
export { carryCode, readCarriedCode, carriedModuleFiles, sameCode, type CarriedCode } from "./carried-code.js";
export { fileSpace, fileInfo, digest, FileSpaceError, SpaceFullError, normalisePath, mimeOf, KEEP_EARLIER, EARLIER_FOR_MS, type FileSpace, type FileTarget } from "./file-space.js";
export type { Store, StoreSchema, StoreRules, Unsubscribe, Narrow, MigrationPlan, FieldEdit, Removal, ChatMessage, RecordInvite } from "./types.js";
export { isSetField, setFieldsOf, foldSet, foldSetFields, setWrites } from "./set-field.js";
export { ROOM_THREAD, recordThread } from "./types.js";
export { MemoryStore } from "./memory-store.js";
export { LocalStore, QuotaError, type StorageLike } from "./local-store.js";
// The half that syncs (the CRDT engine, accounts, spaces, invites) is `@potyro/store/sync`, loaded
// with `import()` so it is not in the script a first visit waits for (#48, sync.ts). Its types stay
// here: a type costs nothing.
export type { AccountApp } from "./account-apps.js";
export type { AccountChat, AccountChatMessage } from "./account-chats.js";
export { SqliteStore, type SqliteDbHandle } from "./sqlite-store.js";
export type { JazzStoreDeps } from "./jazz-store.js";
export { deleteWorkerSqlite, isStorageElsewhere, isStorageStuck, isStorageWithheld, onStorageElsewhere, onStorageStuck, openWorkerSqliteHandle, StorageElsewhereError, StorageStuckError, takeOverStorageOnNextLoad, workersAvailable } from "./sqlite-worker-client.js";
export type { CreateJazzStoreOpts, JazzStoreHandle, JazzKeyStore } from "./jazz-backend.js";
export type { SqliteDriverAsync } from "./jazz-sqlite-driver.js";
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
  PEOPLE_THREAD,
  GUEST_PREFIX,
  GUEST_NAME_MAX,
  EMPTY_PEOPLE,
  isGuestId,
  newGuestId,
  cleanGuestName,
  foldPeople,
  finalPerson,
  openGuests,
  claimOf,
  readPeople,
  writePeople,
  subscribePeople,
  copyPeople,
  type PeopleOp,
  type PeopleOpInput,
  type PeopleState,
  type GuestEntry,
} from "./people-log.js";
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
// The two-device harness stays here for the tests and the generator's check that use it; it reaches
// the engine itself with `import()`.
export { createPeerPair, createRelayedPair, type PeerPair } from "./peer-harness.js";
