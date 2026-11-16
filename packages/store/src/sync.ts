// @potyro/store/sync — the half of the store that syncs: the CRDT engine (cojson), a person's
// account, spaces, invites. Loaded with `import("@potyro/store/sync")`, never statically from what
// Home paints with: nobody needs it before an app that syncs is opened, and it is about a fifth of
// what the page would otherwise download before showing anything (#48).
//
// The barrel (`@potyro/store`) exports the same names, for the tests and the servers. In the shell,
// a dynamic import goes HERE: `import("@potyro/store")` is the whole barrel as one object, which
// keeps every export of it, the engine included, in the page's first script.
export { JazzStore, SPACE_BUDGET, type JazzStoreDeps } from "./jazz-store.js";
export {
  createJazzStore,
  openAccountNode,
  openAccountNodeInBrowser,
  warmDeviceDatabase,
  rememberAppSpace,
  peekAppSpace,
  openJazzStore,
  createSpaceInvite,
  joinSpace,
  removeSpaceMember,
  spaceMembers,
  myRole,
  publishName,
  publishAccountName,
  readProfileName,
  subscribeSpace,
  subscribeMemberProfiles,
  type CreateJazzStoreOpts,
  type JazzStoreHandle,
  type JazzKeyStore,
} from "./jazz-backend.js";
export { createJazzSqliteDriver, type SqliteDriverAsync } from "./jazz-sqlite-driver.js";
export { publishAppToAccount, readAccountApps, publishNameToAccount, readAccountName, removeAppFromAccount, type AccountApp } from "./account-apps.js";
export { readAccountChat, publishChatMessages, removeChatMessages, watchAccountChats, type AccountChat, type AccountChatMessage } from "./account-chats.js";
export { createPeerPair, createRelayedPair, type PeerPair } from "./peer-harness.js";
