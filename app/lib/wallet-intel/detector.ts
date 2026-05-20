/**
 * Detector — orchestrates the red-flag rule engine.
 *
 * Responsibilities:
 *   1. Load enabled FlagRule rows (severity + params) and intersect with
 *      the in-memory rule registry.
 *   2. Build the per-run shared context: latest MarketHolderSnapshot map and
 *      the coordination group (last-24h trades across all relevant wallets).
 *   3. For each target wallet, load positions (today's snapshot) + last-30d
 *      trades, evaluate every enabled rule, and persist triggered evaluations
 *      as RedFlag rows in a per-wallet transaction.
 *   4. Return aggregate counts and a duration measurement.
 *
 * Severity for the persisted RedFlag row comes from FlagRule.severity (not
 * from the rule's defaultSeverity) so admins can tune severity in the DB.
 */
import { createHash } from 'crypto';
import type { MarketHolderSnapshot, Prisma, WalletTrade } from '@prisma/client';
import { prisma } from '../../../lib/db';
import { rulesByKey } from './rules/registry';
import type {
  Rule,
  RuleContext,
  RuleEvaluation,
  RuleParams,
  Severity,
} from './rules/types';

const COORDINATED_ENTRY_KEY = 'coordinated_entry';
const TX_TIMEOUT_MS = 5000;
const TRADES_LOOKBACK_DAYS = 30;
const COORDINATION_LOOKBACK_HOURS = 24;

interface EnabledRuleConfig {
  rule: Rule;
  severity: Severity;
  params: RuleParams;
}

interface CoordinationEntry {
  walletId: string;
  marketConditionId: string;
  side: 'BUY' | 'SELL';
  valueUsd: number;
  tradeTimestamp: Date;
}

function isSeverity(v: string): v is Severity {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'critical';
}

function toParams(raw: Prisma.JsonValue): RuleParams {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: RuleParams = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

function canonicalizeEvidence(ev: Record<string, unknown>): string {
  // Stable JSON stringify: sort object keys recursively, normalize numbers (5.0 → 5), arrays preserve order
  function stable(v: unknown): unknown {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(stable);
    return Object.keys(v as Record<string, unknown>).sort().reduce((acc, k) => {
      acc[k] = stable((v as Record<string, unknown>)[k]);
      return acc;
    }, {} as Record<string, unknown>);
  }
  return JSON.stringify(stable(ev));
}

function makeEvidenceHash(ev: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalizeEvidence(ev)).digest('hex').slice(0, 32);
}

async function loadEnabledRules(): Promise<Map<string, EnabledRuleConfig>> {
  if (!prisma) return new Map();
  const rows = await prisma.flagRule.findMany({ where: { enabled: true } });
  const out = new Map<string, EnabledRuleConfig>();
  for (const row of rows) {
    const rule = rulesByKey[row.ruleKey];
    if (!rule) continue; // unknown rule key in DB — skip silently
    const severity = isSeverity(row.severity) ? row.severity : rule.defaultSeverity;
    out.set(row.ruleKey, {
      rule,
      severity,
      params: { ...rule.defaultParams, ...toParams(row.paramsJson) },
    });
  }
  return out;
}

async function loadCoordinationGroup(opts: {
  walletIds?: string[];
}): Promise<CoordinationEntry[]> {
  if (!prisma) return [];
  const cutoff = new Date(Date.now() - COORDINATION_LOOKBACK_HOURS * 3_600_000);
  const where: Prisma.WalletTradeWhereInput = { tradeTimestamp: { gte: cutoff } };
  if (opts.walletIds && opts.walletIds.length > 0) {
    where.walletId = { in: opts.walletIds };
  }
  const rows = await prisma.walletTrade.findMany({
    where,
    select: {
      walletId: true,
      marketConditionId: true,
      side: true,
      valueUsd: true,
      tradeTimestamp: true,
    },
  });
  const out: CoordinationEntry[] = [];
  for (const r of rows) {
    if (r.side !== 'BUY' && r.side !== 'SELL') continue;
    out.push({
      walletId: r.walletId,
      marketConditionId: r.marketConditionId,
      side: r.side,
      valueUsd: r.valueUsd,
      tradeTimestamp: r.tradeTimestamp,
    });
  }
  return out;
}

async function loadLatestHolderSnapshots(
  marketConditionIds?: string[],
): Promise<Map<string, MarketHolderSnapshot>> {
  const map = new Map<string, MarketHolderSnapshot>();
  if (!prisma) return map;

  const where: Prisma.MarketHolderSnapshotWhereInput = {};
  if (marketConditionIds && marketConditionIds.length > 0) {
    where.marketConditionId = { in: marketConditionIds };
  }

  // Group-by latest snapshotAt per market, then re-fetch the actual rows.
  const latest = await prisma.marketHolderSnapshot.groupBy({
    by: ['marketConditionId'],
    where,
    _max: { snapshotAt: true },
  });

  const conditions: Prisma.MarketHolderSnapshotWhereInput[] = latest
    .filter((row) => row._max.snapshotAt !== null)
    .map((row) => ({
      marketConditionId: row.marketConditionId,
      snapshotAt: row._max.snapshotAt as Date,
    }));

  if (conditions.length === 0) return map;
  const rows = await prisma.marketHolderSnapshot.findMany({
    where: { OR: conditions },
  });
  for (const r of rows) map.set(r.marketConditionId, r);
  return map;
}

/**
 * Slice a coordination group for one wallet — keep this wallet's own trades
 * AND every trade on a (marketConditionId, side) pair this wallet participated
 * in. That trims the array significantly before handing it to the rule.
 */
function sliceCoordinationGroup(
  full: CoordinationEntry[],
  walletId: string,
): CoordinationEntry[] {
  const selfKeys = new Set<string>();
  for (const e of full) {
    if (e.walletId === walletId) selfKeys.add(`${e.marketConditionId}|${e.side}`);
  }
  if (selfKeys.size === 0) return [];
  return full.filter((e) => selfKeys.has(`${e.marketConditionId}|${e.side}`));
}

function shapeEvaluation(
  ev: RuleEvaluation,
  ruleKey: string,
  severity: Severity,
  walletId: string,
): Prisma.RedFlagCreateManyInput {
  return {
    walletId,
    ruleKey,
    severity,
    marketConditionId: ev.marketConditionId ?? null,
    evidenceJson: ev.evidence as Prisma.InputJsonValue,
    explanation: ev.explanation,
    evidenceHash: makeEvidenceHash(ev.evidence),
  };
}

export interface RunDetectionOptions {
  walletIds?: string[];
  marketConditionIds?: string[];
}

export interface RunDetectionResult {
  walletsEvaluated: number;
  flagsRaised: number;
  durationMs: number;
}

export async function runDetection(
  opts: RunDetectionOptions = {},
): Promise<RunDetectionResult> {
  // TODO (perf): when active wallets > 5_000, parallelize the per-wallet loop in
  // chunks of 8 (currently sequential). Acceptable at MVP scale (<500 wallets).
  //
  // TODO (perf): when redflags > 100_000, switch summary aggregation in
  // app/api/wallet-intel/summary/route.ts to a single SQL CTE; the current
  // groupBy loads all rows into Node memory.
  const startedAt = Date.now();
  if (!prisma) {
    console.warn('[wallet-intel/detector] prisma unavailable — aborting');
    return { walletsEvaluated: 0, flagsRaised: 0, durationMs: 0 };
  }
  const db = prisma;

  const enabledRules = await loadEnabledRules();
  if (enabledRules.size === 0) {
    console.info('[wallet-intel/detector] no enabled rules — nothing to do');
    return { walletsEvaluated: 0, flagsRaised: 0, durationMs: Date.now() - startedAt };
  }

  const walletWhere: Prisma.WalletWhereInput = { active: true };
  if (opts.walletIds && opts.walletIds.length > 0) {
    walletWhere.id = { in: opts.walletIds };
  }
  const wallets = await db.wallet.findMany({ where: walletWhere });
  if (wallets.length === 0) {
    return { walletsEvaluated: 0, flagsRaised: 0, durationMs: Date.now() - startedAt };
  }

  const [coordinationGroup, marketHolders] = await Promise.all([
    // Always load the FULL last-24h coordination group: coordinated_entry must
    // see OTHER wallets' trades to detect coordination. Even when admin re-scans
    // a subset (opts.walletIds), restricting the group would hide coordinators.
    // The per-wallet rule still filters out self-walletId at evaluation time.
    enabledRules.has(COORDINATED_ENTRY_KEY)
      ? loadCoordinationGroup({})
      : Promise.resolve<CoordinationEntry[]>([]),
    loadLatestHolderSnapshots(opts.marketConditionIds),
  ]);

  // Build an inverted index over the coord group once, keyed by
  // `${marketConditionId}|${side}`, so per-wallet slicing is O(K) where K is
  // the number of distinct (market, side) pairs the wallet traded — instead
  // of O(N) scans of the whole group per wallet.
  const coordIndex = new Map<string, CoordinationEntry[]>();
  if (enabledRules.has(COORDINATED_ENTRY_KEY)) {
    for (const entry of coordinationGroup) {
      const key = `${entry.marketConditionId}|${entry.side}`;
      let bucket = coordIndex.get(key);
      if (!bucket) {
        bucket = [];
        coordIndex.set(key, bucket);
      }
      bucket.push(entry);
    }
  }

  function sliceCoordinationGroupForWallet(
    walletTrades: WalletTrade[],
  ): CoordinationEntry[] {
    const keys = new Set<string>();
    for (const t of walletTrades) {
      if (t.side !== 'BUY' && t.side !== 'SELL') continue;
      keys.add(`${t.marketConditionId}|${t.side}`);
    }
    const result: CoordinationEntry[] = [];
    for (const key of keys) {
      const bucket = coordIndex.get(key);
      if (bucket) result.push(...bucket);
    }
    return result;
  }

  const tradeCutoff = new Date(Date.now() - TRADES_LOOKBACK_DAYS * 86_400_000);
  let flagsRaised = 0;
  let walletsEvaluated = 0;

  for (const wallet of wallets) {
    const [positions, trades] = await Promise.all([
      db.walletPosition.findMany({
        where: {
          walletId: wallet.id,
          ...(opts.marketConditionIds && opts.marketConditionIds.length > 0
            ? { marketConditionId: { in: opts.marketConditionIds } }
            : {}),
        },
        orderBy: { snapshotDate: 'desc' },
      }),
      db.walletTrade.findMany({
        where: { walletId: wallet.id, tradeTimestamp: { gte: tradeCutoff } },
        orderBy: { tradeTimestamp: 'desc' },
      }),
    ]);

    // Keep only the most-recent snapshot date's positions (today's snapshot
    // semantically) — multiple snapshotDates may exist if the importer ran
    // multiple days.
    const latestDateMs =
      positions.length > 0 ? positions[0].snapshotDate.getTime() : 0;
    const todaysPositions = positions.filter(
      (p) => p.snapshotDate.getTime() === latestDateMs,
    );

    const walletSlice = enabledRules.has(COORDINATED_ENTRY_KEY)
      ? sliceCoordinationGroupForWallet(trades)
      : undefined;

    const baseCtx: RuleContext = {
      wallet,
      positions: todaysPositions,
      trades,
      marketHolders,
    };

    const toPersist: Prisma.RedFlagCreateManyInput[] = [];
    for (const [ruleKey, cfg] of enabledRules) {
      const ctx: RuleContext =
        ruleKey === COORDINATED_ENTRY_KEY
          ? { ...baseCtx, coordinationGroup: walletSlice }
          : baseCtx;
      let evaluations: RuleEvaluation[] = [];
      try {
        evaluations = cfg.rule.evaluate(ctx, cfg.params);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[wallet-intel/detector] rule ${ruleKey} threw on wallet ${wallet.id}: ${msg}`,
        );
        continue;
      }
      for (const ev of evaluations) {
        if (!ev.triggered) continue;
        toPersist.push(shapeEvaluation(ev, ruleKey, cfg.severity, wallet.id));
      }
    }

    walletsEvaluated += 1;
    if (toPersist.length === 0) continue;

    try {
      await db.$transaction(
        async (tx) => {
          await tx.redFlag.createMany({ data: toPersist, skipDuplicates: true });
        },
        { timeout: TX_TIMEOUT_MS },
      );
      flagsRaised += toPersist.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[wallet-intel/detector] failed to persist ${toPersist.length} flags for wallet ${wallet.id}: ${msg}`,
      );
    }
  }

  const durationMs = Date.now() - startedAt;
  console.info(
    `[wallet-intel/detector] evaluated=${walletsEvaluated} flags=${flagsRaised} durationMs=${durationMs}`,
  );
  return { walletsEvaluated, flagsRaised, durationMs };
}

/**
 * Single-wallet detection helper — used for on-demand "re-scan" actions in the
 * admin UI. Returns RuleEvaluation rows in memory without writing to the DB
 * when `skipDb` is true (default).
 */
export async function detectFlagsForWallet(
  walletId: string,
  params: { skipDb?: boolean } = {},
): Promise<RuleEvaluation[]> {
  const skipDb = params.skipDb ?? true;
  if (!prisma) {
    console.warn('[wallet-intel/detector] prisma unavailable — single-wallet abort');
    return [];
  }
  const db = prisma;

  const wallet = await db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) return [];

  const enabledRules = await loadEnabledRules();
  if (enabledRules.size === 0) return [];

  const tradeCutoff = new Date(Date.now() - TRADES_LOOKBACK_DAYS * 86_400_000);
  const [positions, trades] = await Promise.all([
    db.walletPosition.findMany({
      where: { walletId: wallet.id },
      orderBy: { snapshotDate: 'desc' },
    }),
    db.walletTrade.findMany({
      where: { walletId: wallet.id, tradeTimestamp: { gte: tradeCutoff } },
      orderBy: { tradeTimestamp: 'desc' },
    }),
  ]);
  const latestDateMs =
    positions.length > 0 ? positions[0].snapshotDate.getTime() : 0;
  const todaysPositions = positions.filter(
    (p) => p.snapshotDate.getTime() === latestDateMs,
  );

  const marketIds = Array.from(
    new Set([
      ...todaysPositions.map((p) => p.marketConditionId),
      ...trades.map((t) => t.marketConditionId),
    ]),
  );
  const [marketHolders, coordinationGroup] = await Promise.all([
    loadLatestHolderSnapshots(marketIds),
    enabledRules.has(COORDINATED_ENTRY_KEY)
      ? loadCoordinationGroup({})
      : Promise.resolve<CoordinationEntry[]>([]),
  ]);
  const walletSlice = enabledRules.has(COORDINATED_ENTRY_KEY)
    ? sliceCoordinationGroup(coordinationGroup, wallet.id)
    : undefined;

  const baseCtx: RuleContext = {
    wallet,
    positions: todaysPositions,
    trades,
    marketHolders,
  };

  const out: RuleEvaluation[] = [];
  const toPersist: Prisma.RedFlagCreateManyInput[] = [];
  for (const [ruleKey, cfg] of enabledRules) {
    const ctx: RuleContext =
      ruleKey === COORDINATED_ENTRY_KEY
        ? { ...baseCtx, coordinationGroup: walletSlice }
        : baseCtx;
    let evaluations: RuleEvaluation[] = [];
    try {
      evaluations = cfg.rule.evaluate(ctx, cfg.params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[wallet-intel/detector] rule ${ruleKey} threw on wallet ${wallet.id}: ${msg}`,
      );
      continue;
    }
    for (const ev of evaluations) {
      if (!ev.triggered) continue;
      const withDbSeverity: RuleEvaluation = { ...ev, severity: cfg.severity };
      out.push(withDbSeverity);
      if (!skipDb) {
        toPersist.push(shapeEvaluation(ev, ruleKey, cfg.severity, wallet.id));
      }
    }
  }

  if (!skipDb && toPersist.length > 0) {
    try {
      await db.$transaction(
        async (tx) => {
          await tx.redFlag.createMany({ data: toPersist, skipDuplicates: true });
        },
        { timeout: TX_TIMEOUT_MS },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[wallet-intel/detector] single-wallet persist failed for ${wallet.id}: ${msg}`,
      );
    }
  }

  return out;
}
