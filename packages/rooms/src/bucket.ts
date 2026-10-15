/**
 * A token bucket: `burst` at once, refilled at `rate` a second. Time is passed in, for tests.
 * (Plain fields, no constructor parameter properties: Node's type stripping, which runs this file in
 * production, does not support them.)
 */
export class Bucket {
  private readonly rate: number;
  private readonly burst: number;
  private tokens: number;
  private last: number;

  constructor(rate: number, burst: number, now: number) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.last = now;
  }

  /** Takes `n` tokens if there are that many; false (and takes none) if not. */
  take(n: number, now: number): boolean {
    const elapsed = Math.max(0, now - this.last);
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + (elapsed / 1000) * this.rate);
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
