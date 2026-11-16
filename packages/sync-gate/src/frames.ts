// Where one websocket frame ends and the next begins (RFC 6455 §5.2), and nothing more.
//
// The gate forwards bytes as they come and never holds a message: it reads each frame's HEADER (2 to
// 14 bytes) to count frames, to know how long the message says it is BEFORE its bytes arrive, and to
// know when the stream is between two frames (the only place a close frame of the gate's own may be
// written). The payload is never unmasked, parsed or kept.
//
// What a header says is CHECKED, not only counted, so that the gate's idea of where a message ends
// does not rest on the relay behind refusing what the gate let through: no reserved bit (no extension
// is ever agreed: the gate's own request to the relay offers none), a control frame whole and short,
// a continuation only of a message under way, and no new message inside one (RFC 6455 §5.4, §5.5).

export interface Walked {
  /** Frames whose header was completed in this chunk. */
  frames: number;
  /** A message (all its fragments together) says it is longer than the limit. */
  tooBig: boolean;
  /**
   * Not a websocket stream this gate passes on: a reserved bit or opcode, an unmasked client frame, a
   * control frame that is fragmented or over 125 bytes, a continuation of nothing, a message begun
   * inside another.
   */
  bad: boolean;
}

export class FrameWalker {
  private readonly maxMessageBytes: number;
  private readonly mustBeMasked: boolean;
  private readonly head = Buffer.alloc(14);
  private headLength = 0;
  /** Bytes of the current frame (mask key and payload) still to come. */
  private left = 0;
  /** Payload bytes of the message so far: a message may come as several frames. */
  private messageBytes = 0;
  /** A message whose last frame has not come yet. */
  private open = false;
  private closeSeen = false;

  /** `mustBeMasked`: frames from a client always are (RFC 6455 §5.1); frames from a server never. */
  constructor(maxMessageBytes: number, mustBeMasked: boolean) {
    this.maxMessageBytes = maxMessageBytes;
    this.mustBeMasked = mustBeMasked;
  }

  /** True between two frames: nothing of a frame has been seen that is not complete. */
  get atBoundary(): boolean {
    return this.left === 0 && this.headLength === 0;
  }

  /** A close frame's header has passed: the side this walker reads has said it is done. */
  get sawClose(): boolean {
    return this.closeSeen;
  }

  feed(chunk: Buffer): Walked {
    const out: Walked = { frames: 0, tooBig: false, bad: false };
    let at = 0;
    while (at < chunk.length) {
      if (this.left > 0) {
        const skip = Math.min(this.left, chunk.length - at);
        this.left -= skip;
        at += skip;
        continue;
      }
      this.head[this.headLength++] = chunk[at++]!;
      if (this.headLength < 2) continue;
      const short = this.head[1]! & 0x7f;
      const masked = (this.head[1]! & 0x80) !== 0;
      const lengthBytes = short === 126 ? 2 : short === 127 ? 8 : 0;
      if (this.headLength < 2 + lengthBytes) continue;

      const opcode = this.head[0]! & 0x0f;
      let length = short;
      if (short === 126) length = this.head.readUInt16BE(2);
      else if (short === 127) {
        // Past 2^32 bytes is past any limit this gate is given; never read as a float.
        length = this.head.readUInt32BE(2) !== 0 ? Number.MAX_SAFE_INTEGER : this.head.readUInt32BE(6);
      }
      this.headLength = 0;
      out.frames++;

      const fin = (this.head[0]! & 0x80) !== 0;
      const reserved = (this.head[0]! & 0x70) !== 0;
      const control = opcode >= 0x8;
      const known = opcode <= 0x2 || (opcode >= 0x8 && opcode <= 0xa);
      // 0 continues the message under way; 1 (text) and 2 (binary) start one.
      const outOfTurn = !control && (opcode === 0) !== this.open;
      if (!known || reserved || masked !== this.mustBeMasked || (control && (length > 125 || !fin)) || outOfTurn) {
        out.bad = true;
        return out;
      }
      if (opcode === 0x8) this.closeSeen = true;
      if (!control) {
        this.open = !fin;
        this.messageBytes = (opcode === 0 ? this.messageBytes : 0) + length;
        if (this.messageBytes > this.maxMessageBytes) {
          out.tooBig = true;
          return out;
        }
      }
      this.left = length + (masked ? 4 : 0);
    }
    return out;
  }
}

/** A close frame from a server (unmasked): the code, and a reason of at most 123 bytes. */
export function closeFrame(code: number, reason: string): Buffer {
  const text = Buffer.from(reason, "utf8").subarray(0, 123);
  const frame = Buffer.alloc(4 + text.length);
  frame[0] = 0x88;
  frame[1] = 2 + text.length;
  frame.writeUInt16BE(code, 2);
  text.copy(frame, 4);
  return frame;
}
