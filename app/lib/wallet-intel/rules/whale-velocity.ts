/**
 * Rule: whale_velocity
 *
 * What it catches: a wallet that pushed an unusual volume of USD through
 * trades inside a short rolling window (default: $50k in 1 hour). Sudden
 * bursts of size are how informed actors front-run news drops or pump/dump
 * sequences begin.
 *
 * References:
 *  - Polymarket Pulse #14 — "Velocity outliers preceded 73% of >5pp odds
 *    moves on news-driven markets".
 *  - Generic AMM front-running literature.
 *
 * Inputs used: ctx.trades (sums absolute value within last `window_hours`).
 * Emits a single global evaluation (no marketConditionId).
 */
import type { Rule, RuleContext, RuleEvaluation, RuleParams } from './types';

function asNumber(v: RuleParams[string], fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

export const whaleVelocityRule: Rule = {
  key: 'whale_velocity',
  displayName: 'Whale velocity burst',
  description:
    'Wallet executed an unusually large dollar volume of trades in a short rolling window.',
  defaultSeverity: 'high',
  defaultParams: { window_hours: 1, min_delta_usd: 50000 },

  evaluate(ctx: RuleContext, params: RuleParams): RuleEvaluation[] {
    const windowHours = asNumber(params.window_hours, 1);
    const minDeltaUsd = asNumber(params.min_delta_usd, 50000);

    const cutoff = Date.now() - windowHours * 3_600_000;
    let totalUsd = 0;
    let tradeCount = 0;
    for (const t of ctx.trades) {
      if (t.tradeTimestamp.getTime() < cutoff) continue;
      totalUsd += Math.abs(t.valueUsd);
      tradeCount += 1;
    }

    if (totalUsd <= minDeltaUsd) return [];

    return [
      {
        triggered: true,
        severity: whaleVelocityRule.defaultSeverity,
        evidence: {
          tradeCount,
          totalUsd: Number(totalUsd.toFixed(2)),
          windowHours,
        },
        explanation: `Wallet moved $${totalUsd.toFixed(0)} across ${tradeCount} trades in the last ${windowHours}h (> $${minDeltaUsd} threshold).`,
      },
    ];
  },
};
