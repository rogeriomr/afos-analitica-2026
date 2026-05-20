/**
 * Rule: concentration_unilateral
 *
 * What it catches: a single wallet that owns a disproportionate share of one
 * side of a market (i.e. dominates the visible holders for a given
 * outcomeIndex). High concentration on one outcome is the canonical price-
 * manipulation primitive — the holder can move the AMM curve nearly at will.
 *
 * References:
 *  - "Liquidity concentration & price manipulation in CPMM markets",
 *    Polymarket research blog, 2024.
 *  - SEC guidance on order-book concentration as a manipulation indicator.
 *
 * Inputs used: ctx.marketHolders (latest snapshot per market), ctx.wallet.proxyAddress.
 * Walks holdersJson per market; computes this wallet's share of the total
 * amount visible for that outcome. Emits one evaluation per qualifying market.
 *
 * Default pct_threshold is 0.40 — conservative against the visible top-30
 * holder window we snapshot (small samples skew high naturally). Admins can
 * LOWER this via FlagRule.paramsJson for low-volume markets where 30% really
 * is anomalous, without redeploying.
 *
 * Note: holdersJson is an array of { holder, amount, outcomeIndex, ... } —
 * see app/lib/wallet-intel/types.ts → PolymarketHolder.
 */
import type {
  Rule,
  RuleContext,
  RuleEvaluation,
  RuleParams,
} from './types';

interface HolderEntry {
  holder?: string;
  amount?: number;
  outcomeIndex?: number;
}

function asNumber(v: RuleParams[string], fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

function parseHolders(raw: unknown): HolderEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HolderEntry[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const holder = typeof rec.holder === 'string' ? rec.holder : undefined;
    const amount = typeof rec.amount === 'number' ? rec.amount : undefined;
    const outcomeIndex =
      typeof rec.outcomeIndex === 'number' ? rec.outcomeIndex : undefined;
    out.push({ holder, amount, outcomeIndex });
  }
  return out;
}

export const concentrationUnilateralRule: Rule = {
  key: 'concentration_unilateral',
  displayName: 'Unilateral concentration on one outcome',
  description:
    'Wallet controls a disproportionate share of one outcome on a market — manipulation surface.',
  defaultSeverity: 'medium',
  defaultParams: { pct_threshold: 0.4 },

  evaluate(ctx: RuleContext, params: RuleParams): RuleEvaluation[] {
    const pctThreshold = asNumber(params.pct_threshold, 0.4);
    if (!ctx.marketHolders || ctx.marketHolders.size === 0) return [];

    const walletAddr = ctx.wallet.proxyAddress.toLowerCase();
    const results: RuleEvaluation[] = [];

    for (const [marketConditionId, snapshot] of ctx.marketHolders) {
      const holders = parseHolders(snapshot.holdersJson);
      if (holders.length === 0) continue;

      // Group totals per outcomeIndex and capture this wallet's amount per outcome.
      const totals = new Map<number, number>();
      const walletAmtByOutcome = new Map<number, number>();
      for (const h of holders) {
        if (typeof h.outcomeIndex !== 'number' || typeof h.amount !== 'number')
          continue;
        totals.set(h.outcomeIndex, (totals.get(h.outcomeIndex) ?? 0) + h.amount);
        if (typeof h.holder === 'string' && h.holder.toLowerCase() === walletAddr) {
          walletAmtByOutcome.set(
            h.outcomeIndex,
            (walletAmtByOutcome.get(h.outcomeIndex) ?? 0) + h.amount,
          );
        }
      }

      for (const [outcomeIndex, walletAmount] of walletAmtByOutcome) {
        const total = totals.get(outcomeIndex) ?? 0;
        if (total <= 0) continue;
        const sharePct = walletAmount / total;
        if (sharePct <= pctThreshold) continue;

        results.push({
          triggered: true,
          severity: concentrationUnilateralRule.defaultSeverity,
          marketConditionId,
          evidence: {
            marketSlug: snapshot.marketSlug,
            outcomeIndex,
            walletAmount: Number(walletAmount.toFixed(4)),
            totalShownAmount: Number(total.toFixed(4)),
            sharePct: Number(sharePct.toFixed(4)),
          },
          explanation: `Wallet holds ${(sharePct * 100).toFixed(1)}% of outcome #${outcomeIndex} on "${snapshot.marketSlug}" (> ${(pctThreshold * 100).toFixed(0)}% threshold).`,
        });
      }
    }

    return results;
  },
};
