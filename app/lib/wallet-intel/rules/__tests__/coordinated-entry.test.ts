import { describe, it, expect } from 'vitest';
import { coordinatedEntryRule } from '../coordinated-entry';
import { makeWallet, makeTrade } from './_helpers';

const SELF_WALLET_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_W1 = '00000000-0000-0000-0000-000000000002';
const OTHER_W2 = '00000000-0000-0000-0000-000000000003';
const OTHER_W3 = '00000000-0000-0000-0000-000000000004';
const OTHER_W4 = '00000000-0000-0000-0000-000000000005';

describe('coordinatedEntryRule', () => {
  it('triggers when >=3 distinct other wallets traded the same side within window', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const anchorTs = new Date();
    const trades = [
      makeTrade({
        walletId: SELF_WALLET_ID,
        marketConditionId: '0xmktA',
        marketSlug: 'market-a',
        side: 'BUY',
        tradeTimestamp: anchorTs,
      }),
    ];
    const coordinationGroup = [
      // Self in group should be excluded — irrelevant to the count.
      {
        walletId: SELF_WALLET_ID,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 100,
        tradeTimestamp: anchorTs,
      },
      {
        walletId: OTHER_W1,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 200,
        tradeTimestamp: new Date(anchorTs.getTime() + 60_000),
      },
      {
        walletId: OTHER_W2,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 300,
        tradeTimestamp: new Date(anchorTs.getTime() - 60_000),
      },
      {
        walletId: OTHER_W3,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 400,
        tradeTimestamp: new Date(anchorTs.getTime() + 120_000),
      },
    ];

    const results = coordinatedEntryRule.evaluate(
      { wallet, positions: [], trades, coordinationGroup },
      coordinatedEntryRule.defaultParams,
    );

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
    expect(results[0].severity).toBe(coordinatedEntryRule.defaultSeverity);
    expect(results[0].marketConditionId).toBe('0xmktA');
    expect(results[0].evidence).toMatchObject({
      marketSlug: 'market-a',
      side: 'BUY',
      coordinatedWalletCount: 3,
    });
  });

  it('does not trigger when fewer than min_coordinated_wallets are within window', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const anchorTs = new Date();
    const trades = [
      makeTrade({
        walletId: SELF_WALLET_ID,
        marketConditionId: '0xmktA',
        marketSlug: 'market-a',
        side: 'BUY',
        tradeTimestamp: anchorTs,
      }),
    ];
    // Only 2 other wallets within window — below default min of 3.
    const coordinationGroup = [
      {
        walletId: OTHER_W1,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 200,
        tradeTimestamp: new Date(anchorTs.getTime() + 60_000),
      },
      {
        walletId: OTHER_W2,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 200,
        tradeTimestamp: new Date(anchorTs.getTime() - 60_000),
      },
    ];

    const results = coordinatedEntryRule.evaluate(
      { wallet, positions: [], trades, coordinationGroup },
      coordinatedEntryRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('ignores group trades outside the time window', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const anchorTs = new Date();
    const trades = [
      makeTrade({
        walletId: SELF_WALLET_ID,
        marketConditionId: '0xmktA',
        marketSlug: 'market-a',
        side: 'BUY',
        tradeTimestamp: anchorTs,
      }),
    ];
    // window_seconds default = 600 (10 min). Place 3 wallets 20 minutes away.
    const farAway = (sign: number) =>
      new Date(anchorTs.getTime() + sign * 20 * 60_000);
    const coordinationGroup = [
      {
        walletId: OTHER_W1,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 1,
        tradeTimestamp: farAway(1),
      },
      {
        walletId: OTHER_W2,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 1,
        tradeTimestamp: farAway(-1),
      },
      {
        walletId: OTHER_W3,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 1,
        tradeTimestamp: farAway(1),
      },
    ];

    const results = coordinatedEntryRule.evaluate(
      { wallet, positions: [], trades, coordinationGroup },
      coordinatedEntryRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('does not double-count the same wallet appearing multiple times in the group', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const anchorTs = new Date();
    const trades = [
      makeTrade({
        walletId: SELF_WALLET_ID,
        marketConditionId: '0xmktA',
        marketSlug: 'market-a',
        side: 'BUY',
        tradeTimestamp: anchorTs,
      }),
    ];
    // OTHER_W1 appears 3 times inside window — should count as ONE distinct
    // wallet, so the min-3 threshold is not satisfied.
    const coordinationGroup = [
      {
        walletId: OTHER_W1,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 1,
        tradeTimestamp: new Date(anchorTs.getTime() + 30_000),
      },
      {
        walletId: OTHER_W1,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 1,
        tradeTimestamp: new Date(anchorTs.getTime() + 60_000),
      },
      {
        walletId: OTHER_W1,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 1,
        tradeTimestamp: new Date(anchorTs.getTime() - 60_000),
      },
      {
        walletId: OTHER_W2,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 1,
        tradeTimestamp: new Date(anchorTs.getTime() - 30_000),
      },
    ];

    const results = coordinatedEntryRule.evaluate(
      { wallet, positions: [], trades, coordinationGroup },
      coordinatedEntryRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('returns no evaluations when coordinationGroup is undefined', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const trades = [
      makeTrade({
        walletId: SELF_WALLET_ID,
        marketConditionId: '0xmktA',
        side: 'BUY',
      }),
    ];

    const results = coordinatedEntryRule.evaluate(
      { wallet, positions: [], trades },
      coordinatedEntryRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('returns no evaluations when wallet has no anchor trades in the last 24h', () => {
    const wallet = makeWallet({ id: SELF_WALLET_ID });
    const trades: ReturnType<typeof makeTrade>[] = [];
    const coordinationGroup = [
      {
        walletId: OTHER_W1,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 100,
        tradeTimestamp: new Date(),
      },
      {
        walletId: OTHER_W2,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 100,
        tradeTimestamp: new Date(),
      },
      {
        walletId: OTHER_W3,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 100,
        tradeTimestamp: new Date(),
      },
      {
        walletId: OTHER_W4,
        marketConditionId: '0xmktA',
        side: 'BUY' as const,
        valueUsd: 100,
        tradeTimestamp: new Date(),
      },
    ];

    const results = coordinatedEntryRule.evaluate(
      { wallet, positions: [], trades, coordinationGroup },
      coordinatedEntryRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });
});
