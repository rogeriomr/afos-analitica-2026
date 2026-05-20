import { describe, it, expect } from 'vitest';
import { singleMarketFocusRule } from '../single-market-focus';
import { makeWallet, makeTrade } from './_helpers';

describe('singleMarketFocusRule', () => {
  it('triggers when all trades belong to a single market and count >= min_trades', () => {
    const wallet = makeWallet();
    const trades = Array.from({ length: 25 }, (_, i) =>
      makeTrade({
        marketConditionId: '0xmkt-solo',
        marketSlug: 'lone-market',
        valueUsd: 100 + i,
        tradeTimestamp: new Date(Date.now() - i * 60_000),
      }),
    );

    const results = singleMarketFocusRule.evaluate(
      { wallet, positions: [], trades },
      singleMarketFocusRule.defaultParams,
    );

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
    expect(results[0].severity).toBe(singleMarketFocusRule.defaultSeverity);
    expect(results[0].marketConditionId).toBe('0xmkt-solo');
    expect(results[0].evidence).toMatchObject({
      marketSlug: 'lone-market',
      tradeCount: 25,
    });
  });

  it('does not trigger when trade count is below min_trades', () => {
    // 19 trades all on the same market — under the 20-trade threshold.
    const wallet = makeWallet();
    const trades = Array.from({ length: 19 }, () =>
      makeTrade({
        marketConditionId: '0xmkt-solo',
        marketSlug: 'lone-market',
      }),
    );

    const results = singleMarketFocusRule.evaluate(
      { wallet, positions: [], trades },
      singleMarketFocusRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('does not trigger when the wallet has traded on more than one market', () => {
    const wallet = makeWallet();
    const trades = [
      ...Array.from({ length: 20 }, () =>
        makeTrade({
          marketConditionId: '0xmkt-A',
          marketSlug: 'market-a',
        }),
      ),
      makeTrade({
        marketConditionId: '0xmkt-B',
        marketSlug: 'market-b',
      }),
    ];

    const results = singleMarketFocusRule.evaluate(
      { wallet, positions: [], trades },
      singleMarketFocusRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('returns no evaluations when trades array is empty', () => {
    const wallet = makeWallet();

    const results = singleMarketFocusRule.evaluate(
      { wallet, positions: [], trades: [] },
      singleMarketFocusRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('aggregates total USD across all trades (uses abs of valueUsd)', () => {
    const wallet = makeWallet();
    const trades = Array.from({ length: 22 }, (_, i) =>
      makeTrade({
        marketConditionId: '0xmkt-solo',
        marketSlug: 'lone-market',
        // alternate sign — sells have negative valueUsd in our model
        valueUsd: i % 2 === 0 ? 100 : -50,
      }),
    );

    const results = singleMarketFocusRule.evaluate(
      { wallet, positions: [], trades },
      singleMarketFocusRule.defaultParams,
    );

    expect(results).toHaveLength(1);
    // 11 trades at +100 + 11 trades at -50 → abs total = 1100 + 550 = 1650
    expect(results[0].evidence.totalUsd).toBe(1650);
  });
});
