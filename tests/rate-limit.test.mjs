import test from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/rate-limit.mjs';

test('limits expire, expose retry time, and bound unknown-key growth without evicting existing counters', () => {
  let now = 1000;
  const limiter = new RateLimiter({ now: () => now, maxKeys: 2 });
  limiter.consume('first', 1);
  assert.throws(() => limiter.check('first', 1), error => error.status === 429 && error.retryAfter === 60);
  limiter.consume('second', 1);
  for (let index = 0; index < 100; index++) {
    try { limiter.consume(`unknown-${index}`, 2); } catch (error) { assert.equal(error.status, 429); }
  }
  assert.ok(limiter.entries.size <= 3);
  assert.throws(() => limiter.check('first', 1), /Too many/);
  now += 60_000;
  limiter.consume('first', 1);
  assert.equal(limiter.entries.size, 1);
});
