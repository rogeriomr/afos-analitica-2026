import { describe, it, expect } from 'vitest';
import { whaleVelocityRule } from '../whale-velocity';
import { makeWallet, makeTrade } from './_helpers';

const HOUR_MS = 3_600_000;

describe('whaleVelocityRule', () => {
  it('triggers when total trade volume inside the window exceeds min_delta_usd', () => {
    const wallet = makeWallet();
    const now = Date.now();
    const trades = [
      makeTrade({
        valueUsd: 30_000,
        tradeTimestamp: new Date(now - 10 * 60 * 1000),
      }),
      makeTrade({
        valueUsd: 25_000,
        tradeTimestamp: new Date(now - 20 * 60 * 1000),
      }),
    ];

    const results = whaleVelocityRule.evaluate(
      { wallet, positions: [], trades },
      whaleVelocityRule.defaultParams,
    );

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
    expect(results[0].severity).toBe(whaleVelocityRule.defaultSeverity);
    expect(results[0].marketConditionId).toBeUndefined();
    expect(results[0].evidence).toMatchObject({
      tradeCount: 2,
      totalUsd: 55_000,
      windowHours: 1,
    });
  });

  it('does not trigger when total is exactly at the threshold (strict >)', () => {
    const wallet = makeWallet();
    const now = Date.now();
    const trades = [
      makeTrade({
        valueUsd: 50_000,
        tradeTimestamp: new Date(now - 5 * 60 * 1000),
      }),
    ];

    const results = whaleVelocityRule.evaluate(
      { wallet, positions: [], trades },
      whaleVelocityRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('ignores trades older than window_hours', () => {
    const wallet = makeWallet();
    const now = Date.now();
    const trades = [
      makeTrade({
        valueUsd: 80_000,
        tradeTimestamp: new Date(now - 3 * HOUR_MS),
      }),
      makeTrade({
        valueUsd: 100,
        tradeTimestamp: new Date(now - 10 * 60 * 1000),
      }),
    ];

    const results = whaleVelocityRule.evaluate(
      { wallet, positions: [], trades },
      whaleVelocityRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('sums absolute values (sells with negative valueUsd still count)', () => {
    const wallet = makeWallet();
    const now = Date.now();
    const trades = [
      makeTrade({
        valueUsd: -40_000,
        side: 'SELL',
        tradeTimestamp: new Date(now - 5 * 60 * 1000),
      }),
      makeTrade({
        valueUsd: 30_000,
        side: 'BUY',
        tradeTimestamp: new Date(now - 15 * 60 * 1000),
      }),
    ];

    const results = whaleVelocityRule.evaluate(
      { wallet, positions: [], trades },
      whaleVelocityRule.defaultParams,
    );

    expect(results).toHaveLength(1);
    expect(results[0].evidence.totalUsd).toBe(70_000);
    expect(results[0].evidence.tradeCount).toBe(2);
  });

  it('returns no evaluations on empty trades array', () => {
    const wallet = makeWallet();

    const results = whaleVelocityRule.evaluate(
      { wallet, positions: [], trades: [] },
      whaleVelocityRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });
});
