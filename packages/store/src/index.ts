// @potyro/store — persistence seam.
export type { StoredFile } from "./types.js";
export { declareApp, parseDeclaration, FN_MARKER, type AppDeclaration } from "./app-declaration.js";
export { readAppPackage, packAppPackage, sourcePackage, isZip, AppPackageError, APP_PACKAGE_FORMAT, type AppPackage, type PackagedFile } from "./app-package.js";
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
export { fileSpace, fileInfo, digest, FileSpaceError, normalisePath, mimeOf, type FileSpace, type FileTarget } from "./file-space.js";
export type { Store, StoreSchema, StoreRules, Unsubscribe, Narrow, MigrationPlan, FieldEdit, ChatMessage } from "./types.js";
export { isSetField, setFieldsOf, foldSet, foldSetFields, setWrites } from "./set-field.js";
export { ROOM_THREAD, recordThread } from "./types.js";
export { MemoryStore } from "./memory-store.js";
export { LocalStore, QuotaError, type StorageLike } from "./local-store.js";
export { publishAppToAccount, readAccountApps, publishNameToAccount, readAccountName, removeAppFromAccount, type AccountApp } from "./account-apps.js";
export { readAccountChat, publishChatMessages, removeChatMessages, watchAccountChats, type AccountChat, type AccountChatMessage } from "./account-chats.js";
export { SqliteStore, type SqliteDbHandle } from "./sqlite-store.js";
export { JazzStore, type JazzStoreDeps } from "./jazz-store.js";
export { openWorkerSqliteHandle, workersAvailable } from "./sqlite-worker-client.js";
export { createJazzStore, openAccountNode, openAccountNodeInBrowser, warmDeviceDatabase, rememberAppSpace, peekAppSpace, openJazzStore, createSpaceInvite, joinSpace, removeSpaceMember, spaceMembers, myRole, publishName, publishAccountName, readProfileName, subscribeSpace, subscribeMemberProfiles, type CreateJazzStoreOpts, type JazzStoreHandle, type JazzKeyStore } from "./jazz-backend.js";
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
