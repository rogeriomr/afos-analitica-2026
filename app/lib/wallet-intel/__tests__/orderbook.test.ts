/**
 * Unit tests for the Polymarket CLOB orderbook math layer.
 *
 * Uses a hardcoded raw book (the Tarcísio YES token snapshot supplied in
 * the spec) so tests are deterministic and never hit the live network.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeBook,
  forwardImpact,
  requiredSize,
  totalSideUsd,
  midpoint,
  type RawBook,
  type Level,
} from '../orderbook';

// ─── Fixtures ───────────────────────────────────────────────────────

/**
 * Real Tarcísio YES snapshot returned by GET /book — note the wire-format
 * quirk: bids are ASCENDING by price (best is LAST), asks are DESCENDING
 * by price (best is also LAST). normalizeBook must flip both.
 */
const TARCISIO_RAW: RawBook = {
  market: '0x81a537b3000000000000000000000000000000000000000000000000000000001a3a',
  asset_id:
    '52634616068523389389514492087655237014427439869589807217055529923225131895030',
  timestamp: '1700000000',
  hash: '0xhash',
  tick_size: '0.001',
  min_order_size: '5',
  neg_risk: true,
  last_trade_price: '0.004',
  bids: [
    { price: '0.001', size: '1368050.98' }, // worst
    { price: '0.002', size: '402367.19' },
    { price: '0.003', size: '278985.22' }, // best (last element)
  ],
  asks: [
    { price: '0.999', size: '10066700' }, // worst
    { price: '0.998', size: '503000' },
    { price: '0.997', size: '10000' },
    { price: '0.99', size: '483312.49' },
    { price: '0.988', size: '200000' }, // best (last element)
  ],
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('normalizeBook', () => {
  it('sorts bids DESC and asks ASC (best-first on both sides)', () => {
    const book = normalizeBook(TARCISIO_RAW);

    // Bids: best (highest price) should come first.
    expect(book.bids[0].price).toBe(0.003);
    expect(book.bids[1].price).toBe(0.002);
    expect(book.bids[2].price).toBe(0.001);
    expect(book.bestBid).toBe(0.003);

    // Asks: best (lowest price) should come first.
    expect(book.asks[0].price).toBe(0.988);
    expect(book.asks[1].price).toBe(0.99);
    expect(book.asks[2].price).toBe(0.997);
    expect(book.asks[3].price).toBe(0.998);
    expect(book.asks[4].price).toBe(0.999);
    expect(book.bestAsk).toBe(0.988);

    // Metadata correctly typed.
    expect(book.tickSize).toBe(0.001);
    expect(book.minOrderSize).toBe(5);
    expect(book.tokenId).toBe(TARCISIO_RAW.asset_id);
    expect(book.fetchedAt).toBeInstanceOf(Date);
  });
});

describe('forwardImpact — buying YES (walking asks)', () => {
  it('$10k buy on Tarcísio book stays inside the first ask level', () => {
    const book = normalizeBook(TARCISIO_RAW);
    const result = forwardImpact(book.asks, 10_000);

    // First ask level has 0.988 * 200000 = $197,600 capacity, so a $10k
    // order partially fills at 0.988 and the post-price is still 0.988.
    expect(result.filledUsd).toBeCloseTo(10_000, 4);
    expect(result.fillVwap).toBeCloseTo(0.988, 3);
    expect(result.postPrice).toBeCloseTo(0.988, 3);
    expect(result.sharesAcquired).toBeCloseTo(10_000 / 0.988, 2);
    expect(result.thinBook).toBe(false);
  });

  it('$300k buy crosses into the second ask level', () => {
    const book = normalizeBook(TARCISIO_RAW);
    // Level 1 capacity = 0.988 * 200000 = $197,600. $300k consumes all of
    // level 1 (~197,600 USD, 200,000 shares) and partial level 2 (~102,400
    // USD at 0.99 → ~103,434 shares). Post-price = 0.99 (still resting at lvl 2).
    const result = forwardImpact(book.asks, 300_000);

    expect(result.filledUsd).toBeCloseTo(300_000, 0);
    expect(result.postPrice).toBeCloseTo(0.99, 3);
    expect(result.thinBook).toBe(false);
    // VWAP should be between 0.988 and 0.99, weighted toward 0.988.
    expect(result.fillVwap).toBeGreaterThan(0.988);
    expect(result.fillVwap).toBeLessThan(0.99);
  });
});

describe('forwardImpact — selling YES (walking bids)', () => {
  it('selling $500 walks into the second bid level', () => {
    const book = normalizeBook(TARCISIO_RAW);
    // bids[0]=0.003,size=278985.22 → capacity = $836.96. $500 < $836 →
    // partial fill at 0.003, post stays 0.003.
    const r1 = forwardImpact(book.bids, 500);
    expect(r1.fillVwap).toBeCloseTo(0.003, 4);
    expect(r1.postPrice).toBeCloseTo(0.003, 4);
    expect(r1.thinBook).toBe(false);
  });

  it('selling $2,000 burns through bid levels 1 and 2', () => {
    const book = normalizeBook(TARCISIO_RAW);
    // Level 1 cap = 0.003*278985.22 = $836.96
    // Level 2 cap = 0.002*402367.19 = $804.73
    // Cumulative = $1,641.69 — still less than $2,000, so we cross into
    // level 3 (0.001). Post-price = 0.001 with remaining ~$358 of fill there.
    const r = forwardImpact(book.bids, 2_000);
    expect(r.postPrice).toBeCloseTo(0.001, 4);
    expect(r.thinBook).toBe(false);
    expect(r.filledUsd).toBeCloseTo(2_000, 0);
  });
});

describe('requiredSize', () => {
  it('returns 0 when target is already crossed at top-of-book (buy side)', () => {
    const book = normalizeBook(TARCISIO_RAW);
    // Best ask is already 0.988. Asking "how much to get top ask >= 0.5"
    // → already true, zero required.
    const r = requiredSize(book.asks, 0.5);
    expect(r.sizeUsd).toBe(0);
    expect(r.reachable).toBe(true);
  });

  it('returns 0 when target is already crossed at top-of-book (sell side)', () => {
    const book = normalizeBook(TARCISIO_RAW);
    // Best bid is 0.003. Asking "how much to drive bid down to <= 0.01" → already true.
    const r = requiredSize(book.bids, 0.01);
    expect(r.sizeUsd).toBe(0);
    expect(r.reachable).toBe(true);
  });

  it('computes cost to push bids from 0.003 → 0.001 (consume two top bid levels)', () => {
    const book = normalizeBook(TARCISIO_RAW);
    // To drive bid down to 0.001 we must consume bids at 0.003 and 0.002.
    // Cost = 0.003*278985.22 + 0.002*402367.19 = 836.96 + 804.73 = $1,641.69.
    const r = requiredSize(book.bids, 0.001);
    expect(r.reachable).toBe(true);
    expect(r.sizeUsd).toBeCloseTo(1641.69, 1);
  });

  it('returns reachable=false when target is beyond visible book depth', () => {
    const book = normalizeBook(TARCISIO_RAW);
    // No bid lower than 0.001 in the book — asking for bid<=0 is impossible
    // from visible depth.
    const r = requiredSize(book.bids, 0);
    expect(r.reachable).toBe(false);
  });
});

describe('forwardImpact — edge cases', () => {
  it('empty side returns thinBook=true and postPrice=NaN', () => {
    const r = forwardImpact([], 10_000);
    expect(r.thinBook).toBe(true);
    expect(Number.isNaN(r.postPrice)).toBe(true);
    expect(Number.isNaN(r.fillVwap)).toBe(true);
    expect(r.sharesAcquired).toBe(0);
    expect(r.filledUsd).toBe(0);
  });

  it('sizeUsd=0 returns a zeroed result without consuming the book', () => {
    const book = normalizeBook(TARCISIO_RAW);
    const r = forwardImpact(book.asks, 0);
    expect(r.sharesAcquired).toBe(0);
    expect(r.filledUsd).toBe(0);
    expect(r.thinBook).toBe(false);
  });

  it('negative sizeUsd is treated like zero (no-op)', () => {
    const book = normalizeBook(TARCISIO_RAW);
    const r = forwardImpact(book.asks, -5_000);
    expect(r.sharesAcquired).toBe(0);
    expect(r.filledUsd).toBe(0);
  });

  it('order exceeding total book depth marks thinBook=true and caps postPrice at 1.0 for asks', () => {
    // Tiny synthetic book on the ask side.
    const asks: Level[] = [
      { price: 0.5, size: 100 }, // cap = $50
      { price: 0.6, size: 50 }, // cap = $30
    ];
    // Request $1000 — way more than the $80 total. Should consume all and
    // mark thin book, with postPrice = 1.0 (the implicit ceiling).
    const r = forwardImpact(asks, 1_000);
    expect(r.thinBook).toBe(true);
    expect(r.postPrice).toBe(1.0);
    expect(r.filledUsd).toBeCloseTo(80, 4);
    expect(r.sharesAcquired).toBeCloseTo(150, 4);
  });

  it('order exceeding total book depth caps postPrice at 0.0 for bids', () => {
    const bids: Level[] = [
      { price: 0.6, size: 100 }, // best (descending)
      { price: 0.5, size: 50 },
    ];
    const r = forwardImpact(bids, 1_000);
    expect(r.thinBook).toBe(true);
    expect(r.postPrice).toBe(0.0);
  });

  it('honors feeBps on filledUsd to produce a feeUsd', () => {
    const book = normalizeBook(TARCISIO_RAW);
    const r = forwardImpact(book.asks, 10_000, { feeBps: 25 });
    // 25 bps of $10k = $25.
    expect(r.feeUsd).toBeCloseTo(25, 4);
  });
});

describe('totalSideUsd & midpoint', () => {
  it('totalSideUsd sums price*size across every level', () => {
    const book = normalizeBook(TARCISIO_RAW);
    // bids: 0.003*278985.22 + 0.002*402367.19 + 0.001*1368050.98
    //     = 836.96 + 804.73 + 1368.05 = 3009.74
    expect(totalSideUsd(book.bids)).toBeCloseTo(3_009.74, 1);
  });

  it('midpoint returns the average of best bid + best ask', () => {
    const book = normalizeBook(TARCISIO_RAW);
    // (0.003 + 0.988) / 2 = 0.4955
    expect(midpoint(book)).toBeCloseTo(0.4955, 4);
  });

  it('midpoint returns null when one side is empty', () => {
    const book = normalizeBook({ ...TARCISIO_RAW, bids: [] });
    expect(midpoint(book)).toBeNull();
  });
});
