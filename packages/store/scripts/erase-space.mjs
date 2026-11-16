#!/usr/bin/env node
// Erase one shared space, or one account, from the sync relay's database (docs/16, "Erasing a space
// from the relay"; issue #119). The relay is `jazz-run sync --db sync.db`: cojson's SQLite storage,
// whose schema this script reads (cojson/dist/storage/sqlite/sqliteMigrations.js, 0.20.19):
//
//   coValues        rowID, id, header      — the header is plain JSON: its type and who owns it
//   sessions        rowID, coValue, sessionID, lastIdx, lastSignature, bytesSinceLastSignature
//   transactions    ses, idx, tx           — the edits; a space's content is encrypted to its members
//   signatureAfter  ses, idx, signature
//   unsynced_covalues, deletedCoValues     — bookkeeping by CoValue id
//
// A space is a cojson Group (its header's ruleset is `group`), and everything in it — the root, the
// records, the chat, every file's bytes — is a CoValue whose header names that group as its owner
// (`ownedByGroup`). Erasing a space removes the group and every CoValue it owns, with all their
// sessions, edits and signatures, then VACUUMs so the bytes leave the file. Nothing else is touched.
//
//   node scripts/erase-space.mjs --db /var/lib/potyro/sync.db --space co_z… [--dry-run] [--json] [--no-vacuum]
//   node scripts/erase-space.mjs --db /var/lib/potyro/sync.db --account co_z… [--dry-run] [--json] [--no-vacuum]
//
// `--account` erases what one account alone holds: every space it created that nobody else is in, and
// — once no space left on the relay names it — the account and its profile. A space it created that
// others are in is LISTED, not erased: erasing it takes it from every member (do that with --space,
// once they agree). Its edits inside other people's spaces are never touched: they are part of those
// spaces, and removing them would break them for everyone else.
//
// `--sizes` erases nothing: it lists the spaces that hold the most on the relay, by the bytes of their
// edits (records, chat, every file's bytes — history included, since the relay keeps it). The relay
// has no quota per space (docs/16, "What the gate cannot do"); this is how an operator sees which
// space outgrew the 200 MB the app holds its files to, before deciding what to do about it. It only
// reads, so it may run while the relay does, or on a backup's copy.
//
//   node scripts/erase-space.mjs --db /var/lib/potyro/sync.db --sizes [--top 20] [--json]
//
// What this cannot do, and the docs say so: a device that still holds the space sends it back the
// next time it connects (sync is two-way, and the relay cannot tell a returning copy from a new one),
// and backups of sync.db still hold it. So: the person removes the app from their devices (every
// member, for a shared space) first, the relay is STOPPED while this runs (it refuses otherwise), and
// the backups age out on their own schedule.
//
// Needs Node 22.13 or later (node:sqlite) and nothing else: it runs in the relay's own container.

const ID_RE = /^co_z[1-9A-HJ-NP-Za-km-z]{8,64}$/;
const BATCH = 400;
const USAGE = `Usage:
  node scripts/erase-space.mjs --db <sync.db> --space <co_z…> [--dry-run] [--json] [--no-vacuum]
  node scripts/erase-space.mjs --db <sync.db> --account <co_z…> [--dry-run] [--json] [--no-vacuum]
  node scripts/erase-space.mjs --db <sync.db> --sizes [--top 20] [--json]`;

class Refusal extends Error {
  /** @param {string} message @param {number} code */
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

/** @param {string[]} argv */
function parse(argv) {
  /** @type {{ db?: string, space?: string, account?: string, dryRun: boolean, json: boolean, vacuum: boolean, help: boolean, rest: string[] }} */
  const out = { dryRun: false, json: false, vacuum: true, help: false, sizes: false, top: 20, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") out.db = argv[++i];
    else if (a === "--space") out.space = argv[++i];
    else if (a === "--account") out.account = argv[++i];
    else if (a === "--sizes") out.sizes = true;
    else if (a === "--top") out.top = Number(argv[++i]);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--no-vacuum") out.vacuum = false;
    else if (a === "--help" || a === "-h") out.help = true;
    else out.rest.push(a);
  }
  return out;
}

/** The header as JSON, or null. */
function headerOf(row) {
  try {
    return JSON.parse(row.header);
  } catch {
    return null;
  }
}

/** One CoValue's row and header, or null. */
function coValue(db, id) {
  const row = db.prepare("SELECT rowID, id, header FROM coValues WHERE id = ?").get(id);
  return row ? { rowID: Number(row.rowID), id: row.id, header: headerOf(row) } : null;
}

/** Every CoValue a group owns. The LIKE narrows; the parsed header decides. */
function ownedBy(db, groupId) {
  return db
    .prepare("SELECT rowID, id, header FROM coValues WHERE header LIKE ?")
    .all(`%"group":"${groupId}"%`)
    .map((row) => ({ rowID: Number(row.rowID), id: row.id, header: headerOf(row) }))
    .filter((c) => c.header?.ruleset?.type === "ownedByGroup" && c.header.ruleset.group === groupId);
}

/**
 * A group's settings, from its plaintext ("trusting") edits, latest per key: who is in it and in what
 * role, and the groups it is linked to. Group edits are never encrypted (docs/16, KA-33).
 */
function groupState(db, rowID) {
  const rows = db.prepare("SELECT t.tx FROM transactions t JOIN sessions s ON s.rowID = t.ses WHERE s.coValue = ?").all(rowID);
  const edits = [];
  for (const { tx } of rows) {
    try {
      const t = JSON.parse(tx);
      if (t.privacy !== "trusting") continue;
      const changes = typeof t.changes === "string" ? JSON.parse(t.changes) : t.changes;
      for (const c of Array.isArray(changes) ? changes : []) if (c && c.op === "set") edits.push({ at: Number(t.madeAt) || 0, key: String(c.key), value: c.value });
    } catch {
      // An edit that is not JSON tells nothing about members; the rest still does.
    }
  }
  edits.sort((a, b) => a.at - b.at);
  const latest = new Map();
  for (const e of edits) latest.set(e.key, e.value);
  return latest;
}

/** The accounts in a group besides `creator` (revoked ones are out), and any group it is linked to. */
function othersIn(db, group, creator) {
  const state = groupState(db, group.rowID);
  const members = [];
  const links = [];
  for (const [key, value] of state) {
    if (/^(parent|child)_co_z/.test(key)) links.push(key.replace(/^(parent|child)_/, ""));
    else if (key.startsWith("co_z") && key !== creator && value !== "revoked") members.push(key);
  }
  return { members, links, state };
}

/** Sizes of what a set of CoValues holds: sessions, edits and their bytes. */
function measure(db, rowIDs) {
  let sessions = 0;
  let transactions = 0;
  let bytes = 0;
  for (let i = 0; i < rowIDs.length; i += BATCH) {
    const part = rowIDs.slice(i, i + BATCH);
    const marks = part.map(() => "?").join(",");
    sessions += Number(db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE coValue IN (${marks})`).get(...part).n);
    const t = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(tx)), 0) AS b FROM transactions WHERE ses IN (SELECT rowID FROM sessions WHERE coValue IN (${marks}))`).get(...part);
    transactions += Number(t.n);
    bytes += Number(t.b);
  }
  return { sessions, transactions, bytes };
}

/**
 * What every space holds, biggest first: one pass over the file. A CoValue's bytes go to the group
 * that owns it; a group's own edits (its members, its keys) go to itself. Accounts are groups too, and
 * are left out unless they own something besides themselves — a person's own, unshared apps do not
 * sync and are not here. Returns `{ spaces, total }`, `total` being every edit in the file.
 */
function sizes(db) {
  const statement = db.prepare(
    `SELECT c.id AS id, c.header AS header, COUNT(t.idx) AS edits, COALESCE(SUM(LENGTH(t.tx)), 0) AS bytes
       FROM coValues c LEFT JOIN sessions s ON s.coValue = c.rowID LEFT JOIN transactions t ON t.ses = s.rowID
      GROUP BY c.rowID`,
  );
  /** @type {Map<string, { id: string, kind: string, coValues: number, edits: number, bytes: number }>} */
  const byOwner = new Map();
  const total = { coValues: 0, edits: 0, bytes: 0 };
  const entry = (id) => {
    let e = byOwner.get(id);
    if (!e) byOwner.set(id, (e = { id, kind: "group", coValues: 0, edits: 0, bytes: 0 }));
    return e;
  };
  for (const row of typeof statement.iterate === "function" ? statement.iterate() : statement.all()) {
    const header = headerOf(row);
    const rule = header?.ruleset;
    const owner = rule?.type === "ownedByGroup" ? rule.group : row.id;
    const e = entry(owner);
    if (owner === row.id) e.kind = rule?.type === "group" ? (header?.meta?.type === "account" ? "account" : "group") : "other";
    e.coValues++;
    e.edits += Number(row.edits);
    e.bytes += Number(row.bytes);
    total.coValues++;
    total.edits += Number(row.edits);
    total.bytes += Number(row.bytes);
  }
  const spaces = [...byOwner.values()].filter((e) => e.kind === "group" || e.coValues > 1).sort((a, b) => b.bytes - a.bytes);
  return { spaces, total };
}

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 0);

function describeSizes(report, opts) {
  const shown = report.spaces.slice(0, opts.top);
  const lines = [`${report.spaces.length} spaces in ${opts.db}: ${mb(report.total.bytes)} MB of edits in ${report.total.coValues} CoValues. The ${shown.length} that hold the most:`];
  for (const e of shown) lines.push(`  ${e.id}  ${mb(e.bytes).padStart(8)} MB  ${String(e.coValues).padStart(7)} CoValues  ${String(e.edits).padStart(8)} edits${e.kind === "account" ? "  (an account's own)" : ""}`);
  lines.push("  Nothing was changed. To erase one: --space <id> (docs/16, \"Erasing a space or an account from the relay\").");
  return lines.join("\n");
}

const kindOf = (c) => (c.header?.ruleset?.type === "group" ? (c.header?.meta?.type === "account" ? "account" : "group") : c.header?.meta?.type === "binary" ? "file bytes" : c.header?.type ?? "unknown");

/** What `--space` would erase. */
function planSpace(db, spaceId) {
  const space = coValue(db, spaceId);
  if (!space) throw new Refusal(`${spaceId} is not on this relay: nothing to erase.`);
  const rule = space.header?.ruleset;
  if (rule?.type === "ownedByGroup") throw new Refusal(`${spaceId} is not a space but something inside one: its space is ${rule.group}. Pass that with --space.`);
  if (rule?.type !== "group") throw new Refusal(`${spaceId} is not a space (its header says ${JSON.stringify(rule?.type ?? null)}).`);
  if (space.header?.meta?.type === "account") throw new Refusal(`${spaceId} is an account, not a space. Use --account for it.`);
  const { members, links } = othersIn(db, space, rule.initialAdmin);
  const erase = [space, ...ownedBy(db, spaceId)];
  return { kind: "space", id: spaceId, erase, kept: [], notes: { otherMembers: members.length, linkedGroups: links } };
}

/** What `--account` would erase, and what it keeps and why. */
function planAccount(db, accountId) {
  const account = coValue(db, accountId);
  if (!account) throw new Refusal(`${accountId} is not on this relay: nothing to erase.`);
  if (account.header?.ruleset?.type !== "group" || account.header?.meta?.type !== "account") {
    throw new Refusal(`${accountId} is not an account. For a space, use --space.`);
  }
  // The profile (its name) is read by everyone who shares a space with it; it goes with the account.
  const profileId = othersIn(db, account, accountId).state.get("profile");
  const profile = typeof profileId === "string" ? coValue(db, profileId) : null;
  const profileGroupId = profile?.header?.ruleset?.type === "ownedByGroup" ? profile.header.ruleset.group : null;

  const created = db
    .prepare("SELECT rowID, id, header FROM coValues WHERE header LIKE ?")
    .all(`%"initialAdmin":"${accountId}"%`)
    .map((row) => ({ rowID: Number(row.rowID), id: row.id, header: headerOf(row) }))
    .filter((c) => c.header?.ruleset?.type === "group" && c.header.ruleset.initialAdmin === accountId && c.header?.meta?.type !== "account");

  const erase = [];
  const kept = [];
  const withProfile = [];
  for (const group of created) {
    const { members, links } = othersIn(db, group, accountId);
    const owned = ownedBy(db, group.id);
    if (group.id === profileGroupId) withProfile.push(group, ...owned);
    else if (members.length || links.length) kept.push({ id: group.id, why: `others are in it (${members.length} other account${members.length === 1 ? "" : "s"}${links.length ? `, linked to ${links.length} group${links.length === 1 ? "" : "s"}` : ""}): erase it with --space once they agree` });
    else erase.push(group, ...owned);
  }

  // Does anything that stays name the account? Its edits in others' spaces, or its membership and keys
  // in their groups. Then the account and its profile stay too: others' copies need them to check its edits.
  const going = new Set([account, ...erase, ...withProfile].map((c) => c.rowID));
  const sessionsElsewhere = db
    .prepare("SELECT DISTINCT coValue FROM sessions WHERE sessionID LIKE ?")
    // `_` is LIKE's one-character wildcard; it matches the underscores too, and nothing else could fit.
    .all(`${accountId}_session_%`)
    .map((r) => Number(r.coValue))
    .filter((rowID) => !going.has(rowID));
  const namedElsewhere = db
    .prepare("SELECT DISTINCT s.coValue AS coValue FROM transactions t JOIN sessions s ON s.rowID = t.ses WHERE t.tx LIKE ?")
    .all(`%${accountId}%`)
    .map((r) => Number(r.coValue))
    .filter((rowID) => !going.has(rowID));
  const referencedBy = new Set([...sessionsElsewhere, ...namedElsewhere]);
  if (referencedBy.size) {
    kept.push({
      id: accountId,
      why: `${referencedBy.size} CoValue${referencedBy.size === 1 ? "" : "s"} that stay name it (its edits or its membership in spaces others hold), so the account and its profile stay; erase those spaces first, or leave it`,
    });
  } else {
    erase.push(account, ...withProfile);
  }
  return { kind: "account", id: accountId, erase, kept, notes: {} };
}

/** Remove every row of these CoValues, in one transaction. */
function eraseRows(db, coValues) {
  const rowIDs = coValues.map((c) => c.rowID);
  const ids = coValues.map((c) => c.id);
  db.exec("SAVEPOINT erase");
  try {
    for (let i = 0; i < rowIDs.length; i += BATCH) {
      const rows = rowIDs.slice(i, i + BATCH);
      const names = ids.slice(i, i + BATCH);
      const r = rows.map(() => "?").join(",");
      const n = names.map(() => "?").join(",");
      db.prepare(`DELETE FROM transactions WHERE ses IN (SELECT rowID FROM sessions WHERE coValue IN (${r}))`).run(...rows);
      db.prepare(`DELETE FROM signatureAfter WHERE ses IN (SELECT rowID FROM sessions WHERE coValue IN (${r}))`).run(...rows);
      db.prepare(`DELETE FROM sessions WHERE coValue IN (${r})`).run(...rows);
      db.prepare(`DELETE FROM unsynced_covalues WHERE co_value_id IN (${n})`).run(...names);
      db.prepare(`DELETE FROM deletedCoValues WHERE coValueID IN (${n})`).run(...names);
      db.prepare(`DELETE FROM coValues WHERE rowID IN (${r})`).run(...rows);
    }
    db.exec("RELEASE erase");
  } catch (e) {
    db.exec("ROLLBACK TO erase");
    db.exec("RELEASE erase");
    throw e;
  }
}

function describe(plan, size, opts) {
  const kinds = {};
  for (const c of plan.erase) kinds[kindOf(c)] = (kinds[kindOf(c)] ?? 0) + 1;
  const lines = [`${plan.kind === "space" ? "Space" : "Account"} ${plan.id} in ${opts.db}`];
  if (plan.erase.length) {
    const what = Object.entries(kinds)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    lines.push(`  ${opts.dryRun ? "would erase" : "erased"}: ${plan.erase.length} CoValues (${what}), ${size.sessions} sessions, ${size.transactions} edits, ${Math.round(size.bytes / 1024)} KB`);
  } else lines.push("  nothing of it alone to erase");
  if (plan.kind === "space" && plan.notes.otherMembers) lines.push(`  it was shared: ${plan.notes.otherMembers} account(s) besides its creator lose it too`);
  if (plan.kind === "space" && plan.notes.linkedGroups.length) lines.push(`  linked groups, left as they are: ${plan.notes.linkedGroups.join(", ")}`);
  for (const k of plan.kept) lines.push(`  kept: ${k.id}: ${k.why}`);
  if (opts.dryRun) lines.push("  dry run: nothing was changed");
  else if (plan.erase.length) {
    lines.push("  A device that still holds it sends it back when it next connects; backups of sync.db still hold it (docs/16).");
  }
  return lines.join("\n");
}

async function openDb(file, dryRun) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    throw new Refusal("This needs Node 22.13 or later (node:sqlite). Run it in the relay's container: node:22-bookworm.");
  }
  const { existsSync } = await import("node:fs");
  if (!existsSync(file)) throw new Refusal(`No database at ${file}.`);
  const db = new DatabaseSync(file, { timeout: 0 });
  if (dryRun) return db;
  // Held for the whole run: refused while the relay has the file open, and the relay cannot start mid-way.
  try {
    db.exec("PRAGMA locking_mode=EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    db.exec("COMMIT");
  } catch {
    db.close();
    throw new Refusal(`The relay is using ${file}. Stop it first (docker stop potyro-relay), run this again, then start it.`, 3);
  }
  return db;
}

/** @param {string[]} argv */
export async function main(argv = process.argv.slice(2)) {
  const opts = parse(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (opts.sizes) {
    if (!opts.db || opts.space || opts.account || opts.rest.length || !Number.isInteger(opts.top) || opts.top < 1) {
      console.error(`Give --db with --sizes, and a whole number above 0 for --top.\n${USAGE}`);
      return 2;
    }
    let db;
    try {
      db = await openDb(opts.db, true);
      const report = sizes(db);
      console.log(opts.json ? JSON.stringify({ total: report.total, spaces: report.spaces.slice(0, opts.top) }) : describeSizes(report, opts));
      return 0;
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return e instanceof Refusal ? e.code : 1;
    } finally {
      db?.close();
    }
  }
  const id = opts.space ?? opts.account;
  if (!opts.db || !id || (opts.space && opts.account) || opts.rest.length) {
    console.error(`Give --db and one of --space, --account or --sizes.\n${USAGE}`);
    return 2;
  }
  if (!ID_RE.test(id)) {
    console.error(`${JSON.stringify(id)} is not a CoValue id (co_z…).\n${USAGE}`);
    return 2;
  }
  let db;
  try {
    db = await openDb(opts.db, opts.dryRun);
    const plan = opts.space ? planSpace(db, id) : planAccount(db, id);
    const size = measure(
      db,
      plan.erase.map((c) => c.rowID),
    );
    const before = Number(db.prepare("PRAGMA page_count").get().page_count) * Number(db.prepare("PRAGMA page_size").get().page_size);
    if (!opts.dryRun && plan.erase.length) {
      eraseRows(db, plan.erase);
      // Deleted rows leave their bytes in free pages until the file is rebuilt.
      if (opts.vacuum) db.exec("VACUUM");
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }
    const after = Number(db.prepare("PRAGMA page_count").get().page_count) * Number(db.prepare("PRAGMA page_size").get().page_size);
    if (opts.json) {
      console.log(
        JSON.stringify({
          kind: plan.kind,
          id: plan.id,
          dryRun: opts.dryRun,
          erased: opts.dryRun ? [] : plan.erase.map((c) => c.id),
          wouldErase: opts.dryRun ? plan.erase.map((c) => c.id) : [],
          kept: plan.kept,
          ...size,
          notes: plan.notes,
          fileBytes: { before, after },
        }),
      );
    } else console.log(describe(plan, size, opts));
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return e instanceof Refusal ? e.code : 1;
  } finally {
    db?.close();
  }
}

const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((code) => process.exit(code));
