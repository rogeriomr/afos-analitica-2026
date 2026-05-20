/**
 * Polymarket CLOB orderbook — fetch + price-impact math.
 *
 * Polymarket runs a CLOB (NOT an AMM), so the impact of a hypothetical
 * marketable order is computed by walking the order book level-by-level
 * (best→worst) until the requested USD notional is consumed. This module
 * is the canonical place for that arithmetic.
 *
 * Critical wire-format quirk: Polymarket returns `bids` ASCENDING by price
 * and `asks` DESCENDING by price. The top-of-book sits at the LAST element
 * of each array, NOT the first. `normalizeBook` flips both arrays so every
 * downstream consumer sees best-first ordering (bids desc / asks asc).
 *
 * Public functions never throw — network/HTTP failures resolve to null and
 * arithmetic edge cases (empty side, zero size, book-too-thin) resolve to
 * a well-defined sentinel (NaN postPrice, thinBook=true, etc.).
 *
 * Sizes on the wire are OUTCOME-SHARES; USD notional at any level is
 * `price * size`. Outcome prices are bounded in [0, 1].
 */

// ─── Types ──────────────────────────────────────────────────────────

/** A single price level with size in outcome-shares (not USD). */
export interface Level {
  price: number;
  size: number;
}

/** Raw shape returned by GET /book / POST /books from clob.polymarket.com. */
export interface RawBook {
  market: string;
  asset_id: string;
  timestamp: string;
  hash: string;
  tick_size: string;
  min_order_size: string;
  neg_risk?: boolean;
  last_trade_price?: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

/** Best-first normalized book used by every consumer in this module. */
export interface NormalizedBook {
  conditionId?: string;
  tokenId: string;
  bestBid: number | null;
  bestAsk: number | null;
  /** Sorted DESC by price (best bid first). */
  bids: Level[];
  /** Sorted ASC by price (best ask first). */
  asks: Level[];
  fetchedAt: Date;
  tickSize: number;
  minOrderSize: number;
}

/** Result of walking one side of the book against a USD-notional order. */
export interface ForwardResult {
  /** Volume-weighted average fill price. NaN when nothing filled. */
  fillVwap: number;
  /**
   * Resting top-of-book on the side that was hit AFTER the fill consumed it.
   * NaN if the side started empty; 1.0/0.0 if the book is fully consumed
   * (buy hits 1.0 ceiling, sell hits 0.0 floor — the next "level" effectively).
   */
  postPrice: number;
  sharesAcquired: number;
  /** USD actually filled; equals sizeUsd unless thinBook is true. */
  filledUsd: number;
  thinBook: boolean;
  feeUsd: number;
}

/** Result of asking how much USD it takes to push price to a target level. */
export interface RequiredSizeResult {
  sizeUsd: number;
  sharesAcquired: number;
  /** False when the target is beyond the worst level we can see. */
  reachable: boolean;
}

// ─── Constants & helpers ────────────────────────────────────────────

const CLOB_API_BASE = 'https://clob.polymarket.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;

// Round-trip prices/sizes through Number(). Wire values are strings to
// preserve precision client-side; for arithmetic we accept the f64 round.
function toNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

// ─── Circuit Breaker ────────────────────────────────────────────────
// Mirror the CLOSED/OPEN/HALF_OPEN state machine from client.ts so a
// flapping CLOB endpoint doesn't burn rate-limit budget.

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const circuit = {
  state: 'CLOSED' as CircuitState,
  failureCount: 0,
  lastFailureAt: 0,
  cooldownMs: 5 * 60 * 1000,
  threshold: 3,
};

function checkCircuit(): boolean {
  if (circuit.state === 'CLOSED') return true;
  if (circuit.state === 'OPEN') {
    if (Date.now() - circuit.lastFailureAt > circuit.cooldownMs) {
      circuit.state = 'HALF_OPEN';
      console.warn('[wallet-intel/orderbook] Circuit HALF_OPEN — probing');
      return true;
    }
    return false;
  }
  return true;
}

function recordSuccess(): void {
  if (circuit.state !== 'CLOSED') {
    console.warn('[wallet-intel/orderbook] Circuit CLOSED — recovered');
  }
  circuit.state = 'CLOSED';
  circuit.failureCount = 0;
}

function recordFailure(): void {
  circuit.failureCount++;
  circuit.lastFailureAt = Date.now();
  if (circuit.failureCount >= circuit.threshold || circuit.state === 'HALF_OPEN') {
    circuit.state = 'OPEN';
    console.warn(
      `[wallet-intel/orderbook] Circuit OPEN — ${circuit.failureCount} consecutive failures`,
    );
  }
}

// ─── Validation ─────────────────────────────────────────────────────

const TOKEN_ID_RE = /^[0-9]+$/;

function isValidTokenId(tokenId: string): boolean {
  return typeof tokenId === 'string' && TOKEN_ID_RE.test(tokenId);
}

// ─── HTTP ───────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
        ...(init?.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Network-resilient fetch with retry+jitter on 5xx/timeout/network errors.
 * 4xx (besides 429) short-circuits to null — likely a bad token id, not transient.
 * Transient failures use console.warn (expected at network boundaries),
 * permanent client errors use console.error.
 */
async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response | null> {
  if (!checkCircuit()) {
    console.warn('[wallet-intel/orderbook] Circuit OPEN — skipping:', url);
    return null;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init);

      if (res.status === 429) {
        console.warn('[wallet-intel/orderbook] Rate limited (429); backing off');
        if (attempt < retries) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        recordFailure();
        return null;
      }

      if (res.ok) {
        recordSuccess();
        return res;
      }

      if (res.status >= 500 && attempt < retries) {
        console.warn(
          `[wallet-intel/orderbook] Server ${res.status}, retry ${attempt + 1}/${retries}`,
        );
        await sleep(backoffDelay(attempt));
        continue;
      }

      console.error(`[wallet-intel/orderbook] Client error ${res.status}: ${url}`);
      recordFailure();
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('aborted')) {
        console.warn(`[wallet-intel/orderbook] Timeout: ${url}`);
      } else {
        console.warn(`[wallet-intel/orderbook] Network: ${msg}`);
      }
      if (attempt < retries) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      recordFailure();
      return null;
    }
  }
  return null;
}

// ─── Normalization ──────────────────────────────────────────────────

function normalizeLevels(
  raw: Array<{ price: string; size: string }>,
  side: 'bids' | 'asks',
): Level[] {
  if (!Array.isArray(raw)) return [];
  const levels: Level[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const price = toNum(r.price);
    const size = toNum(r.size);
    // Drop garbage levels: invalid price domain or non-positive size.
    if (!(price > 0) || !(price < 1) || !(size > 0)) {
      // Allow exactly 1.0/0.0 only when explicitly meaningful — but for safety
      // we exclude both ends (top-of-book at 1.0 means resolved YES, not tradable).
      // If price is in [0,1] inclusive we still keep it as long as size > 0.
      if (size > 0 && price >= 0 && price <= 1) {
        levels.push({ price, size });
      }
      continue;
    }
    levels.push({ price, size });
  }
  // Sort best-first.
  if (side === 'bids') {
    levels.sort((a, b) => b.price - a.price); // descending — best bid first
  } else {
    levels.sort((a, b) => a.price - b.price); // ascending — best ask first
  }
  return levels;
}

/**
 * Normalize a wire-format RawBook into a NormalizedBook with bids sorted
 * DESC and asks sorted ASC. Tolerant of malformed entries (skipped).
 */
export function normalizeBook(raw: RawBook): NormalizedBook {
  const bids = normalizeLevels(raw.bids, 'bids');
  const asks = normalizeLevels(raw.asks, 'asks');
  return {
    tokenId: raw.asset_id,
    bestBid: bids.length > 0 ? bids[0].price : null,
    bestAsk: asks.length > 0 ? asks[0].price : null,
    bids,
    asks,
    fetchedAt: new Date(),
    tickSize: toNum(raw.tick_size),
    minOrderSize: toNum(raw.min_order_size),
  };
}

// ─── Public fetches ─────────────────────────────────────────────────

/**
 * Fetch and normalize a single token's orderbook. Returns null on any
 * failure (network, HTTP, malformed JSON, invalid token id).
 */
export async function fetchBook(tokenId: string): Promise<NormalizedBook | null> {
  if (!isValidTokenId(tokenId)) {
    console.error(`[wallet-intel/orderbook] Invalid tokenId: "${tokenId}"`);
    return null;
  }
  const url = `${CLOB_API_BASE}/book?token_id=${encodeURIComponent(tokenId)}`;
  const res = await fetchWithRetry(url);
  if (!res) return null;
  try {
    const raw = (await res.json()) as RawBook;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.bids) || !Array.isArray(raw.asks)) {
      console.warn('[wallet-intel/orderbook] Malformed book response for', tokenId);
      return null;
    }
    return normalizeBook(raw);
  } catch (err) {
    console.warn('[wallet-intel/orderbook] JSON parse error:', err);
    return null;
  }
}

/**
 * Fetch many books in a single request. Polymarket accepts up to ~100
 * tokens per POST. Returns a Map keyed by tokenId; tokens with no book
 * or malformed entries are simply absent from the map.
 */
export async function fetchBooksBatch(
  tokenIds: string[],
): Promise<Map<string, NormalizedBook>> {
  const out = new Map<string, NormalizedBook>();
  const valid = tokenIds.filter(isValidTokenId);
  if (valid.length === 0) return out;

  const body = JSON.stringify(valid.map((token_id) => ({ token_id })));
  const res = await fetchWithRetry(`${CLOB_API_BASE}/books`, {
    method: 'POST',
    body,
  });
  if (!res) return out;
  try {
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) {
      console.warn('[wallet-intel/orderbook] /books expected array, got:', typeof data);
      return out;
    }
    for (const entry of data) {
      if (!entry || typeof entry !== 'object') continue;
      const raw = entry as RawBook;
      if (!Array.isArray(raw.bids) || !Array.isArray(raw.asks)) continue;
      const normalized = normalizeBook(raw);
      out.set(normalized.tokenId, normalized);
    }
  } catch (err) {
    console.warn('[wallet-intel/orderbook] /books JSON parse error:', err);
  }
  return out;
}

// ─── Pure math: forward impact & required size ──────────────────────

/**
 * Compute total USD notional resting on one side of the book.
 * `price * size` summed across every level.
 */
export function totalSideUsd(side: Level[]): number {
  let total = 0;
  for (const lvl of side) total += lvl.price * lvl.size;
  return total;
}

/**
 * Midpoint of the book — average of best bid and best ask.
 * Returns null when either side is empty.
 */
export function midpoint(book: NormalizedBook): number | null {
  if (book.bestBid === null || book.bestAsk === null) return null;
  return (book.bestBid + book.bestAsk) / 2;
}

/**
 * Walk one side of the book best→worst, filling `sizeUsd` USD of notional.
 * Returns:
 *  - fillVwap: VWAP of the shares acquired.
 *  - postPrice: the price level that becomes top-of-book AFTER the order
 *    (i.e. the last level partially touched, or the next untouched level
 *    if the last level was fully consumed).
 *  - thinBook: true iff the side was empty OR the order ate through every
 *    level before being satisfied.
 *
 * The `side` array MUST already be sorted best-first (asks asc / bids desc)
 * — this is what `normalizeBook` produces.
 *
 * `opts.feeBps` lets callers model a hypothetical taker fee. Applied at the
 * end as a flat USD reduction on the trade; doesn't affect the walk itself.
 */
export function forwardImpact(
  side: Level[],
  sizeUsd: number,
  opts: { feeBps?: number } = {},
): ForwardResult {
  const feeBps = opts.feeBps ?? 0;

  // Edge: non-positive request → zeroed.
  if (!(sizeUsd > 0)) {
    return {
      fillVwap: NaN,
      postPrice: side.length > 0 ? side[0].price : NaN,
      sharesAcquired: 0,
      filledUsd: 0,
      thinBook: false,
      feeUsd: 0,
    };
  }

  // Edge: empty side → can't fill anything.
  if (side.length === 0) {
    return {
      fillVwap: NaN,
      postPrice: NaN,
      sharesAcquired: 0,
      filledUsd: 0,
      thinBook: true,
      feeUsd: 0,
    };
  }

  let remaining = sizeUsd;
  let sharesAcquired = 0;
  let filledUsd = 0;
  let postPrice = side[0].price;
  let thinBook = false;

  for (let i = 0; i < side.length; i++) {
    const lvl = side[i];
    const levelUsd = lvl.price * lvl.size;

    if (levelUsd >= remaining) {
      // Partial fill at this level.
      const sharesAtLvl = remaining / lvl.price;
      sharesAcquired += sharesAtLvl;
      filledUsd += remaining;
      remaining = 0;
      // After this fill the level still has size remaining, so it stays
      // top-of-book at the same price.
      postPrice = lvl.price;
      break;
    }

    // Consume fully and advance.
    sharesAcquired += lvl.size;
    filledUsd += levelUsd;
    remaining -= levelUsd;

    if (i + 1 < side.length) {
      postPrice = side[i + 1].price;
    } else {
      // Exhausted the book without filling. Mark thin book.
      thinBook = true;
      // Determine side from the direction the book was sorted: if best-first
      // is ascending we were walking asks (buy) → cap at 1.0. If descending,
      // we were walking bids (sell) → floor at 0.0.
      const ascending =
        side.length >= 2 ? side[1].price > side[0].price : true;
      postPrice = ascending ? 1.0 : 0.0;
    }
  }

  const fillVwap = sharesAcquired > 0 ? filledUsd / sharesAcquired : NaN;
  const feeUsd = (filledUsd * feeBps) / 10_000;

  return {
    fillVwap,
    postPrice,
    sharesAcquired,
    filledUsd,
    thinBook,
    feeUsd,
  };
}

/**
 * Compute the USD notional required to drive top-of-book to `targetPrice`.
 *
 * Walks the side and accumulates levelUsd at every level whose price is
 * still on the "wrong" side of the target (i.e. levels we'd need to
 * consume to reach it). If the target is already crossed at the current
 * best, returns sizeUsd=0. If the target is beyond the deepest visible
 * level, returns reachable=false.
 *
 * `side` must be best-first sorted. Direction inferred from order.
 */
export function requiredSize(
  side: Level[],
  targetPrice: number,
  _opts: { feeBps?: number } = {},
): RequiredSizeResult {
  if (side.length === 0) {
    return { sizeUsd: 0, sharesAcquired: 0, reachable: false };
  }

  // Direction: ascending best-first = asks (buy walks up to higher prices).
  // Descending best-first = bids (sell walks down to lower prices).
  const ascending =
    side.length >= 2 ? side[1].price > side[0].price : true;

  // If target already reached at the current top of book, zero required.
  if (ascending) {
    // Buying: target says "I want top ask to be >= targetPrice". If best ask
    // already >= targetPrice we're done.
    if (side[0].price >= targetPrice) {
      return { sizeUsd: 0, sharesAcquired: 0, reachable: true };
    }
  } else {
    // Selling: target says "I want top bid to be <= targetPrice". If best
    // bid already <= target we're done.
    if (side[0].price <= targetPrice) {
      return { sizeUsd: 0, sharesAcquired: 0, reachable: true };
    }
  }

  let sizeUsd = 0;
  let sharesAcquired = 0;

  for (let i = 0; i < side.length; i++) {
    const lvl = side[i];
    // Consume this level fully — it sits on the wrong side of the target.
    const wrongSide = ascending ? lvl.price < targetPrice : lvl.price > targetPrice;
    if (!wrongSide) {
      // Reached or crossed target; we're done.
      return { sizeUsd, sharesAcquired, reachable: true };
    }
    sizeUsd += lvl.price * lvl.size;
    sharesAcquired += lvl.size;

    // If the NEXT level is at or beyond target, we've succeeded after
    // consuming this one.
    const next = side[i + 1];
    if (!next) {
      // No more levels in the book — target unreachable from visible depth.
      return { sizeUsd, sharesAcquired, reachable: false };
    }
    const nextOnTarget = ascending
      ? next.price >= targetPrice
      : next.price <= targetPrice;
    if (nextOnTarget) {
      return { sizeUsd, sharesAcquired, reachable: true };
    }
  }

  // Loop fell through (shouldn't happen given the next-level check above
  // but guard anyway).
  return { sizeUsd, sharesAcquired, reachable: false };
}
