/**
 * Rule: outsized_volume_contributor
 *
 * What it catches: a wallet whose contribution to a single market's total
 * traded volume is wildly disproportionate to its peers' contributions in
 * the same window. Concretely: this wallet's share-of-market volume is
 * `k_median_multiple`× the median wallet's share AND the wallet personally
 * owns ≥ `top1_share_pct_threshold` of the market's flow.
 *
 * The double condition matters:
 *   - k-ratio alone catches statistical outliers but fires on tiny markets
 *     where one wallet trading $50 and most wallets trading $1 produces an
 *     enormous ratio with no real signal.
 *   - share-threshold alone catches dominant wallets but misses cases where
 *     2-3 wallets each own 10% (collusion) but no single wallet stands out.
 *   - Together: meaningful market presence AND outlier behavior.
 *
 * Inputs used: ctx.marketVolumes (populated by detector.ts before per-wallet
 * loops) and ctx.trades (this wallet's contribution per market). If
 * marketVolumes is absent the rule returns [] — the cross-wallet view is
 * load-bearing and cannot be reconstructed from a single wallet alone.
 *
 * Status: SEEDED DISABLED. Calibrate k_median_multiple against live data
 * before enabling — the default k=25 is a research-derived starting point
 * (Polymarket Pulse Q3-2024 microstructure note) but not yet validated
 * against AFOS-tracked markets. Flip enabled=true in FlagRule once the
 * false-positive rate is acceptable.
 */
import type { Rule, RuleContext, RuleEvaluation, RuleParams } from './types';

function asNumber(v: RuleParams[string], fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

const HOUR_MS = 3_600_000;

export const outsizedVolumeContributorRule: Rule = {
  key: 'outsized_volume_contributor',
  displayName: 'Outsized volume contributor',
  description:
    'Wallet contributes disproportionate volume to a market vs its peers in the same window.',
  defaultSeverity: 'medium',
  defaultParams: {
    window_hours: 168,
    k_median_multiple: 25,
    top1_share_pct_threshold: 0.15,
  },

  evaluate(ctx: RuleContext, params: RuleParams): RuleEvaluation[] {
    const windowHours = asNumber(params.window_hours, 168);
    const kMedian = asNumber(params.k_median_multiple, 25);
    const top1ShareThreshold = asNumber(params.top1_share_pct_threshold, 0.15);

    // Cross-wallet context absent → can't evaluate; degrade silently.
    if (!ctx.marketVolumes || ctx.marketVolumes.size === 0) return [];
    if (ctx.trades.length === 0) return [];

    const cutoff = Date.now() - windowHours * HOUR_MS;

    // Sum THIS wallet's |valueUsd| per market inside the window.
    const myVolumePerMarket = new Map<string, { usd: number; slug: string }>();
    for (const t of ctx.trades) {
      if (t.tradeTimestamp.getTime() < cutoff) continue;
      const prior = myVolumePerMarket.get(t.marketConditionId);
      const usd = Math.abs(t.valueUsd);
      if (prior) {
        prior.usd += usd;
      } else {
        myVolumePerMarket.set(t.marketConditionId, {
          usd,
          slug: t.marketSlug,
        });
      }
    }
    if (myVolumePerMarket.size === 0) return [];

    const results: RuleEvaluation[] = [];

    for (const [conditionId, my] of myVolumePerMarket) {
      const aggregate = ctx.marketVolumes.get(conditionId);
      if (!aggregate || aggregate.totalUsd <= 0) continue;

      const walletShare = my.usd / aggregate.totalUsd;

      // Both conditions must hold simultaneously.
      // Treat a 0-median market as "every wallet is roughly equal", which
      // means we can't meaningfully compute a multiple — skip those.
      if (aggregate.medianWalletShare <= 0) continue;

      const kRatio = walletShare / aggregate.medianWalletShare;
      if (kRatio < kMedian) continue;
      if (walletShare < top1ShareThreshold) continue;

      results.push({
        triggered: true,
        severity: outsizedVolumeContributorRule.defaultSeverity,
        marketConditionId: conditionId,
        evidence: {
          marketSlug: my.slug,
          walletVolumeUsd: Number(my.usd.toFixed(2)),
          marketTotalVolumeUsd: Number(aggregate.totalUsd.toFixed(2)),
          walletSharePct: Number((walletShare * 100).toFixed(2)),
          medianWalletSharePct: Number(
            (aggregate.medianWalletShare * 100).toFixed(4),
          ),
          kRatio: Number(kRatio.toFixed(2)),
          windowHours,
        },
        explanation:
          `Wallet owns ${(walletShare * 100).toFixed(1)}% of "${my.slug}" volume ` +
          `over the last ${windowHours}h — ${kRatio.toFixed(1)}× the median wallet's ` +
          `share (>= ${kMedian}× threshold) and above the ${(top1ShareThreshold * 100).toFixed(0)}% ` +
          `single-wallet floor.`,
      });
    }

    return results;
  },
};
