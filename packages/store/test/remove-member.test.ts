import { describe, expect, it } from "vitest";
import { removeSpaceMember, type JazzStoreHandle } from "../src/jazz-backend.js";

// Removing a person from a space (#58). The order is the security property: every outstanding invite
// is revoked BEFORE the member is removed, because removal rotates the read key and the rotation
// reveals the new key to everything that can still read — an unrevoked invite included, which would
// also let the removed person rejoin with their old link.

function fakeHandle(roles: Record<string, string>, mine = "admin") {
  const calls: string[] = [];
  const group = {
    getMemberKeys: () => Object.keys(roles),
    get: (k: string) => roles[k],
    set: (k: string, v: string) => {
      roles[k] = v;
      calls.push(`set ${k} ${v}`);
    },
    removeMember: (k: string) => {
      roles[k] = "revoked";
      calls.push(`remove ${k}`);
    },
    myRole: () => mine,
  };
  return { handle: { group, accountID: "co_zAna", node: {} } as unknown as JazzStoreHandle, calls, roles };
}

describe("removeSpaceMember", () => {
  it("revokes every open invite first, then removes the person (which rotates the key)", () => {
    const { handle, calls } = fakeHandle({ co_zAna: "admin", co_zBo: "writer", sealer_inv1: "writerInvite", sealer_inv2: "readerInvite" });
    expect(removeSpaceMember(handle, "co_zBo")).toEqual({ invitesRevoked: 2 });
    expect(calls).toEqual(["set sealer_inv1 revoked", "set sealer_inv2 revoked", "remove co_zBo"]);
  });

  it("refuses a non-admin, yourself, and someone who is not a member", () => {
    expect(() => removeSpaceMember(fakeHandle({ co_zAna: "writer", co_zBo: "writer" }, "writer").handle, "co_zBo")).toThrow(/Only the person who created/);
    expect(() => removeSpaceMember(fakeHandle({ co_zAna: "admin" }).handle, "co_zAna")).toThrow(/yourself/);
    expect(() => removeSpaceMember(fakeHandle({ co_zAna: "admin", co_zX: "revoked" }).handle, "co_zX")).toThrow(/not in this app/);
  });
});
