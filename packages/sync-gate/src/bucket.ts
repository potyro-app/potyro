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

  private refill(now: number): void {
    const elapsed = Math.max(0, now - this.last);
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + (elapsed / 1000) * this.rate);
  }

  /** Takes `n` tokens if there are that many; false (and takes none) if not. */
  take(n: number, now: number): boolean {
    this.refill(now);
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }

  /**
   * Takes `n` tokens whether or not they are there, and says how many milliseconds the sender is to
   * be held until the bucket is back at zero: 0 while it is not in debt. For what has already
   * arrived and can only be paid for afterwards, by waiting.
   */
  spend(n: number, now: number): number {
    this.refill(now);
    this.tokens -= n;
    return this.tokens >= 0 ? 0 : Math.ceil((-this.tokens / this.rate) * 1000);
  }

  /** True when nothing of it is in use: a bucket nobody needs to remember. */
  full(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.burst;
  }
}
