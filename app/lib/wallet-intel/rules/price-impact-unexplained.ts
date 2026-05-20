/**
 * Rule: price_impact_unexplained  [DEFERRED — out of MVP scope]
 *
 * TODO: When implemented, this rule should compare Polymarket odds moves
 * (caused by this wallet's trade) against sibling-market odds on Kalshi /
 * PredictIt over the same minutes. A large isolated move on Polymarket only
 * — i.e. unexplained by any cross-market repricing or news drop — is a
 * strong manipulation signal. That requires:
 *   - a Kalshi REST client (or scraping fallback)
 *   - a sibling-market mapping table (Polymarket conditionId ↔ Kalshi ticker)
 *   - an odds-history series + news-event tagger
 *
 * For now `evaluate()` returns [] unconditionally. Seeded as enabled = false.
 */
import type { Rule, RuleEvaluation } from './types';

export const priceImpactUnexplainedRule: Rule = {
  key: 'price_impact_unexplained',
  displayName: 'Unexplained price impact',
  description:
    'Wallet trade caused an outsized odds move not mirrored on sibling markets. DEFERRED — requires Kalshi/PredictIt odds feed.',
  defaultSeverity: 'high',
  defaultParams: { min_pp_move: 5, sibling_threshold_pp: 1 },

  evaluate(): RuleEvaluation[] {
    return [];
  },
};
