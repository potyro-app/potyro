// @vitest-environment happy-dom
//
// Accepting a share link when you ALREADY have an app of that id.
//
// Reported from a real session: someone opened apps.vaz.io, used Split (seeded on every device
// under the id `split`), added their own expenses, and was then sent a share link for the owner's
// Split. Joining overwrote their app record in place and flipped `sync` on its own — the one thing
// `setUserAppSync` says must never be done alone, because the records they had entered stay in the
// local database the app no longer opens. The chat worked, so it read as "sync is broken" rather
// than "you are looking at a different app".
//
// What is pinned here: your own app is never overwritten by someone else's link, the same link
// opened twice does not breed copies, and an app that arrived from a space is marked so the
// first-run seeder never writes example rows into somebody else's data.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const joinedNamespaces: string[] = [];
let spaceOnDevice: Record<string, { group: string; root: string } | null> = {};

// The store's pure helpers stay real (user-apps.ts reads the lock with them, #266); only the parts
// that reach a relay are faked.
vi.mock("@potyro/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@potyro/store")>()),
  createSpaceInvite: async () => ({ group: "g", root: "r", secret: "s" }),
  joinSpace: async (namespace: string) => {
    joinedNamespaces.push(namespace);
    return { store: {} };
  },
  openJazzStore: async () => ({}),
  peekAppSpace: (namespace: string) => spaceOnDevice[namespace] ?? null,
}));

vi.mock("../src/open-store.js", () => ({ syncRelayUrl: () => "wss://relay.example", linkedDevice: () => false }));
vi.mock("@potyro/identity", () => ({
  identityAccount: async () => ({ id: "acct" }),
  peekIdentity: () => ({ name: "Ada" }),
}));
vi.mock("../src/app-sync.js", () => ({ readPublishedApp: async () => ({ name: "Split", source: "// the owner's split\n" }) }));
vi.mock("../src/sync-consent.js", () => ({ rememberSyncConsent: () => {}, syncConsented: () => true }));
vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-diagnoses.js", () => ({ clearDiagnoses: async () => {} }));
vi.mock("../src/app-cases.js", () => ({ clearCases: async () => {} }));

const { acceptInvite } = await import("../src/share-sync.js");
const { saveUserApp, listUserApps, getUserApp } = await import("../src/user-apps.js");

const NOW = "2026-09-20T12:00:00.000Z";
const INVITE = { appId: "split", name: "Split", group: "g-owner", root: "r-owner", secret: "sec" };

beforeEach(() => {
  localStorage.clear();
  joinedNamespaces.length = 0;
  spaceOnDevice = {};
});
afterEach(() => localStorage.clear());

describe("accepting a share link for an app you already have", () => {
  it("leaves your own app alone and adds theirs beside it", async () => {
    // Hers: the seeded example, with her own expenses in its local database.
    await saveUserApp({ id: "split", name: "Split", source: "// the example\n", trusted: true }, NOW);

    const id = await acceptInvite(INVITE);

    expect(id).not.toBe("split");
    // Her app: untouched. Same source, still her own, still local-only — her records are still what
    // it opens.
    const mine = getUserApp("split")!;
    expect(mine.source).toBe("// the example\n");
    expect(mine.trusted).toBe(true);
    expect(mine.sync).toBeFalsy();
    // Theirs: a second app, named so the launcher is not two identical "Split"s.
    const theirs = getUserApp(id)!;
    expect(theirs.name).toBe("Split (shared)");
    expect(theirs.source).toBe("// the owner's split\n");
    expect(theirs.sync).toBe(true);
    expect(theirs.trusted).toBe(false); // someone else's code still runs in the isolate
    expect(listUserApps()).toHaveLength(2);
  });

  it("joins the space under the id the app will actually open", async () => {
    // The space is remembered per namespace, so joining under one id and saving under another is
    // how a guest ends up pointed at an empty space with the shared data stranded beside it.
    await saveUserApp({ id: "split", name: "Split", source: "// the example\n", trusted: true }, NOW);

    const id = await acceptInvite(INVITE);

    expect(joinedNamespaces).toEqual([`user:${id}`]);
  });

  it("marks it as joined, so the first-run seeder never writes into someone else's space", async () => {
    // The actual cause of the reported bug: `seedSplit` ran against the just-joined space. A space
    // that has not replicated yet looks exactly like an empty one, so a rival "Flat" group was
    // written into the owner's app — and Split shows only the selected group's expenses.
    const id = await acceptInvite(INVITE);
    expect(getUserApp(id)?.joined).toBe(true);
  });

  it("uses the shared id when there is nothing in the way", async () => {
    const id = await acceptInvite(INVITE);
    expect(id).toBe("split");
    expect(getUserApp("split")?.name).toBe("Split");
  });

  it("does not breed a copy when the same link is opened twice", async () => {
    const first = await acceptInvite(INVITE);
    // Joining remembered where that app's space is; opening the link again finds the same one.
    spaceOnDevice[`user:${first}`] = { group: INVITE.group, root: INVITE.root };

    const second = await acceptInvite(INVITE);

    expect(second).toBe(first);
    expect(listUserApps()).toHaveLength(1);
  });

  it("still separates two DIFFERENT spaces that share an id", async () => {
    // Two people can each share an app called Split. The second must not land on the first.
    const first = await acceptInvite(INVITE);
    spaceOnDevice[`user:${first}`] = { group: INVITE.group, root: INVITE.root };

    const second = await acceptInvite({ ...INVITE, group: "g-other", root: "r-other" });

    expect(second).not.toBe(first);
    expect(listUserApps()).toHaveLength(2);
  });
});
