/**
 * Rule: single_market_focus
 *
 * What it catches: a wallet whose entire recent trade history (30 days) is on
 * a single market. Combined with a meaningful trade count, this is a strong
 * indicator of either (a) a wallet purpose-built for one bet (insider-style)
 * or (b) a coordinated participant in a manipulation ring on that market.
 *
 * References:
 *  - "Single-market wallets" appendix in Polymarket integrity reports.
 *  - Comparable to Kalshi's "narrow participant" classifier.
 *
 * Inputs used: ctx.trades (last 30 days). Counts trades per
 * marketConditionId; triggers only if all trades belong to one market AND the
 * count exceeds `min_trades`. Emits one evaluation with that marketConditionId.
 */
import type { Rule, RuleContext, RuleEvaluation, RuleParams } from './types';

function asNumber(v: RuleParams[string], fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

export const singleMarketFocusRule: Rule = {
  key: 'single_market_focus',
  displayName: 'Single-market focus',
  description:
    '100% of recent trades concentrated on one market — narrow participation pattern.',
  defaultSeverity: 'medium',
  defaultParams: { min_trades: 20 },

  evaluate(ctx: RuleContext, params: RuleParams): RuleEvaluation[] {
    const minTrades = asNumber(params.min_trades, 20);
    if (ctx.trades.length < minTrades) return [];

    const buckets = new Map<string, { count: number; totalUsd: number; slug: string }>();
    for (const t of ctx.trades) {
      const cur = buckets.get(t.marketConditionId);
      if (cur) {
        cur.count += 1;
        cur.totalUsd += Math.abs(t.valueUsd);
      } else {
        buckets.set(t.marketConditionId, {
          count: 1,
          totalUsd: Math.abs(t.valueUsd),
          slug: t.marketSlug,
        });
      }
    }

    if (buckets.size !== 1) return [];
    const [marketConditionId, agg] = [...buckets.entries()][0];

    return [
      {
        triggered: true,
        severity: singleMarketFocusRule.defaultSeverity,
        marketConditionId,
        evidence: {
          marketSlug: agg.slug,
          tradeCount: agg.count,
          totalUsd: Number(agg.totalUsd.toFixed(2)),
        },
        explanation: `All ${agg.count} of the wallet's last-30d trades are on "${agg.slug}" ($${agg.totalUsd.toFixed(0)} total).`,
      },
    ];
  },
};
