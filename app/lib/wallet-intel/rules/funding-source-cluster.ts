/**
 * Rule: funding_source_cluster  [DEFERRED — out of MVP scope]
 *
 * TODO: When implemented, this rule should detect wallets whose ancestor
 * funding chain (USDC.e on Polygon) traces back to a small cluster of common
 * EOAs — the textbook on-chain Sybil signature. That requires:
 *   - a Polygon RPC client (or Alchemy / QuickNode) wired to the worker
 *   - a recursive transfer-graph walk, capped at ~3 hops
 *   - persistent caching of the ancestor map (it's expensive)
 *
 * For now `evaluate()` returns [] unconditionally. The rule is still seeded
 * into FlagRule (with enabled = false) so admins can flip it on once the
 * funding-graph crawler ships in a later phase.
 */
import type { Rule, RuleEvaluation } from './types';

export const fundingSourceClusterRule: Rule = {
  key: 'funding_source_cluster',
  displayName: 'Funding source cluster',
  description:
    'Wallet shares a common funding ancestor with several others (Sybil cluster). DEFERRED — requires on-chain ancestor lookup.',
  defaultSeverity: 'high',
  defaultParams: { max_hops: 3, min_cluster_size: 4 },

  evaluate(): RuleEvaluation[] {
    return [];
  },
};
