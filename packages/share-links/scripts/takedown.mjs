#!/usr/bin/env node
// Take a demo link down, as the operator (docs/16, "Taking a link down"): for a notice about illegal
// content, or anything else the terms say may be removed. The link then answers 410 "This link was
// taken down" — its page, its package and its picture — and the reason is kept beside it, on the
// server only.
//
// Two ways, the same result:
//
//   # over HTTPS, from anywhere, with the operator token the service was started with — read without
//   # echoing it, so it is in neither the screen nor the shell's history
//   read -rs SHARE_ADMIN_TOKEN && export SHARE_ADMIN_TOKEN
//   node scripts/takedown.mjs <id or link> --reason "…" [--site https://potyro.app]
//
//   # on the server, straight into the shares folder (no token; e.g. inside the service's container)
//   node --experimental-strip-types scripts/takedown.mjs <id or link> --reason "…" --dir /data
//
// A whole link (`https://potyro.app/s/<id>#k=…`) may be given: only the id is used, and the key after
// `#` is never sent anywhere. The token is read from the environment, never from the command line,
// so it is not left in the shell's history or the process list, and it is never printed.

import { pathToFileURL } from "node:url";

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const USAGE = `Usage:
  read -rs SHARE_ADMIN_TOKEN && export SHARE_ADMIN_TOKEN
  node scripts/takedown.mjs <id or link> --reason "why" [--site https://potyro.app]
  node --experimental-strip-types scripts/takedown.mjs <id or link> --reason "why" --dir <shares folder>`;

/** The share id in what was given: an id, or a link to one (its fragment ignored). */
export function shareIdOf(text) {
  const raw = String(text ?? "").split("#")[0].trim();
  if (ID_RE.test(raw)) return raw;
  const m = /\/s\/([A-Za-z0-9_-]{22})(?:[/?]|$)/.exec(raw);
  return m ? m[1] : null;
}

function parse(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reason" || a === "--site" || a === "--dir") out[a.slice(2)] = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else out.positional.push(a);
  }
  return out;
}

/**
 * The site to send the token to: https only, so it never crosses the network in clear — except to
 * this machine itself (a service run here, or reached through a tunnel).
 */
export function siteBaseOf(site) {
  let url;
  try {
    url = new URL(String(site));
  } catch {
    throw new Error(`--site is not an address: ${site}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`--site must start with https:// (the token would be sent in clear to ${url.origin})`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

async function overHttp(id, reason, site, token) {
  const base = siteBaseOf(site);
  const res = await fetch(`${base}/share-api/admin/shares/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body.already ? `Already taken down: ${id}.` : `Taken down: ${id}. The link now answers 410.`;
  throw new Error(`${base} answered ${res.status}${body.error ? `: ${body.error}` : ""}`);
}

async function onDisk(id, reason, dir) {
  let diskShareStore;
  try {
    ({ diskShareStore } = await import("../src/disk.ts"));
  } catch {
    throw new Error("Writing to the shares folder needs Node 22 with --experimental-strip-types: node --experimental-strip-types scripts/takedown.mjs …");
  }
  const store = diskShareStore(dir);
  if (await store.takenDown(id)) return `Already taken down: ${id}.`;
  if (!(await store.get(id))) throw new Error(`No link ${id} in ${dir}: it was never made here, or whoever made it removed it.`);
  await store.takeDown(id, { at: new Date().toISOString(), reason });
  return `Taken down: ${id}. The link now answers 410.`;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parse(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const id = shareIdOf(args.positional[0]);
  if (!id || args.positional.length !== 1) {
    console.error(`Give one link or link id.\n${USAGE}`);
    return 2;
  }
  const reason = String(args.reason ?? "").trim();
  if (!reason) {
    console.error(`Say why with --reason (the notice it answers, or the rule it broke): it is kept with the takedown.\n${USAGE}`);
    return 2;
  }
  try {
    if (args.dir) {
      console.log(await onDisk(id, reason, args.dir));
      return 0;
    }
    const token = env.SHARE_ADMIN_TOKEN;
    if (!token) {
      console.error(`SHARE_ADMIN_TOKEN is not set. Set it to the service's operator token, or run on the server with --dir.\n${USAGE}`);
      return 2;
    }
    console.log(await overHttp(id, reason, args.site ?? env.POTYRO_PUBLIC_ORIGIN ?? "https://potyro.app", token));
    return 0;
  } catch (e) {
    console.error(`Not taken down: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((code) => process.exit(code));
