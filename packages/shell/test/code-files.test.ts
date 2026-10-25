import { describe, expect, it } from "vitest";
import { checkNewName, codeTree, foldersOf } from "../src/code-files.js";

describe("the app's code as a tree", () => {
  it("folders from the paths, folders first, then files, by name; a folder made here may be empty", () => {
    const tree = codeTree(["words.ts", "lib/colors.ts", "lib/deep/x.ts", "card.ts"], ["drafts"]);
    expect(tree.map((n) => `${n.kind}:${n.path}`)).toEqual(["folder:drafts", "folder:lib", "file:card.ts", "file:words.ts"]);
    const lib = tree.find((n) => n.path === "lib")!;
    expect(lib.kind === "folder" && lib.children.map((n) => `${n.kind}:${n.path}`)).toEqual(["folder:lib/deep", "file:lib/colors.ts"]);
    const drafts = tree.find((n) => n.path === "drafts")!;
    expect(drafts.kind === "folder" && drafts.children).toEqual([]);
  });

  it("every folder a file sits in, at every depth", () => {
    expect(foldersOf(["a/b/c.ts", "a/d.ts", "e.ts"]).sort()).toEqual(["a", "a/b"]);
  });

  it("a new name: in its folder, code files only, no climbing out, nothing taken", () => {
    const taken = new Set(["card.ts", "lib", "lib/colors.ts"]);
    expect(checkNewName("shapes.ts", "lib", "file", taken)).toEqual({ ok: true, path: "lib/shapes.ts" });
    expect(checkNewName("util/math.ts", "", "file", taken)).toEqual({ ok: true, path: "util/math.ts" });
    expect(checkNewName("drafts", "", "folder", taken)).toEqual({ ok: true, path: "drafts" });
    expect(checkNewName("colors.ts", "lib", "file", taken)).toEqual({ ok: false, problem: "taken" });
    expect(checkNewName("notes.md", "", "file", taken)).toEqual({ ok: false, problem: "extension" });
    expect(checkNewName("x.ts", "", "folder", taken)).toEqual({ ok: false, problem: "extension" });
    expect(checkNewName("../x.ts", "", "file", taken)).toEqual({ ok: false, problem: "characters" });
    expect(checkNewName("my file.ts", "", "file", taken)).toEqual({ ok: false, problem: "characters" });
    expect(checkNewName("  ", "", "file", taken)).toEqual({ ok: false, problem: "empty" });
  });
});
