#!/usr/bin/env node
// `pnpm pack:app <app.tsx> [file …] [--seed seed.json] [--files <dir>] [-o out.zip]` — the repo's name
// for `potyro pack`, which lives in the authoring package (packages/schema/cli/pack.mjs) so that
// people writing apps outside this repo run the very same packer.
//
// Paths are the caller's. `pnpm pack:app` runs from the repo root and says where it was called from in
// INIT_CWD; a package script (`pnpm --filter x build`) runs in the package, while INIT_CWD names the
// root. So the current folder wins when the path is there, and INIT_CWD is the fallback.
import { pack, PackError } from "../packages/schema/cli/pack.mjs";

pack(process.argv.slice(2), { fallbackCwd: process.env.INIT_CWD ?? process.cwd() }).catch((e) => {
  console.error(`pack:app: ${e instanceof PackError ? e.message : (e?.stack ?? e)}`);
  process.exit(e instanceof PackError ? 2 : 1);
});
