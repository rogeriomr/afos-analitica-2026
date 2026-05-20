/**
 * Rule contract for the AFOS Wallet Intelligence red-flag engine.
 *
 * Every rule is a pure function: it consumes a RuleContext (wallet + recent
 * positions/trades + optional market holder snapshots + optional coordination
 * group) plus a runtime `params` bag (loaded from FlagRule.paramsJson so the
 * thresholds are DB-tunable) and returns zero or more RuleEvaluation rows.
 *
 * The detector orchestrator is responsible for:
 *   - loading FlagRule rows (severity + params + enabled flag) from the DB
 *   - filtering the registry down to enabled rules
 *   - persisting each triggered evaluation as a RedFlag row whose `severity`
 *     comes from the DB FlagRule.severity field (NOT from the rule itself —
 *     the rule only provides `defaultSeverity` as a seed value).
 */
import type {
  Wallet,
  WalletPosition,
  WalletTrade,
  MarketHolderSnapshot,
} from '@prisma/client';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

/**
 * The full evaluation context handed to every rule.
 *
 * - `trades` are the wallet's last 30 days of trades, sorted desc by tradeTimestamp.
 * - `marketHolders` maps marketConditionId → latest MarketHolderSnapshot.
 * - `coordinationGroup` is populated ONLY when the coordinated_entry rule is
 *   being evaluated; for every other rule it will be undefined.
 */
export interface RuleContext {
  wallet: Wallet;
  positions: WalletPosition[];
  trades: WalletTrade[];
  marketHolders?: Map<string, MarketHolderSnapshot>;
  coordinationGroup?: Array<{
    walletId: string;
    marketConditionId: string;
    side: 'BUY' | 'SELL';
    valueUsd: number;
    tradeTimestamp: Date;
  }>;
}

export type RuleParamValue = number | string | boolean;
export type RuleParams = Record<string, RuleParamValue>;
export type RuleEvidence = Record<string, number | string | boolean>;

export interface RuleEvaluation {
  triggered: boolean;
  severity: Severity;
  marketConditionId?: string;
  evidence: RuleEvidence;
  explanation: string;
}

export interface Rule {
  key: string;
  displayName: string;
  description: string;
  defaultSeverity: Severity;
  defaultParams: RuleParams;
  evaluate(ctx: RuleContext, params: RuleParams): RuleEvaluation[];
}
