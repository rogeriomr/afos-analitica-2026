/**
 * Registry of every red-flag rule shipped with AFOS Wallet Intelligence.
 *
 * Add a new rule here once and the detector + seed both pick it up
 * automatically. The set of "deferred" rules (returning [] from `evaluate`)
 * is enumerated explicitly so the seed can flip their `enabled` flag to
 * false at install time without losing the rule's metadata.
 */
import type { Rule } from './types';

import { newWalletBigBetRule } from './new-wallet-big-bet';
import { concentrationUnilateralRule } from './concentration-unilateral';
import { whaleVelocityRule } from './whale-velocity';
import { singleMarketFocusRule } from './single-market-focus';
import { tradeFragmentationRule } from './trade-fragmentation';
import { coordinatedEntryRule } from './coordinated-entry';
import { fundingSourceClusterRule } from './funding-source-cluster';
import { washTradingInternalRule } from './wash-trading-internal';
import { priceImpactUnexplainedRule } from './price-impact-unexplained';
import { outsizedVolumeContributorRule } from './outsized-volume-contributor';

export const activeRules: readonly Rule[] = [
  newWalletBigBetRule,
  concentrationUnilateralRule,
  whaleVelocityRule,
  singleMarketFocusRule,
  tradeFragmentationRule,
  coordinatedEntryRule,
];

// Rules seeded with enabled=false in FlagRule. They still ship in the
// registry so the admin UI can list + flip them on once calibrated.
export const deferredRuleKeys: ReadonlySet<string> = new Set([
  fundingSourceClusterRule.key,
  washTradingInternalRule.key,
  priceImpactUnexplainedRule.key,
  outsizedVolumeContributorRule.key,
]);

export const deferredRules: readonly Rule[] = [
  fundingSourceClusterRule,
  washTradingInternalRule,
  priceImpactUnexplainedRule,
  outsizedVolumeContributorRule,
];

export const allRules: Rule[] = [...activeRules, ...deferredRules];

export const rulesByKey: Record<string, Rule> = Object.fromEntries(
  allRules.map((r) => [r.key, r]),
);
