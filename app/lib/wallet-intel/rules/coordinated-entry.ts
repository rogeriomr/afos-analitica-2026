/**
 * Rule: coordinated_entry
 *
 * What it catches: multiple distinct wallets entering the same side of the
 * same market within a tight time window (default: ≥3 other wallets within
 * ±600s of this wallet's trade). Pattern signals a coordinated buy/sell ring
 * — e.g. a manipulation group, a leak being acted on, or a Telegram pump.
 *
 * References:
 *  - "Wallet co-movement" methodology — Arkham Intel research, 2024.
 *  - Polymarket integrity reports on synchronized YES-bias clusters during
 *    the 2024 US election period.
 *
 * Inputs used: ctx.trades (this wallet's last-24h trades, used as ANCHORS)
 * and ctx.coordinationGroup (all wallets' last-24h trades, supplied by the
 * detector). The rule is unusual: it requires a cross-wallet view, so the
 * detector must populate `coordinationGroup` before evaluating it — every
 * other rule sees `coordinationGroup` as undefined.
 *
 * For each (market, side) the wallet participated in within the last 24h,
 * count the number of DISTINCT OTHER wallets in the group whose trade falls
 * inside ±window_seconds of any of this wallet's trades on that (market, side).
 * If that count >= min_coordinated_wallets, emit one evaluation per group.
 *
 * Default min_coordinated_wallets is 3 — 4 was too strict for our 30-holder
 * snapshot window (we rarely observe 4+ coordinated holders even in known
 * pump events). 3 keeps false-positives manageable while catching realistic
 * coordination rings. Tune via FlagRule.paramsJson without redeploy.
 */
import type { Rule, RuleContext, RuleEvaluation, RuleParams } from './types';

function asNumber(v: RuleParams[string], fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

function isSide(value: string): value is 'BUY' | 'SELL' {
  return value === 'BUY' || value === 'SELL';
}

export const coordinatedEntryRule: Rule = {
  key: 'coordinated_entry',
  displayName: 'Coordinated entry',
  description:
    'Multiple distinct wallets entered the same market side within a tight time window.',
  defaultSeverity: 'medium',
  defaultParams: { min_coordinated_wallets: 3, window_seconds: 600 },

  evaluate(ctx: RuleContext, params: RuleParams): RuleEvaluation[] {
    const minCoordinated = asNumber(params.min_coordinated_wallets, 3);
    const windowSeconds = asNumber(params.window_seconds, 600);
    const windowMs = windowSeconds * 1000;

    if (!ctx.coordinationGroup || ctx.coordinationGroup.length === 0) return [];

    const cutoff = Date.now() - 24 * 3_600_000;
    const selfWalletId = ctx.wallet.id;

    // Index this wallet's last-24h trades by (marketConditionId|side).
    const anchors = new Map<
      string,
      Array<{ ts: number; marketConditionId: string; side: 'BUY' | 'SELL'; marketSlug: string }>
    >();
    for (const t of ctx.trades) {
      if (t.tradeTimestamp.getTime() < cutoff) continue;
      if (!isSide(t.side)) continue;
      const key = `${t.marketConditionId}|${t.side}`;
      const bucket = anchors.get(key) ?? [];
      bucket.push({
        ts: t.tradeTimestamp.getTime(),
        marketConditionId: t.marketConditionId,
        side: t.side,
        marketSlug: t.marketSlug,
      });
      anchors.set(key, bucket);
    }
    if (anchors.size === 0) return [];

    // Index the coordination group by (marketConditionId|side) too — exclude self.
    const groupIndex = new Map<
      string,
      Array<{ walletId: string; ts: number }>
    >();
    for (const g of ctx.coordinationGroup) {
      if (g.walletId === selfWalletId) continue;
      const key = `${g.marketConditionId}|${g.side}`;
      const bucket = groupIndex.get(key) ?? [];
      bucket.push({ walletId: g.walletId, ts: g.tradeTimestamp.getTime() });
      groupIndex.set(key, bucket);
    }

    const results: RuleEvaluation[] = [];
    for (const [key, anchorList] of anchors) {
      const groupList = groupIndex.get(key);
      if (!groupList || groupList.length === 0) continue;

      // Find the anchor with the most coordinated wallets nearby.
      let bestCount = 0;
      let bestAnchorTs = anchorList[0].ts;
      const bestWallets = new Set<string>();

      for (const anchor of anchorList) {
        const matches = new Set<string>();
        for (const g of groupList) {
          if (Math.abs(g.ts - anchor.ts) <= windowMs) {
            matches.add(g.walletId);
          }
        }
        if (matches.size > bestCount) {
          bestCount = matches.size;
          bestAnchorTs = anchor.ts;
          bestWallets.clear();
          for (const w of matches) bestWallets.add(w);
        }
      }

      if (bestCount < minCoordinated) continue;

      const { marketConditionId, marketSlug } = anchorList[0];
      const side = anchorList[0].side;
      results.push({
        triggered: true,
        severity: coordinatedEntryRule.defaultSeverity,
        marketConditionId,
        evidence: {
          marketSlug,
          side,
          coordinatedWalletCount: bestCount,
          anchorTradeTimestamp: new Date(bestAnchorTs).toISOString(),
        },
        explanation: `${bestCount} other distinct wallets traded ${side} on "${marketSlug}" within ±${windowSeconds}s of this wallet (>= ${minCoordinated} threshold).`,
      });
    }

    return results;
  },
};
