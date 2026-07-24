// Marshalling across the isolate boundary. Everything crosses as JSON strings (the QuickJS
// bridge is a single string-in/string-out function). `Date` is tagged so it survives the round
// trip (resolved datetime fields are `Date` on the host side).

const DATE_TAG = "__kdate";

export function serialize(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string) {
    const raw = this[key];
    if (raw instanceof Date) return { [DATE_TAG]: raw.toISOString() };
    return this[key];
  });
}

export function deserialize<T = unknown>(json: string): T {
  return JSON.parse(json, (_key, val) => {
    if (val && typeof val === "object" && typeof (val as Record<string, unknown>)[DATE_TAG] === "string") {
      return new Date((val as Record<string, string>)[DATE_TAG]!);
    }
    return val;
  }) as T;
}

/** The identical (inlined) helpers the in-VM harness uses. Kept as a string so it can be
 *  concatenated into the harness bundle. Must stay in sync with the functions above. */
export const MARSHAL_SOURCE = `
const DATE_TAG = ${JSON.stringify(DATE_TAG)};
function __serialize(value){
  return JSON.stringify(value, function(key){
    const raw = this[key];
    if (raw instanceof Date) return { [DATE_TAG]: raw.toISOString() };
    return this[key];
  });
}
function __deserialize(json){
  return JSON.parse(json, function(key, val){
    if (val && typeof val === "object" && typeof val[DATE_TAG] === "string") return new Date(val[DATE_TAG]);
    return val;
  });
}
`;
