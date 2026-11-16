import { describe, expect, it } from "vitest";
import { addressKey, clientAddress, readTrustProxy } from "../src/address.ts";
import { Bucket } from "../src/bucket.ts";
import { closeFrame, FrameWalker } from "../src/frames.ts";
import { dayOf, secondsLeftToday } from "../src/limits.ts";

/** A frame as a client (masked) or a server (not) writes it; the payload's bytes do not matter here. */
function frame(opcode: number, length: number, opts: { masked?: boolean; fin?: boolean } = {}): Buffer {
  const masked = opts.masked ?? true;
  const head: number[] = [(opts.fin === false ? 0 : 0x80) | opcode];
  const bit = masked ? 0x80 : 0;
  if (length < 126) head.push(bit | length);
  else if (length < 65536) head.push(bit | 126, length >> 8, length & 0xff);
  else head.push(bit | 127, 0, 0, 0, 0, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
  return Buffer.concat([Buffer.from(head), Buffer.alloc((masked ? 4 : 0) + length, 0x81)]);
}

describe("the client's address", () => {
  it("is the last X-Forwarded-For entry behind Caddy, and the socket's peer when no proxy is believed", () => {
    expect(clientAddress("6.6.6.6, 9.9.9.9", "127.0.0.1", "caddy")).toBe("9.9.9.9");
    expect(clientAddress(["6.6.6.6", "7.7.7.7, 9.9.9.9"], "127.0.0.1", "caddy")).toBe("9.9.9.9");
    expect(clientAddress(undefined, "127.0.0.1", "caddy")).toBe("127.0.0.1");
    expect(clientAddress("6.6.6.6, 9.9.9.9", "10.0.0.5", "none")).toBe("10.0.0.5");
  });

  it("is counted as itself for IPv4 and as its /64 for IPv6", () => {
    expect(addressKey("9.9.9.9")).toBe("9.9.9.9");
    expect(addressKey("::ffff:9.9.9.9")).toBe("9.9.9.9");
    expect(addressKey("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
  });

  it("stops the gate starting on a TRUST_PROXY it does not know", () => {
    expect(readTrustProxy(undefined)).toBe("caddy");
    expect(readTrustProxy("none")).toBe("none");
    expect(() => readTrustProxy("apache")).toThrow("TRUST_PROXY must be one of caddy, none");
  });
});

describe("the bucket", () => {
  it("takes what is there and refuses the rest until it refills", () => {
    const b = new Bucket(10, 20, 0);
    expect(b.take(20, 0)).toBe(true);
    expect(b.take(1, 0)).toBe(false);
    expect(b.take(5, 500)).toBe(true);
  });

  it("lets a sender spend into debt and says how long it is to be held for it", () => {
    const b = new Bucket(1000, 1000, 0);
    expect(b.spend(1000, 0)).toBe(0);
    expect(b.spend(500, 0)).toBe(500);
    expect(b.spend(0, 250)).toBe(250);
    expect(b.spend(0, 500)).toBe(0);
    expect(b.full(500)).toBe(false);
    expect(b.full(1500)).toBe(true);
  });
});

describe("walking frames", () => {
  it("counts frames whatever way the stream is cut into reads, and knows when it is between two", () => {
    const stream = Buffer.concat([frame(1, 5), frame(2, 300), frame(1, 70_000), frame(9, 0)]);
    for (const size of [1, 2, 3, 7, 1000, stream.length]) {
      const w = new FrameWalker(1_000_000, true);
      let frames = 0;
      for (let at = 0; at < stream.length; at += size) {
        const r = w.feed(stream.subarray(at, at + size));
        expect(r.bad || r.tooBig).toBe(false);
        frames += r.frames;
      }
      expect(frames).toBe(4);
      expect(w.atBoundary).toBe(true);
    }
    const w = new FrameWalker(1_000_000, true);
    w.feed(stream.subarray(0, 4));
    expect(w.atBoundary).toBe(false);
  });

  it("says a message is too big from its header alone, and adds up a message sent in pieces", () => {
    const w = new FrameWalker(1000, true);
    expect(w.feed(frame(1, 1001).subarray(0, 4)).tooBig).toBe(true);

    const pieces = new FrameWalker(1000, true);
    expect(pieces.feed(frame(1, 600, { fin: false })).tooBig).toBe(false);
    expect(pieces.feed(frame(9, 10)).tooBig).toBe(false); // a ping between the pieces is not part of the message
    expect(pieces.feed(frame(0, 600)).tooBig).toBe(true);

    const fresh = new FrameWalker(1000, true);
    fresh.feed(frame(1, 600));
    expect(fresh.feed(frame(1, 600)).tooBig).toBe(false); // two messages, each within the limit
  });

  it("says a length past 4 GiB is too big rather than misreading it", () => {
    const head = Buffer.from([0x82, 0x80 | 127, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(new FrameWalker(2 ** 40, true).feed(head).tooBig).toBe(true);
  });

  it("refuses what is not a client's websocket stream: an unmasked frame, a reserved opcode, a long control frame", () => {
    expect(new FrameWalker(1000, true).feed(frame(1, 5, { masked: false })).bad).toBe(true);
    expect(new FrameWalker(1000, true).feed(frame(3, 5)).bad).toBe(true);
    expect(new FrameWalker(1000, true).feed(frame(8, 126)).bad).toBe(true);
    expect(new FrameWalker(1000, true).feed(Buffer.from("GET / HTTP/1.1\r\n")).bad).toBe(true);
    expect(new FrameWalker(1000, false).feed(frame(1, 5, { masked: false })).bad).toBe(false);
  });

  it("writes a close frame a browser reads: the code, and a reason of at most 123 bytes", () => {
    const f = closeFrame(4021, "too much from this address today");
    expect(f[0]).toBe(0x88);
    expect(f.readUInt16BE(2)).toBe(4021);
    expect(f.subarray(4).toString()).toBe("too much from this address today");
    expect(closeFrame(1001, "é".repeat(200)).length).toBeLessThanOrEqual(127);
    expect(new FrameWalker(1000, false).feed(f)).toEqual({ frames: 1, tooBig: false, bad: false });
  });
});

describe("the day", () => {
  it("is the calendar day in UTC, and Retry-After is the seconds to its end", () => {
    const noon = Date.UTC(2026, 10, 16, 12, 0, 0);
    expect(dayOf(noon)).toBe(dayOf(noon + 11 * 3600_000));
    expect(dayOf(noon)).not.toBe(dayOf(noon + 12 * 3600_000));
    expect(secondsLeftToday(noon)).toBe(12 * 3600);
  });
});
