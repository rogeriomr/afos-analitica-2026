/**
 * Tests for the outsized_volume_contributor rule.
 *
 * The rule's signal requires BOTH a k-ratio above threshold (this wallet's
 * share-of-market / median wallet's share-of-market) AND a top1-share floor
 * (this wallet must hold ≥ X% of total market volume). Tests below
 * exhaustively exercise the boundary, the floor, the cross-wallet-absence
 * fallback, and the no-trades fallback.
 */
import { describe, it, expect } from 'vitest';
import { outsizedVolumeContributorRule } from '../outsized-volume-contributor';
import type { MarketVolumeContext } from '../types';
import { makeWallet, makeTrade } from './_helpers';

const SELF_WALLET_ID = '00000000-0000-0000-0000-000000000001';
const MARKET_A = '0xmktA';

describe('outsizedVolumeContributorRule', () => {
  it('triggers when walletShare is >= k× median AND above the top1 floor', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const trades = [
      makeTrade({
        walletId: SELF_WALLET_ID,
        marketConditionId: MARKET_A,
        marketSlug: 'market-a',
        side: 'BUY',
        valueUsd: 30_000,
        tradeTimestamp: new Date(),
      }),
    ];
    // Aggregate: market totals $100k; this wallet contributed $30k → share=0.30
    // Median wallet share = 0.01 → k-ratio = 30 (above default 25). Floor 0.15
    // satisfied. → should trigger.
    const marketVolumes = new Map<string, MarketVolumeContext>([
      [
        MARKET_A,
        { totalUsd: 100_000, medianWalletShare: 0.01, top1Share: 0.30 },
      ],
    ]);

    const results = outsizedVolumeContributorRule.evaluate(
      { wallet, positions: [], trades, marketVolumes },
      outsizedVolumeContributorRule.defaultParams,
    );

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
    expect(results[0].marketConditionId).toBe(MARKET_A);
    expect(results[0].severity).toBe(outsizedVolumeContributorRule.defaultSeverity);
    expect(results[0].evidence).toMatchObject({
      marketSlug: 'market-a',
      walletVolumeUsd: 30_000,
      marketTotalVolumeUsd: 100_000,
    });
  });

  it('does not trigger when k-ratio is just below threshold (24× median)', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const trades = [
      makeTrade({
        walletId: SELF_WALLET_ID,
        marketConditionId: MARKET_A,
        marketSlug: 'market-a',
        side: 'BUY',
        valueUsd: 24_000,
        tradeTimestamp: new Date(),
      }),
    ];
    // walletShare = 0.24, median = 0.01 → k-ratio = 24 (default threshold 25).
    const marketVolumes = new Map<string, MarketVolumeContext>([
      [
        MARKET_A,
        { totalUsd: 100_000, medianWalletShare: 0.01, top1Share: 0.24 },
      ],
    ]);

    const results = outsizedVolumeContributorRule.evaluate(
      { wallet, positions: [], trades, marketVolumes },
      outsizedVolumeContributorRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('does not trigger when k-ratio passes but top1 share is below the floor', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const trades = [
      makeTrade({
        walletId: SELF_WALLET_ID,
        marketConditionId: MARKET_A,
        marketSlug: 'market-a',
        side: 'BUY',
        valueUsd: 1_000,
        tradeTimestamp: new Date(),
      }),
    ];
    // walletShare = 0.10, median = 0.001 → k-ratio = 100 (way above 25).
    // But share 10% < default floor 15% → should NOT trigger.
    const marketVolumes = new Map<string, MarketVolumeContext>([
      [
        MARKET_A,
        { totalUsd: 10_000, medianWalletShare: 0.001, top1Share: 0.10 },
      ],
    ]);

    const results = outsizedVolumeContributorRule.evaluate(
      { wallet, positions: [], trades, marketVolumes },
      outsizedVolumeContributorRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('returns [] when marketVolumes is undefined (cross-wallet view absent)', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const trades = [
      makeTrade({
        walletId: SELF_WALLET_ID,
        marketConditionId: MARKET_A,
        valueUsd: 50_000,
      }),
    ];

    const results = outsizedVolumeContributorRule.evaluate(
      { wallet, positions: [], trades },
      outsizedVolumeContributorRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('returns [] when wallet has no trades', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const marketVolumes = new Map<string, MarketVolumeContext>([
      [MARKET_A, { totalUsd: 100_000, medianWalletShare: 0.01, top1Share: 0.30 }],
    ]);

    const results = outsizedVolumeContributorRule.evaluate(
      { wallet, positions: [], trades: [], marketVolumes },
      outsizedVolumeContributorRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('ignores trades outside the window_hours horizon', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    // Trade is 200h old (default window 168h).
    const oldTs = new Date(Date.now() - 200 * 3_600_000);
    const trades = [
      makeTrade({
        walletId: SELF_WALLET_ID,
        marketConditionId: MARKET_A,
        valueUsd: 30_000,
        tradeTimestamp: oldTs,
      }),
    ];
    const marketVolumes = new Map<string, MarketVolumeContext>([
      [MARKET_A, { totalUsd: 100_000, medianWalletShare: 0.01, top1Share: 0.30 }],
    ]);

    const results = outsizedVolumeContributorRule.evaluate(
      { wallet, positions: [], trades, marketVolumes },
      outsizedVolumeContributorRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('returns [] when median is zero (cannot compute multiple)', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const trades = [
      makeTrade({
        walletId: SELF_WALLET_ID,
        marketConditionId: MARKET_A,
        valueUsd: 50_000,
        tradeTimestamp: new Date(),
      }),
    ];
    const marketVolumes = new Map<string, MarketVolumeContext>([
      // medianWalletShare = 0 (e.g. only-this-wallet market) → not a meaningful
      // multiple; rule must abstain rather than divide-by-zero.
      [MARKET_A, { totalUsd: 100_000, medianWalletShare: 0, top1Share: 0.50 }],
    ]);

    const results = outsizedVolumeContributorRule.evaluate(
      { wallet, positions: [], trades, marketVolumes },
      outsizedVolumeContributorRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });
});
