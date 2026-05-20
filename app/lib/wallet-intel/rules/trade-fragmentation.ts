/**
 * Rule: trade_fragmentation
 *
 * What it catches: a wallet that, in the last 24h, executed a very large
 * number of small trades that together push significant USD volume. Classic
 * "iceberg" / order-splitting pattern used to avoid moving the AMM price and
 * to evade volume-based detection.
 *
 * References:
 *  - SEC Market Manipulation Manual §IV.B — "layering and order splitting".
 *  - Dune dashboards on Polymarket fragmenting wallets (2024-Q4).
 *
 * Inputs used: ctx.trades (last 24h). Computes count, median valueUsd and
 * total valueUsd; triggers when count > min_trades AND median <
 * max_median_size_usd AND total > min_total_usd. Emits a single global
 * evaluation.
 */
import type { Rule, RuleContext, RuleEvaluation, RuleParams } from './types';

function asNumber(v: RuleParams[string], fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export const tradeFragmentationRule: Rule = {
  key: 'trade_fragmentation',
  displayName: 'Trade fragmentation (iceberg)',
  description:
    'Many small trades within 24h aggregating to a large USD total — order-splitting pattern.',
  defaultSeverity: 'high',
  defaultParams: {
    min_trades: 500,
    max_median_size_usd: 200,
    min_total_usd: 50000,
  },

  evaluate(ctx: RuleContext, params: RuleParams): RuleEvaluation[] {
    const minTrades = asNumber(params.min_trades, 500);
    const maxMedianSizeUsd = asNumber(params.max_median_size_usd, 200);
    const minTotalUsd = asNumber(params.min_total_usd, 50000);

    const cutoff = Date.now() - 24 * 3_600_000;
    const sizes: number[] = [];
    let totalUsd = 0;
    for (const t of ctx.trades) {
      if (t.tradeTimestamp.getTime() < cutoff) continue;
      const abs = Math.abs(t.valueUsd);
      sizes.push(abs);
      totalUsd += abs;
    }

    const tradeCount = sizes.length;
    if (tradeCount <= minTrades) return [];
    const med = median(sizes);
    if (med >= maxMedianSizeUsd) return [];
    if (totalUsd <= minTotalUsd) return [];

    return [
      {
        triggered: true,
        severity: tradeFragmentationRule.defaultSeverity,
        evidence: {
          tradeCount24h: tradeCount,
          medianTradeUsd: Number(med.toFixed(2)),
          totalUsd24h: Number(totalUsd.toFixed(2)),
        },
        explanation: `${tradeCount} trades in 24h with median $${med.toFixed(0)} totaling $${totalUsd.toFixed(0)} — fragmentation pattern.`,
      },
    ];
  },
};
