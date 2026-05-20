/**
 * Polymarket Data API — In-Process Token Bucket Rate Limiter
 *
 * Per-endpoint-family buckets sized to Polymarket's documented 10-second windows:
 *   - /trades:           200 / 10s
 *   - /positions:        150 / 10s
 *   - /closed-positions: 150 / 10s
 *   - general:          1000 / 10s
 *
 * No external store (Redis/etc) — cron runs single-instance per tick so a Map
 * keyed by EndpointKey is sufficient. If we ever scale horizontally this must
 * be replaced with a distributed limiter.
 */

export type EndpointKey = 'trades' | 'positions' | 'closed-positions' | 'general';

interface Bucket {
  capacity: number;        // max tokens the bucket can hold
  tokensAvailable: number; // current token count (float — partial refills accumulate)
  refillPerMs: number;     // tokens generated per millisecond
  lastRefill: number;      // epoch ms of last refill computation
}

// Math: capacity / windowMs = tokens per ms.
// e.g. 200 tokens / 10_000 ms = 0.02 tokens/ms = 1 token every 50 ms.
const WINDOW_MS = 10_000;

const buckets = new Map<EndpointKey, Bucket>([
  ['trades',           makeBucket(200)],
  ['positions',        makeBucket(150)],
  ['closed-positions', makeBucket(150)],
  ['general',          makeBucket(1000)],
]);

function makeBucket(capacity: number): Bucket {
  return {
    capacity,
    tokensAvailable: capacity,
    refillPerMs: capacity / WINDOW_MS,
    lastRefill: Date.now(),
  };
}

/**
 * Top up a bucket based on elapsed wall-clock time since last refill.
 * Caps at `capacity` so unused tokens don't accumulate beyond the window budget.
 */
function refill(b: Bucket): void {
  const now = Date.now();
  const elapsed = now - b.lastRefill;
  if (elapsed <= 0) return;
  const gained = elapsed * b.refillPerMs;
  b.tokensAvailable = Math.min(b.capacity, b.tokensAvailable + gained);
  b.lastRefill = now;
}

/**
 * Compute ms until at least one full token is available, given current state.
 * Returns 0 if a token is already available.
 */
function msUntilNextToken(b: Bucket): number {
  if (b.tokensAvailable >= 1) return 0;
  const needed = 1 - b.tokensAvailable;
  // needed tokens / (tokens per ms) = ms required
  return Math.ceil(needed / b.refillPerMs);
}

/**
 * Acquire one token for the given endpoint family, waiting if needed.
 * Resolves when a token has been deducted from the bucket.
 *
 * Implementation: refill -> if >=1 token, consume and resolve; else sleep
 * exactly long enough for one token to refill, then loop. Worst-case sleep
 * for the smallest bucket (150/10s) is ~67 ms, so the loop converges quickly.
 */
export async function acquireToken(key: EndpointKey): Promise<void> {
  const bucket = buckets.get(key);
  if (!bucket) {
    // Defensive: unknown key falls back to the general bucket.
    const fallback = buckets.get('general');
    if (!fallback) return; // should be unreachable; bucket map is module-init constant
    return acquireToken('general');
  }

  while (true) {
    refill(bucket);
    if (bucket.tokensAvailable >= 1) {
      bucket.tokensAvailable -= 1;
      return;
    }
    const waitMs = msUntilNextToken(bucket);
    await sleep(waitMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
