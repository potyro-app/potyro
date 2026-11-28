import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { CLOCK_WINDOW_MS, digestOf, parseSignature, signedHeaders, verifyRequest, type ToVerify } from "../src/signature.ts";
import { INBOX, KEYS, T0 } from "./helpers.ts";

const body = new Uint8Array(Buffer.from('{"type":"Follow"}'));
const keyId = "https://social.example/users/ana#main-key";

function signed(over: Partial<ToVerify> = {}): ToVerify {
  const headers = signedHeaders({ method: "POST", url: new URL(INBOX), body, keyId, privateKeyPem: KEYS.theirs.privateKey, now: new Date(T0) });
  return {
    method: "POST",
    target: "/fedi/inbox",
    headers,
    body,
    signature: parseSignature(headers.signature)!,
    publicKeyPem: KEYS.theirs.publicKey,
    host: "potyro.example",
    now: T0,
    ...over,
  };
}

describe("signing a request and reading the signature back", () => {
  it("a request signed with an account's key is verified with its public key", () => {
    expect(verifyRequest(signed())).toEqual({ ok: true });
  });

  it("covers the request line, the host, the date and the body's digest", () => {
    const { signature, headers } = signed();
    expect(signature.keyId).toBe(keyId);
    expect(signature.headers).toEqual(["(request-target)", "host", "date", "digest", "content-type"]);
    expect(headers.digest).toBe(digestOf(body));
    expect(headers.host).toBe("potyro.example");
  });

  it("a GET is signed without a digest and verified without one", () => {
    const url = new URL("https://social.example/users/ana?x=1");
    const headers = signedHeaders({ method: "GET", url, keyId, privateKeyPem: KEYS.theirs.privateKey, now: new Date(T0) });
    expect(headers.digest).toBeUndefined();
    const verdict = verifyRequest({ method: "GET", target: "/users/ana?x=1", headers, body: new Uint8Array(), signature: parseSignature(headers.signature)!, publicKeyPem: KEYS.theirs.publicKey, host: "social.example", now: T0 });
    expect(verdict).toEqual({ ok: true });
  });

  it("refuses another key's signature", () => {
    expect(verifyRequest(signed({ publicKeyPem: KEYS.other.publicKey }))).toMatchObject({ ok: false, why: expect.stringMatching(/does not match/) });
  });

  it("refuses a body that is not the one signed", () => {
    const other = new Uint8Array(Buffer.from('{"type":"Delete"}'));
    expect(verifyRequest(signed({ body: other }))).toMatchObject({ ok: false, why: expect.stringMatching(/digest/) });
  });

  it("refuses a request sent to another address, or made for another host", () => {
    expect(verifyRequest(signed({ target: "/fedi/other" }))).toMatchObject({ ok: false });
    expect(verifyRequest(signed({ host: "elsewhere.example" }))).toMatchObject({ ok: false, why: expect.stringMatching(/another host/) });
  });

  it("refuses a date outside the window, either way, and one that is not a date", () => {
    expect(verifyRequest(signed({ now: T0 + CLOCK_WINDOW_MS + 1000 }))).toMatchObject({ ok: false, why: expect.stringMatching(/date/) });
    expect(verifyRequest(signed({ now: T0 - CLOCK_WINDOW_MS - 1000 }))).toMatchObject({ ok: false });
    expect(verifyRequest(signed({ now: T0 + CLOCK_WINDOW_MS - 1000 }))).toEqual({ ok: true });
    const s = signed();
    expect(verifyRequest({ ...s, headers: { ...s.headers, date: "soon" } })).toMatchObject({ ok: false });
  });

  it("refuses a signature that leaves out the digest, the host or the date: it could be replayed", () => {
    const s = signed();
    for (const dropped of ["digest", "host", "date", "(request-target)"]) {
      const headers = s.signature.headers.filter((h) => h !== dropped);
      expect(verifyRequest({ ...s, signature: { ...s.signature, headers } })).toMatchObject({ ok: false, why: expect.stringContaining(dropped) });
    }
  });

  it("refuses a key that is too short, a key that is not RSA, and an algorithm it does not read", () => {
    const weak = generateKeyPairSync("rsa", { modulusLength: 1024, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const headers = signedHeaders({ method: "POST", url: new URL(INBOX), body, keyId, privateKeyPem: weak.privateKey, now: new Date(T0) });
    expect(verifyRequest(signed({ headers, signature: parseSignature(headers.signature)!, publicKeyPem: weak.publicKey }))).toMatchObject({ ok: false, why: expect.stringMatching(/2048/) });
    const ed = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    expect(verifyRequest(signed({ publicKeyPem: ed.publicKey }))).toMatchObject({ ok: false });
    expect(verifyRequest(signed({ publicKeyPem: "not a key" }))).toMatchObject({ ok: false });
    const s = signed();
    expect(verifyRequest({ ...s, signature: { ...s.signature, algorithm: "hmac-sha256" } })).toMatchObject({ ok: false, why: expect.stringMatching(/algorithm/) });
    expect(verifyRequest({ ...s, signature: { ...s.signature, algorithm: "hs2019" } })).toEqual({ ok: true });
  });

  it("a signature that names a header the request does not have is refused, whatever the name", () => {
    const s = signed();
    for (const name of ["x-missing", "__proto__", "constructor", "toString"]) {
      expect(verifyRequest({ ...s, signature: { ...s.signature, headers: [...s.signature.headers, name] } })).toMatchObject({ ok: false, why: expect.stringMatching(/missing/) });
    }
  });

  it("reads a Signature header, and says null to what is not one", () => {
    expect(parseSignature('keyId="k",headers="(request-target) Host DATE",signature="c2ln"')).toEqual({ keyId: "k", algorithm: "rsa-sha256", headers: ["(request-target)", "host", "date"], signature: "c2ln" });
    expect(parseSignature(undefined)).toBeNull();
    expect(parseSignature('headers="date"')).toBeNull();
    expect(parseSignature(`keyId="k",signature="${"a".repeat(5000)}"`)).toBeNull();
  });
});
