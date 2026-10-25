#!/usr/bin/env node
// `potyro` — the command that comes with the authoring package. One command for now: `pack`.
import { readFileSync } from "node:fs";
import { pack, PackError, USAGE } from "../cli/pack.mjs";

const HELP = `potyro — tools for writing Potyro apps

  potyro pack [app.ts] [file …] [--seed seed.json] [--files <dir>] [-o out.zip]
      Make the .potyro-app.zip that Add an app installs. Without a source it packs the one
      *.app.ts or *.app.tsx in this folder.

  potyro --version
`;

const [command, ...rest] = process.argv.slice(2);
if (!command || command === "help" || command === "--help" || command === "-h") {
  process.stdout.write(HELP);
} else if (command === "--version" || command === "-v") {
  console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
} else if (command === "pack") {
  pack(rest, { fallbackCwd: process.env.INIT_CWD ?? process.cwd() }).catch((e) => {
    console.error(`potyro pack: ${e instanceof PackError ? e.message : (e?.stack ?? e)}`);
    process.exit(e instanceof PackError ? 2 : 1);
  });
} else {
  console.error(`potyro: no command "${command}"\n${USAGE}`);
  process.exit(2);
}
