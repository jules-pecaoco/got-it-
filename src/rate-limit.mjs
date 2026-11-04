export class RateLimiter {
  constructor({ now = Date.now, maxKeys = 20_000 } = {}) {
    this.now = now;
    this.maxKeys = maxKeys;
    this.entries = new Map();
    this.nextSweep = 0;
  }
  sweep() {
    const now = this.now();
    if (now < this.nextSweep && this.entries.size < this.maxKeys) return;
    for (const [key, state] of this.entries) if (state.expires <= now) this.entries.delete(key);
    this.nextSweep = now + 60_000;
  }
  state(key, windowMs) {
    this.sweep();
    // Preserve existing counters at capacity; unknown keys share an overflow bucket.
    if (!this.entries.has(key) && this.entries.size >= this.maxKeys) key = `overflow:${windowMs}`;
    const state = this.entries.get(key);
    return { key, state: state && state.expires > this.now() ? state : null };
  }
  check(key, max, windowMs = 60_000) {
    const { state } = this.state(key, windowMs);
    if (state && state.count >= max) throw Object.assign(new Error('Too many requests. Please wait before retrying.'), {
      code: 'RATE_LIMITED', status: 429, retryAfter: Math.max(1, Math.ceil((state.expires - this.now()) / 1000))
    });
  }
  consume(key, max, windowMs = 60_000) {
    this.check(key, max, windowMs);
    const current = this.state(key, windowMs);
    const state = current.state ?? { count: 0, expires: this.now() + windowMs };
    state.count++;
    this.entries.set(current.key, state);
  }
  clear(key) { this.entries.delete(key); }
}
