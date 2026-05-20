import { describe, it, expect } from 'vitest';
import { concentrationUnilateralRule } from '../concentration-unilateral';
import { makeWallet, makeHolderSnapshot } from './_helpers';

const WALLET_ADDR = '0x' + 'a'.repeat(40);
const OTHER_ADDR_1 = '0x' + 'b'.repeat(40);
const OTHER_ADDR_2 = '0x' + 'c'.repeat(40);

describe('concentrationUnilateralRule', () => {
  it('triggers when wallet holds > pct_threshold of one outcome', () => {
    const wallet = makeWallet({ proxyAddress: WALLET_ADDR });
    const snapshot = makeHolderSnapshot({
      marketConditionId: '0xmkt1',
      marketSlug: 'mkt-1',
      holdersJson: [
        { holder: WALLET_ADDR, amount: 6000, outcomeIndex: 0 },
        { holder: OTHER_ADDR_1, amount: 2000, outcomeIndex: 0 },
        { holder: OTHER_ADDR_2, amount: 1000, outcomeIndex: 0 },
      ],
    });
    const marketHolders = new Map([['0xmkt1', snapshot]]);

    const results = concentrationUnilateralRule.evaluate(
      { wallet, positions: [], trades: [], marketHolders },
      concentrationUnilateralRule.defaultParams,
    );

    // wallet share = 6000/9000 ≈ 0.6667 > 0.4
    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
    expect(results[0].severity).toBe(concentrationUnilateralRule.defaultSeverity);
    expect(results[0].marketConditionId).toBe('0xmkt1');
    expect(results[0].evidence).toMatchObject({
      marketSlug: 'mkt-1',
      outcomeIndex: 0,
    });
    expect(results[0].evidence.sharePct as number).toBeGreaterThan(0.4);
  });

  it('does not trigger when wallet share is just at the threshold', () => {
    const wallet = makeWallet({ proxyAddress: WALLET_ADDR });
    // wallet share = 4000/10000 = 0.4 — the rule requires strict `>`, so this
    // should NOT trigger.
    const snapshot = makeHolderSnapshot({
      holdersJson: [
        { holder: WALLET_ADDR, amount: 4000, outcomeIndex: 0 },
        { holder: OTHER_ADDR_1, amount: 6000, outcomeIndex: 0 },
      ],
    });
    const marketHolders = new Map([
      [snapshot.marketConditionId, snapshot],
    ]);

    const results = concentrationUnilateralRule.evaluate(
      { wallet, positions: [], trades: [], marketHolders },
      concentrationUnilateralRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('matches addresses case-insensitively', () => {
    const wallet = makeWallet({ proxyAddress: WALLET_ADDR.toUpperCase() });
    const snapshot = makeHolderSnapshot({
      holdersJson: [
        { holder: WALLET_ADDR.toLowerCase(), amount: 8000, outcomeIndex: 1 },
        { holder: OTHER_ADDR_1, amount: 2000, outcomeIndex: 1 },
      ],
    });
    const marketHolders = new Map([
      [snapshot.marketConditionId, snapshot],
    ]);

    const results = concentrationUnilateralRule.evaluate(
      { wallet, positions: [], trades: [], marketHolders },
      concentrationUnilateralRule.defaultParams,
    );

    expect(results).toHaveLength(1);
    expect(results[0].evidence.outcomeIndex).toBe(1);
  });

  it('returns no evaluations when marketHolders is undefined', () => {
    const wallet = makeWallet({ proxyAddress: WALLET_ADDR });

    const results = concentrationUnilateralRule.evaluate(
      { wallet, positions: [], trades: [] },
      concentrationUnilateralRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('returns no evaluations when marketHolders map is empty', () => {
    const wallet = makeWallet({ proxyAddress: WALLET_ADDR });

    const results = concentrationUnilateralRule.evaluate(
      { wallet, positions: [], trades: [], marketHolders: new Map() },
      concentrationUnilateralRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });

  it('returns no evaluations when wallet does not appear in holders list', () => {
    const wallet = makeWallet({ proxyAddress: WALLET_ADDR });
    const snapshot = makeHolderSnapshot({
      holdersJson: [
        { holder: OTHER_ADDR_1, amount: 9000, outcomeIndex: 0 },
        { holder: OTHER_ADDR_2, amount: 1000, outcomeIndex: 0 },
      ],
    });
    const marketHolders = new Map([
      [snapshot.marketConditionId, snapshot],
    ]);

    const results = concentrationUnilateralRule.evaluate(
      { wallet, positions: [], trades: [], marketHolders },
      concentrationUnilateralRule.defaultParams,
    );

    expect(results).toHaveLength(0);
  });
});
