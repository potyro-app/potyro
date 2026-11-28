// Every request this service makes goes to an address a stranger chose: the account that asks to
// follow says where its key and its inbox are. So nothing here may reach the server's own network.
//
// The rule: https only, the default port, a real host name, and every address that name resolves to
// must be a public one. The check is made in the connection's own lookup, so the address that was
// checked is the address that is connected to (a name that answers differently a moment later gets
// nowhere). Redirects are not followed. Answers are cut at a size and a time.
import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { httpsUrl } from "./feed.ts";

export interface OutboundRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  maxBytes: number;
  timeoutMs: number;
}

export interface OutboundResponse {
  status: number;
  body: Uint8Array;
}

/** How the service reaches other servers; a test hands in its own. */
export type Outbound = (request: OutboundRequest) => Promise<OutboundResponse>;

const NOT_PUBLIC = new BlockList();
const V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
];
const V6: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];
for (const [net, prefix] of V4) NOT_PUBLIC.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of V6) NOT_PUBLIC.addSubnet(net, prefix, "ipv6");

/** Whether an IP address is one on the public internet: not this machine, not a private network. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !NOT_PUBLIC.check(address, "ipv4");
  if (family !== 6) return false;
  // An IPv4 address written as IPv6 (`::ffff:10.0.0.1`) is judged as the IPv4 address it is.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]!);
  return !NOT_PUBLIC.check(address, "ipv6");
}

/** An address this service may ask: https, the default port, a host name (never a bare IP). */
export function safeUrl(value: unknown): URL | null {
  const url = httpsUrl(value);
  if (!url || url.port) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) || !host.includes(".") || host.endsWith(".")) return null;
  return url;
}

/** The connection's lookup: the name's addresses, or an error when any of them is not public. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad || !addresses.length) {
      const refused = Object.assign(new Error(`${hostname} is not on the public internet`), { code: "ENOTPUBLIC" });
      return callback(refused, "", 0);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

/** The real thing: one https request, no redirect followed, cut at `maxBytes` and `timeoutMs`. */
export const requestOverHttps: Outbound = (req) =>
  new Promise((resolve, reject) => {
    const url = safeUrl(req.url);
    if (!url) return reject(new Error("not an address this service asks"));
    const out = httpsRequest(url, { method: req.method, headers: req.headers, lookup: guardedLookup }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > req.maxBytes) return out.destroy(new Error("the answer is too big"));
        chunks.push(chunk);
      });
      res.on("end", () => {
        clearTimeout(deadline);
        resolve({ status: res.statusCode ?? 0, body: new Uint8Array(Buffer.concat(chunks)) });
      });
    });
    // One deadline for the whole exchange: a server that sends a byte a minute is not waited for.
    const deadline = setTimeout(() => out.destroy(new Error("timed out")), req.timeoutMs);
    out.on("error", (e) => {
      clearTimeout(deadline);
      reject(e);
    });
    out.end(req.body ? Buffer.from(req.body) : undefined);
  });
