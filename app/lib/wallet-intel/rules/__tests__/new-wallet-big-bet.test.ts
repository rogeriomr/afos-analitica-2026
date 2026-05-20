import { describe, it, expect } from 'vitest';
import { newWalletBigBetRule } from '../new-wallet-big-bet';
import { makeWallet, makePosition } from './_helpers';

const DAY_MS = 86_400_000;

describe('newWalletBigBetRule', () => {
  it('triggers when a young wallet holds a position above min_value_usd', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * DAY_MS);
    const wallet = makeWallet({ chainFirstActivityAt: fiveDaysAgo });
    const positions = [
      makePosition({
        currentValueUsd: 25_000,
        marketSlug: 'us-election-2024',
        marketConditionId: '0xmarketA',
      }),
    ];

    const results = newWalletBigBetRule.evaluate(
      { wallet, positions, trades: [] },
      newWalletBigBetRule.defaultParams,
    );

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
    expect(results[0].severity).toBe(newWalletBigBetRule.defaultSeverity);
    expect(results[0].marketConditionId).toBe('0xmarketA');
    expect(results[0].evidence).toHaveProperty('walletAgeDays');
    expect(results[0].evidence).toHaveProperty('biggestPositionUsd', 25_000);
    expect(results[0].evidence).toHaveProperty(
      'biggestPositionMarket',
      'us-election-2024',
    );
  });

  it('does not trigger when wallet is just over the age threshold', () => {
    // max_age_days is 30; the rule uses strict `< maxAgeDays * DAY_MS`, so
    // exactly 30 days old should NOT trigger.
    const justOver = new Date(Date.now() - 30 * DAY_MS - 1000);
    const wallet = makeWallet({ chainFirstActivityAt: justOver });
    const positions = [makePosition({ currentValueUsd: 100_000 })];

    const results = newWalletBigBetRule.evaluate(
      { wallet, positions, trades: [] },
      newWalletBigBetRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('does not trigger when position value is just below the threshold', () => {
    const wallet = makeWallet({
      chainFirstActivityAt: new Date(Date.now() - 2 * DAY_MS),
    });
    // Strict `> minValueUsd`: exactly 10_000 should NOT trigger.
    const positions = [makePosition({ currentValueUsd: 10_000 })];

    const results = newWalletBigBetRule.evaluate(
      { wallet, positions, trades: [] },
      newWalletBigBetRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('falls back to firstSeenAt when chainFirstActivityAt is null', () => {
    const wallet = makeWallet({
      chainFirstActivityAt: null,
      firstSeenAt: new Date(Date.now() - 3 * DAY_MS),
    });
    const positions = [makePosition({ currentValueUsd: 15_000 })];

    const results = newWalletBigBetRule.evaluate(
      { wallet, positions, trades: [] },
      newWalletBigBetRule.defaultParams,
    );

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
  });

  it('returns no evaluations when the wallet has no positions', () => {
    const wallet = makeWallet({
      chainFirstActivityAt: new Date(Date.now() - 1 * DAY_MS),
    });

    const results = newWalletBigBetRule.evaluate(
      { wallet, positions: [], trades: [] },
      newWalletBigBetRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('emits one evaluation per qualifying position', () => {
    const wallet = makeWallet({
      chainFirstActivityAt: new Date(Date.now() - 7 * DAY_MS),
    });
    const positions = [
      makePosition({
        currentValueUsd: 11_000,
        marketConditionId: '0xmarketA',
        marketSlug: 'a',
      }),
      makePosition({
        currentValueUsd: 50_000,
        marketConditionId: '0xmarketB',
        marketSlug: 'b',
      }),
      makePosition({
        currentValueUsd: 5_000, // below threshold — should NOT count
        marketConditionId: '0xmarketC',
        marketSlug: 'c',
      }),
    ];

    const results = newWalletBigBetRule.evaluate(
      { wallet, positions, trades: [] },
      newWalletBigBetRule.defaultParams,
    );

    expect(results).toHaveLength(2);
    const slugs = results.map((r) => r.evidence.biggestPositionMarket).sort();
    expect(slugs).toEqual(['a', 'b']);
  });
});
