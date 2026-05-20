/**
 * Rule: new_wallet_big_bet
 *
 * What it catches: a freshly-created wallet (first seen in the last N days)
 * that already holds a single position worth more than $X. Pattern is a strong
 * signal of an experienced operator opening a sock-puppet to avoid linkage
 * with their established address — a tactic frequently observed ahead of
 * controversial market resolutions.
 *
 * References:
 *  - Polymarket integrity reports (2024-Q4) — flagged wallets created < 14d
 *    before opening $10k+ positions on US-election outcome markets.
 *  - On-chain heuristics: Chainalysis "Sybil patterns in prediction markets".
 *
 * Inputs used: wallet.chainFirstActivityAt (preferred — on-chain age),
 * falling back to wallet.firstSeenAt (when AFOS first observed the wallet)
 * for rows ingested before the chain-age backfill ran. positions[].currentValueUsd.
 *
 * Default min_value_usd is $10k — a reasonable retail-vs-whale threshold for
 * "this is a real position, not noise." Admins can tune via FlagRule.paramsJson
 * without redeploy (see seedFlagRules → update branch preserves admin edits).
 *
 * Emits one evaluation per qualifying position (so multiple big bets on
 * different markets surface as distinct rows for triage).
 */
import type { Rule, RuleContext, RuleEvaluation, RuleParams } from './types';

const DAY_MS = 86_400_000;

function asNumber(v: RuleParams[string], fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

export const newWalletBigBetRule: Rule = {
  key: 'new_wallet_big_bet',
  displayName: 'New wallet, large position',
  description:
    'Wallet created recently is already holding a position above the size threshold — common sock-puppet pattern.',
  defaultSeverity: 'high',
  defaultParams: { max_age_days: 30, min_value_usd: 10000 },

  evaluate(ctx: RuleContext, params: RuleParams): RuleEvaluation[] {
    const maxAgeDays = asNumber(params.max_age_days, 30);
    const minValueUsd = asNumber(params.min_value_usd, 10000);

    // Prefer chainFirstActivityAt (true on-chain wallet age). Fall back to
    // firstSeenAt for wallets ingested before the chain-age backfill (or for
    // which we have no trades to derive a chain timestamp from). This preserves
    // pre-fix behavior on legacy rows without overcounting "new" wallets.
    const ageReferenceTs =
      ctx.wallet.chainFirstActivityAt?.getTime() ?? ctx.wallet.firstSeenAt.getTime();
    const ageMs = Date.now() - ageReferenceTs;
    const isNew = ageMs < maxAgeDays * DAY_MS;
    if (!isNew) return [];

    const walletAgeDays = ageMs / DAY_MS;
    const qualifying = ctx.positions.filter(
      (p) => p.currentValueUsd > minValueUsd,
    );
    if (qualifying.length === 0) return [];

    return qualifying.map((p) => ({
      triggered: true,
      severity: newWalletBigBetRule.defaultSeverity,
      marketConditionId: p.marketConditionId,
      evidence: {
        walletAgeDays: Number(walletAgeDays.toFixed(2)),
        biggestPositionUsd: Number(p.currentValueUsd.toFixed(2)),
        biggestPositionMarket: p.marketSlug,
      },
      explanation: `Wallet is ${walletAgeDays.toFixed(1)} days old (< ${maxAgeDays}d threshold) and holds a $${p.currentValueUsd.toFixed(0)} position on "${p.marketSlug}".`,
    }));
  },
};
