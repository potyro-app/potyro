// Who entered a record is the host's fact, never the app's (KA-18).
//
// App code that could set `createdBy` could claim someone else wrote a ledger entry, and untrusted
// code is precisely the code that would want to. Both ways app code reaches the store — the direct
// `ctx` (make-ctx.ts) and the isolate bridge (isolate-host.ts) — go through these, so neither can
// drift into trusting the app. An app needing an editable "who" uses a `member` field.

/** A create's data with the app's `createdBy` dropped and this device's identity stamped. */
export function stampAuthor(data: unknown, me: string): Record<string, unknown> {
  const { createdBy: _ignored, ...clean } = (data ?? {}) as Record<string, unknown>;
  return { ...clean, createdBy: me };
}

/**
 * A patch's data with `createdBy` dropped. Dropped rather than rejected: a patch that echoes a
 * resolved record back would otherwise fail for doing nothing wrong. Not even the author may change it.
 */
export function stripAuthor(data: unknown): Record<string, unknown> {
  const { createdBy: _ignored, ...clean } = (data ?? {}) as Record<string, unknown>;
  return clean;
}

/** `increment` names one field: counting on `createdBy` is an attempt to change it, and refused. */
export function assertNotAuthor(field: string): void {
  if (field === "createdBy") throw new Error("ctx.increment: createdBy is stamped by the host and cannot be changed");
}
