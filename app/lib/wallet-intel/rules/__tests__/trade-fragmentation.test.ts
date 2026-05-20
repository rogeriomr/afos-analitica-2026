import { describe, it, expect } from 'vitest';
import { tradeFragmentationRule } from '../trade-fragmentation';
import { makeWallet, makeTrade } from './_helpers';

const HOUR_MS = 3_600_000;

describe('tradeFragmentationRule', () => {
  it('triggers when many tiny trades in 24h aggregate to a large total', () => {
    const wallet = makeWallet();
    // 600 trades of $150 each → count > 500, median = 150 < 200, total = $90k > $50k.
    const trades = Array.from({ length: 600 }, (_, i) =>
      makeTrade({
        valueUsd: 150,
        tradeTimestamp: new Date(Date.now() - i * 60_000),
      }),
    );

    const results = tradeFragmentationRule.evaluate(
      { wallet, positions: [], trades },
      tradeFragmentationRule.defaultParams,
    );

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
    expect(results[0].severity).toBe(tradeFragmentationRule.defaultSeverity);
    expect(results[0].evidence).toMatchObject({
      tradeCount24h: 600,
      medianTradeUsd: 150,
      totalUsd24h: 90_000,
    });
  });

  it('does not trigger when trade count is at the threshold (strict >)', () => {
    const wallet = makeWallet();
    // Exactly 500 trades — should NOT trigger (rule uses `tradeCount <= minTrades`).
    const trades = Array.from({ length: 500 }, () =>
      makeTrade({ valueUsd: 150, tradeTimestamp: new Date() }),
    );

    const results = tradeFragmentationRule.evaluate(
      { wallet, positions: [], trades },
      tradeFragmentationRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('does not trigger when median trade size is too large', () => {
    const wallet = makeWallet();
    // 600 trades of $300 each — count and total fine, but median > 200.
    const trades = Array.from({ length: 600 }, () =>
      makeTrade({ valueUsd: 300, tradeTimestamp: new Date() }),
    );

    const results = tradeFragmentationRule.evaluate(
      { wallet, positions: [], trades },
      tradeFragmentationRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('ignores trades older than 24h', () => {
    const wallet = makeWallet();
    // 600 "trades" but all aged > 24h.
    const trades = Array.from({ length: 600 }, () =>
      makeTrade({
        valueUsd: 150,
        tradeTimestamp: new Date(Date.now() - 48 * HOUR_MS),
      }),
    );

    const results = tradeFragmentationRule.evaluate(
      { wallet, positions: [], trades },
      tradeFragmentationRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('returns no evaluations on empty trades array', () => {
    const wallet = makeWallet();

    const results = tradeFragmentationRule.evaluate(
      { wallet, positions: [], trades: [] },
      tradeFragmentationRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });
});
