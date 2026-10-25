#!/usr/bin/env node
// `npm create potyro <folder>`: see ../index.mjs.
import { create, slugOf } from "../index.mjs";

const args = process.argv.slice(2);
const t = args.indexOf("--title");
const title = t >= 0 ? args.splice(t, 2)[1] : undefined;
const [dir] = args;
if (!dir || dir.startsWith("-")) {
  console.error("usage: npm create potyro <folder> [-- --title \"Reading list\"]");
  process.exit(2);
}
try {
  create(dir, { title });
} catch (e) {
  console.error(`create-potyro: ${e.message}`);
  process.exit(1);
}
const name = slugOf(dir);
console.log(`
A Potyro app is in ${dir}/. Next:

  cd ${dir}
  npm install
  npm run build      → dist/${name}.potyro-app.zip

Then in Potyro: Add an app → From this device, and choose that file.
The app is ${name}.app.ts.
`);
