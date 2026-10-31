// The build's id, stamped into public/sw.js as it is emitted (#123, `precacheShell` in
// packages/shell/vite.config.ts). A changed sw.js is what makes the browser install a new worker on
// a release, with a cache of its own; sw.js's header says what that worker then does with the old one.

/** The line in public/sw.js that the build replaces. */
export const SW_BUILD_LINE = 'const BUILD = "__POTYRO_BUILD__";';

/** public/sw.js with the build's id in place of the placeholder. Throws if the line is gone. */
export function stampServiceWorker(source: string, build: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(build)) throw new Error(`not a build id: ${build}`);
  if (!source.includes(SW_BUILD_LINE)) throw new Error(`public/sw.js has no \`${SW_BUILD_LINE}\` line for the build to stamp`);
  return source.replace(SW_BUILD_LINE, `const BUILD = ${JSON.stringify(build)};`);
}
