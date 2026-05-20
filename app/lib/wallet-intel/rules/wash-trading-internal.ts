/**
 * Rule: wash_trading_internal  [DEFERRED — out of MVP scope]
 *
 * TODO: When implemented, this rule should detect closed-loop cycles of the
 * form A → B → A (and longer variants) on the same conditional token within
 * a short window, where both sides are controlled by the same operator. That
 * requires:
 *   - a trade-graph builder per token (we already have WalletTrade)
 *   - cycle detection (DFS with depth cap, e.g. Johnson's algorithm capped at
 *     k ≤ 4) over the directed multigraph
 *   - a "same operator" heuristic (shared funding ancestor / shared IP /
 *     identical fingerprints) — overlaps with funding_source_cluster
 *
 * For now `evaluate()` returns [] unconditionally. Seeded as enabled = false.
 */
import type { Rule, RuleEvaluation } from './types';

export const washTradingInternalRule: Rule = {
  key: 'wash_trading_internal',
  displayName: 'Internal wash trading',
  description:
    'Closed-loop A→B→A trade cycles between linked wallets. DEFERRED — requires graph cycle detection.',
  defaultSeverity: 'critical',
  defaultParams: { max_cycle_length: 4, window_minutes: 60 },

  evaluate(): RuleEvaluation[] {
    return [];
  },
};
