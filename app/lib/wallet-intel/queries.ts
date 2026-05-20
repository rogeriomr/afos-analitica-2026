/**
 * Server-side query helpers for the wallet-intel admin pages.
 *
 * These mirror the read logic that lives inside the /api/wallet-intel/* GET
 * routes, but are intended to be called DIRECTLY from React Server Components
 * — avoiding an HTTP hop (and the Basic-auth header propagation problem) on
 * the initial page render.
 *
 * Cross-agent note: the original query logic was authored by the api-agent
 * inside each route handler. We deliberately leave those routes untouched
 * and live with the small amount of duplication here — the alternative
 * (refactoring those routes to import from this file) would touch files
 * outside this agent's scope. If this duplication becomes painful, a future
 * pass can consolidate.
 *
 * Behaviour is intended to match the API responses 1:1 so client-side tables
 * that refetch via the API see the same shape as the SSR'd initial render.
 */

import { prisma } from '../../../lib/db';
import { getOutcomesByConditionIds } from './market-metadata';

/** Common time-window constants, exported so the API routes can stay 1:1 with these queries. */
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
export const FOURTEEN_DAYS_MS = 14 * ONE_DAY_MS;
export const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;
export const NINETY_DAYS_MS = 90 * ONE_DAY_MS;

const SEVERITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export type Severity = 'low' | 'medium' | 'high' | 'critical';

// ─── /summary ─────────────────────────────────────────────────────────

export interface SummaryResponse {
  totalWalletsTracked: number;
  flaggedWalletsCount: number;
  distribution: { critical: number; high: number; medium: number; low: number };
  topSuspiciousMarkets: Array<{
    marketConditionId: string;
    marketSlug: string;
    flagCount: number;
  }>;
  lastIngestedAt: string | null;
}

export async function getSummary(): Promise<SummaryResponse | { error: string }> {
  if (!prisma) return { error: 'database_unavailable' };

  const [
    totalWalletsTracked,
    flaggedDistinct,
    perWalletMaxSeverityRows,
    topMarkets,
    lastSeenAgg,
  ] = await Promise.all([
    prisma.wallet.count(),
    prisma.redFlag.findMany({ select: { walletId: true }, distinct: ['walletId'] }),
    prisma.redFlag.groupBy({ by: ['walletId', 'severity'] }),
    prisma.redFlag.groupBy({
      by: ['marketConditionId'],
      where: { marketConditionId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { marketConditionId: 'desc' } },
      take: 5,
    }),
    prisma.wallet.aggregate({ _max: { lastSeenAt: true } }),
  ]);

  const maxByWallet = new Map<string, number>();
  for (const row of perWalletMaxSeverityRows) {
    const rank = SEVERITY_RANK[row.severity.toLowerCase()] ?? 0;
    if (rank === 0) continue;
    const prev = maxByWallet.get(row.walletId) ?? 0;
    if (rank > prev) maxByWallet.set(row.walletId, rank);
  }
  const distribution = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const rank of maxByWallet.values()) {
    if (rank === 4) distribution.critical++;
    else if (rank === 3) distribution.high++;
    else if (rank === 2) distribution.medium++;
    else if (rank === 1) distribution.low++;
  }

  const conditionIds = topMarkets
    .map((m) => m.marketConditionId)
    .filter((v): v is string => v != null);
  const slugLookupRows =
    conditionIds.length === 0
      ? []
      : await prisma.walletTrade.findMany({
          where: { marketConditionId: { in: conditionIds } },
          select: { marketConditionId: true, marketSlug: true },
          distinct: ['marketConditionId'],
        });
  const slugByCondition = new Map(slugLookupRows.map((r) => [r.marketConditionId, r.marketSlug]));

  const topSuspiciousMarkets = topMarkets.map((m) => ({
    marketConditionId: m.marketConditionId as string,
    marketSlug: slugByCondition.get(m.marketConditionId as string) ?? '',
    flagCount: m._count._all,
  }));

  return {
    totalWalletsTracked,
    flaggedWalletsCount: flaggedDistinct.length,
    distribution,
    topSuspiciousMarkets,
    lastIngestedAt: lastSeenAgg._max.lastSeenAt?.toISOString() ?? null,
  };
}

// ─── /wallet/[addr] ───────────────────────────────────────────────────

export interface WalletDetailResponse {
  /** Internal UUID of the wallet row — needed by sibling queries that key on walletId. */
  walletId: string;
  wallet: {
    proxyAddress: string;
    proxyType: string;
    eoaOwnerAddress: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    totalValueUsd: number | null;
    active: boolean;
  };
  profile: {
    pseudonym: string | null;
    username: string | null;
    xUsername: string | null;
    profileImageUrl: string | null;
    verifiedBadge: boolean;
    lastFetchedAt: string;
  } | null;
  positions: Array<{
    marketConditionId: string;
    marketSlug: string;
    outcomeIndex: number;
    outcomeName: string;
    size: number;
    avgPrice: number;
    currentValueUsd: number;
    pnlUsd: number;
    pnlPercent: number | null;
    snapshotDate: string;
  }>;
  trades: Array<{
    marketConditionId: string;
    marketSlug: string;
    side: string;
    outcomeIndex: number | null;
    size: number;
    price: number;
    valueUsd: number;
    transactionHash: string;
    tradeTimestamp: string;
  }>;
  flags: Array<{
    ruleKey: string;
    severity: string;
    marketConditionId: string | null;
    evidence: unknown;
    explanation: string;
    triggeredAt: string;
  }>;
  score: {
    totalScore: number;
    flagCount: number;
    highSeverityCount: number;
    lastComputedAt: string;
    breakdown: unknown;
  } | null;
}

export async function getWalletDetail(
  proxyAddress: string,
): Promise<WalletDetailResponse | { notFound: true } | { error: string }> {
  if (!prisma) return { error: 'database_unavailable' };

  const wallet = await prisma.wallet.findUnique({
    where: { proxyAddress },
    include: { profile: true, score: true },
  });
  if (!wallet) return { notFound: true };

  const d14 = new Date(Date.now() - FOURTEEN_DAYS_MS);

  const [rawPositions, tradeRows, flagRows] = await Promise.all([
    prisma.walletPosition.findMany({
      where: { walletId: wallet.id, snapshotDate: { gte: d14 } },
      orderBy: { snapshotDate: 'desc' },
    }),
    prisma.walletTrade.findMany({
      where: { walletId: wallet.id },
      orderBy: { tradeTimestamp: 'desc' },
      take: 200,
    }),
    prisma.redFlag.findMany({
      where: { walletId: wallet.id },
      orderBy: { triggeredAt: 'desc' },
    }),
  ]);

  const positionMap = new Map<string, (typeof rawPositions)[number]>();
  for (const p of rawPositions) {
    const key = `${p.marketConditionId}::${p.outcomeIndex}`;
    const existing = positionMap.get(key);
    if (!existing || p.snapshotDate > existing.snapshotDate) {
      positionMap.set(key, p);
    }
  }

  const positions = Array.from(positionMap.values()).map((p) => ({
    marketConditionId: p.marketConditionId,
    marketSlug: p.marketSlug,
    outcomeIndex: p.outcomeIndex,
    outcomeName: p.outcomeName,
    size: p.size,
    avgPrice: p.avgPrice,
    currentValueUsd: p.currentValueUsd,
    pnlUsd: p.pnlUsd,
    pnlPercent: p.pnlPercent ?? null,
    snapshotDate: p.snapshotDate.toISOString(),
  }));

  const trades = tradeRows.map((t) => ({
    marketConditionId: t.marketConditionId,
    marketSlug: t.marketSlug,
    side: t.side,
    outcomeIndex: t.outcomeIndex ?? null,
    size: t.size,
    price: t.price,
    valueUsd: t.valueUsd,
    transactionHash: t.transactionHash,
    tradeTimestamp: t.tradeTimestamp.toISOString(),
  }));

  const flags = flagRows.map((f) => ({
    ruleKey: f.ruleKey,
    severity: f.severity,
    marketConditionId: f.marketConditionId ?? null,
    evidence: f.evidenceJson,
    explanation: f.explanation,
    triggeredAt: f.triggeredAt.toISOString(),
  }));

  return {
    walletId: wallet.id,
    wallet: {
      proxyAddress: wallet.proxyAddress,
      proxyType: wallet.proxyType,
      eoaOwnerAddress: wallet.eoaOwnerAddress ?? null,
      firstSeenAt: wallet.firstSeenAt.toISOString(),
      lastSeenAt: wallet.lastSeenAt.toISOString(),
      totalValueUsd: wallet.totalValueUsd ?? null,
      active: wallet.active,
    },
    profile: wallet.profile
      ? {
          pseudonym: wallet.profile.pseudonym ?? null,
          username: wallet.profile.username ?? null,
          xUsername: wallet.profile.xUsername ?? null,
          profileImageUrl: wallet.profile.profileImageUrl ?? null,
          verifiedBadge: wallet.profile.verifiedBadge,
          lastFetchedAt: wallet.profile.lastFetchedAt.toISOString(),
        }
      : null,
    positions,
    trades,
    flags,
    score: wallet.score
      ? {
          totalScore: wallet.score.totalScore,
          flagCount: wallet.score.flagCount,
          highSeverityCount: wallet.score.highSeverityCount,
          lastComputedAt: wallet.score.lastComputedAt.toISOString(),
          breakdown: wallet.score.breakdownJson,
        }
      : null,
  };
}

// ─── /market/[conditionId]/holders ────────────────────────────────────

interface HolderEntry {
  proxyAddress: string;
  amount: number;
  outcomeIndex?: number;
}

function coerceNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function parseHolders(raw: unknown): HolderEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HolderEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const addr = (obj.proxyAddress ?? obj.address ?? obj.proxy_address) as unknown;
    if (typeof addr !== 'string') continue;
    const outcomeIndex =
      typeof obj.outcomeIndex === 'number'
        ? obj.outcomeIndex
        : typeof obj.outcome_index === 'number'
          ? obj.outcome_index
          : undefined;
    const entry: HolderEntry = {
      proxyAddress: addr.toLowerCase(),
      amount: coerceNumber(obj.amount ?? obj.size ?? obj.shares),
    };
    if (outcomeIndex !== undefined) entry.outcomeIndex = outcomeIndex;
    out.push(entry);
  }
  return out;
}

export interface HoldersResponse {
  conditionId: string;
  marketSlug: string;
  latestSnapshotAt: string;
  totalHolders: number;
  topHolders: Array<{
    proxyAddress: string;
    username?: string;
    amount: number;
    outcomeIndex: number;
  }>;
  concentrationTop5Pct: number;
  concentrationTop10Pct: number;
  /** Full holder list (sorted desc) — used by the SSR market page to render top-30. */
  allHoldersSorted: HolderEntry[];
}

export async function getMarketHolders(
  conditionId: string,
): Promise<HoldersResponse | { notFound: true } | { error: string }> {
  if (!prisma) return { error: 'database_unavailable' };

  const snapshot = await prisma.marketHolderSnapshot.findFirst({
    where: { marketConditionId: conditionId },
    orderBy: { snapshotAt: 'desc' },
  });
  if (!snapshot) return { notFound: true };

  const holders = parseHolders(snapshot.holdersJson);
  holders.sort((a, b) => b.amount - a.amount);

  const totalAmount = holders.reduce((acc, h) => acc + h.amount, 0);
  const sumOf = (n: number) => holders.slice(0, n).reduce((acc, h) => acc + h.amount, 0);
  const concentrationTop5Pct = totalAmount > 0 ? (sumOf(5) / totalAmount) * 100 : 0;
  const concentrationTop10Pct = totalAmount > 0 ? (sumOf(10) / totalAmount) * 100 : 0;

  const topTen = holders.slice(0, 10);
  const usernameByAddress = new Map<string, string>();
  if (topTen.length > 0) {
    const walletRows = await prisma.wallet.findMany({
      where: { proxyAddress: { in: topTen.map((h) => h.proxyAddress) } },
      select: { proxyAddress: true, profile: { select: { username: true } } },
    });
    for (const w of walletRows) {
      if (w.profile?.username) usernameByAddress.set(w.proxyAddress, w.profile.username);
    }
  }

  const topHolders = topTen.map((h) => ({
    proxyAddress: h.proxyAddress,
    username: usernameByAddress.get(h.proxyAddress) ?? undefined,
    amount: h.amount,
    outcomeIndex: h.outcomeIndex ?? 0,
  }));

  return {
    conditionId,
    marketSlug: snapshot.marketSlug,
    latestSnapshotAt: snapshot.snapshotAt.toISOString(),
    totalHolders: snapshot.totalHolders,
    topHolders,
    concentrationTop5Pct,
    concentrationTop10Pct,
    allHoldersSorted: holders,
  };
}

// ─── /market/[conditionId]/whales ─────────────────────────────────────

export type WhalesTimeframe = '24h' | '7d' | '30d' | 'all';

export interface WhaleEntry {
  proxyAddress: string;
  username: string | null;
  totalValueUsd: number;
  tradeCount: number;
  totalScore: number | null;
  flagCount: number | null;
  /**
   * Wallet's share of the latest MarketHolderSnapshot supply on outcomeIndex=0
   * (canonically "Yes"). null when no snapshot or wallet absent from snapshot.
   */
  yesSupplyPct: number | null;
  /** Same for outcomeIndex=1 ("No"). */
  noSupplyPct: number | null;
}

export interface WhalesResponse {
  conditionId: string;
  timeframe: WhalesTimeframe;
  whales: WhaleEntry[];
}

function sinceForTimeframe(tf: WhalesTimeframe): Date | null {
  switch (tf) {
    case '24h':
      return new Date(Date.now() - ONE_DAY_MS);
    case '7d':
      return new Date(Date.now() - SEVEN_DAYS_MS);
    case '30d':
      return new Date(Date.now() - THIRTY_DAYS_MS);
    case 'all':
      return null;
  }
}

interface SnapshotEntry {
  proxyAddress: string;
  amount: number;
  outcomeIndex: number;
}

function parseSnapshotHoldersForWhales(raw: unknown): SnapshotEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SnapshotEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const addr = (obj.holder ?? obj.proxyAddress ?? obj.address ?? obj.proxy_address) as unknown;
    if (typeof addr !== 'string') continue;
    const outcomeIndexRaw =
      typeof obj.outcomeIndex === 'number'
        ? obj.outcomeIndex
        : typeof obj.outcome_index === 'number'
          ? obj.outcome_index
          : 0;
    out.push({
      proxyAddress: addr.toLowerCase(),
      amount: coerceNumber(obj.amount ?? obj.size ?? obj.shares),
      outcomeIndex: Number.isInteger(outcomeIndexRaw) ? outcomeIndexRaw : 0,
    });
  }
  return out;
}

export async function getMarketWhales(
  conditionId: string,
  timeframe: WhalesTimeframe = '30d',
): Promise<WhalesResponse | { error: string }> {
  if (!prisma) return { error: 'database_unavailable' };

  const since = sinceForTimeframe(timeframe);

  const grouped = await prisma.walletTrade.groupBy({
    by: ['walletId'],
    where: {
      marketConditionId: conditionId,
      ...(since ? { tradeTimestamp: { gte: since } } : {}),
    },
    _sum: { valueUsd: true },
    _count: { _all: true },
    orderBy: { _sum: { valueUsd: 'desc' } },
    take: 20,
  });
  if (grouped.length === 0) return { conditionId, timeframe, whales: [] };

  const walletIds = grouped.map((g) => g.walletId);
  const [wallets, snapshot] = await Promise.all([
    prisma.wallet.findMany({
      where: { id: { in: walletIds } },
      include: {
        profile: { select: { username: true } },
        score: { select: { totalScore: true, flagCount: true } },
      },
    }),
    prisma.marketHolderSnapshot.findFirst({
      where: { marketConditionId: conditionId },
      orderBy: { snapshotAt: 'desc' },
      select: { holdersJson: true },
    }),
  ]);
  const walletById = new Map(wallets.map((w) => [w.id, w]));

  // Build supply lookups for the binary outcomes (index 0 + 1). Multi-
  // outcome markets aren't represented in the response shape yet — when
  // the schema starts allowing >2 outcomes, the per-outcome columns
  // here will need to become an array, not yes/no fields.
  let totalIdx0 = 0;
  let totalIdx1 = 0;
  const byAddr = new Map<string, { i0: number; i1: number }>();
  if (snapshot) {
    for (const e of parseSnapshotHoldersForWhales(snapshot.holdersJson)) {
      if (e.outcomeIndex === 0) totalIdx0 += e.amount;
      else if (e.outcomeIndex === 1) totalIdx1 += e.amount;
      const slot = byAddr.get(e.proxyAddress) ?? { i0: 0, i1: 0 };
      if (e.outcomeIndex === 0) slot.i0 += e.amount;
      else if (e.outcomeIndex === 1) slot.i1 += e.amount;
      byAddr.set(e.proxyAddress, slot);
    }
  }

  const supplyPct = (addr: string, idx: 0 | 1): number | null => {
    if (!snapshot) return null;
    const total = idx === 0 ? totalIdx0 : totalIdx1;
    if (total <= 0) return null;
    const slot = byAddr.get(addr);
    if (!slot) return null;
    const amt = idx === 0 ? slot.i0 : slot.i1;
    if (amt <= 0) return null;
    return Math.min(100, (amt / total) * 100);
  };

  const whales: WhaleEntry[] = grouped
    .map((g): WhaleEntry | null => {
      const w = walletById.get(g.walletId);
      if (!w) return null;
      const addr = w.proxyAddress;
      return {
        proxyAddress: addr,
        username: w.profile?.username ?? null,
        totalValueUsd: g._sum.valueUsd ?? 0,
        tradeCount: g._count._all,
        totalScore: w.score?.totalScore ?? null,
        flagCount: w.score?.flagCount ?? null,
        yesSupplyPct: supplyPct(addr, 0),
        noSupplyPct: supplyPct(addr, 1),
      };
    })
    .filter((v): v is WhaleEntry => v !== null);

  return { conditionId, timeframe, whales };
}

// ─── /wallet/[addr] — position-building sessions ──────────────────────

/**
 * A "session" is a contiguous run of trades by the same wallet on the
 * same (market, outcome, side) channel where every adjacent pair is
 * within `gapMinutes` of each other. Cross-referenced against the
 * `market.MarketPrice` history so we can show how much the wallet
 * pushed the implied probability during the session.
 */
export interface PositionBuildSession {
  marketConditionId: string;
  marketSlug: string;
  outcomeIndex: number | null;
  /** Resolved via wallet.market_metadata; null when not yet captured. */
  outcomeName: string | null;
  side: 'BUY' | 'SELL';
  /** First trade timestamp in the session. */
  sessionStart: Date;
  /** Last trade timestamp in the session. */
  sessionEnd: Date;
  durationMs: number;
  tradeCount: number;
  /** Sum of |valueUsd| across every trade in the session. */
  totalVolumeUsd: number;
  /** Probability in [0,1] at sessionStart (closest snapshot ≤ start). */
  priceStart: number | null;
  /** Probability in [0,1] at sessionEnd (closest snapshot ≥ end, falls back to latest snapshot). */
  priceEnd: number | null;
  /** (priceEnd − priceStart) × 100, rounded to 2 decimals. */
  probabilityDeltaPct: number | null;
}

interface SessionWorkItem {
  marketConditionId: string;
  marketSlug: string;
  outcomeIndex: number | null;
  side: 'BUY' | 'SELL';
  sessionStart: Date;
  sessionEnd: Date;
  tradeCount: number;
  totalVolumeUsd: number;
}

/**
 * Group a wallet's trades over the last 90 days into "position-building"
 * sessions, then cross-reference each session against the market price
 * timeline to compute the probability delta the wallet *might* have caused.
 *
 * Cross-schema bridging (the hard bit):
 *   walletTrade.marketSlug ─ matches ─→ market.Market.polymarketMarketId
 *   walletTrade.outcomeIndex ─ via MarketMetadata.outcomesJson[].name ─→
 *     market.MarketOutcome.outcomeName (case-insensitive)
 *   → market.MarketPrice rows keyed on (marketId, outcomeId, snapshotAt)
 *
 * At every join boundary we accept that data may be missing (no metadata
 * row yet, no MarketOutcome row, no price snapshots) and degrade to
 * `priceStart: null, priceEnd: null, probabilityDeltaPct: null` instead of
 * throwing. The UI surfaces a banner when most sessions lack price data.
 */
export async function getWalletPositionBuilds(
  walletId: string,
  opts?: { gapMinutes?: number; limit?: number },
): Promise<PositionBuildSession[]> {
  if (!prisma) return [];

  const gapMinutes = opts?.gapMinutes ?? 60;
  const limit = opts?.limit ?? 50;
  const gapMs = gapMinutes * 60 * 1000;
  const since = new Date(Date.now() - NINETY_DAYS_MS);

  // 1. Load trades in chronological order.
  const trades = await prisma.walletTrade.findMany({
    where: { walletId, tradeTimestamp: { gte: since } },
    orderBy: { tradeTimestamp: 'asc' },
    select: {
      marketConditionId: true,
      marketSlug: true,
      outcomeIndex: true,
      side: true,
      valueUsd: true,
      tradeTimestamp: true,
    },
  });
  if (trades.length === 0) return [];

  // 2 + 3. Bucket by (conditionId, outcomeIndex ?? -1, side), then
  //        segment each bucket into sessions on `gapMs` gaps.
  const buckets = new Map<string, typeof trades>();
  for (const tr of trades) {
    const sideRaw = (tr.side || '').toUpperCase();
    if (sideRaw !== 'BUY' && sideRaw !== 'SELL') continue;
    const key = `${tr.marketConditionId}::${tr.outcomeIndex ?? -1}::${sideRaw}`;
    const arr = buckets.get(key);
    if (arr) arr.push(tr);
    else buckets.set(key, [tr]);
  }

  const sessions: SessionWorkItem[] = [];
  for (const [key, channelTrades] of buckets) {
    const [conditionId, outcomeIdxStr, sideStr] = key.split('::');
    const outcomeIndex = outcomeIdxStr === '-1' ? null : Number(outcomeIdxStr);
    const side = sideStr as 'BUY' | 'SELL';
    // First slug we see for this channel is fine — all trades in a bucket
    // share marketConditionId, and marketSlug is per-market, so the value
    // is stable within a bucket.
    const marketSlug = channelTrades[0]?.marketSlug ?? '';

    let current: SessionWorkItem | null = null;
    let prevTs = 0;
    for (const tr of channelTrades) {
      const ts = tr.tradeTimestamp.getTime();
      const vol = Math.abs(tr.valueUsd);
      if (current && ts - prevTs <= gapMs) {
        current.sessionEnd = tr.tradeTimestamp;
        current.tradeCount += 1;
        current.totalVolumeUsd += vol;
      } else {
        if (current) sessions.push(current);
        current = {
          marketConditionId: conditionId,
          marketSlug,
          outcomeIndex,
          side,
          sessionStart: tr.tradeTimestamp,
          sessionEnd: tr.tradeTimestamp,
          tradeCount: 1,
          totalVolumeUsd: vol,
        };
      }
      prevTs = ts;
    }
    if (current) sessions.push(current);
  }

  if (sessions.length === 0) return [];

  // 4. Sort DESC and slice early — we only do price lookups for the
  //    `limit` most recent sessions so we avoid blowing up the price
  //    query count for very active wallets.
  sessions.sort((a, b) => b.sessionStart.getTime() - a.sessionStart.getTime());
  const head = sessions.slice(0, limit);

  // 5. Price lookups. Cache per (marketSlug → marketId) and
  //    (marketId, outcomeNameLower → outcomeId) so repeat sessions on
  //    the same market+outcome only hit the DB once.

  // 5a. Distinct slugs → market rows.
  const slugs = Array.from(new Set(head.map((s) => s.marketSlug).filter(Boolean)));
  const marketByslug = new Map<string, { id: string }>();
  if (slugs.length > 0) {
    try {
      const marketRows = await prisma.market.findMany({
        where: { polymarketMarketId: { in: slugs } },
        select: { id: true, polymarketMarketId: true },
      });
      for (const m of marketRows) {
        marketByslug.set(m.polymarketMarketId, { id: m.id });
      }
    } catch {
      // Cross-schema query failed (e.g. market schema unavailable); we'll
      // just return sessions with null prices.
    }
  }

  // 5b. Distinct conditionIds → outcomeName lookup (via MarketMetadata).
  const conditionIds = Array.from(new Set(head.map((s) => s.marketConditionId)));
  const outcomesByCondition = await getOutcomesByConditionIds(conditionIds);

  // 5c. Resolve a MarketOutcome row per (marketId, outcomeNameLower).
  const outcomeRowCache = new Map<string, { id: string } | null>();
  async function resolveOutcomeId(
    marketId: string,
    outcomeName: string,
  ): Promise<string | null> {
    const cacheKey = `${marketId}::${outcomeName.toLowerCase()}`;
    if (outcomeRowCache.has(cacheKey)) {
      return outcomeRowCache.get(cacheKey)?.id ?? null;
    }
    try {
      const row = await prisma!.marketOutcome.findFirst({
        where: {
          marketId,
          outcomeName: { equals: outcomeName, mode: 'insensitive' },
        },
        select: { id: true },
      });
      outcomeRowCache.set(cacheKey, row);
      return row?.id ?? null;
    } catch {
      outcomeRowCache.set(cacheKey, null);
      return null;
    }
  }

  // 5d–f. Compute the per-session price window in parallel. Each block
  //       hits at worst 2 MarketPrice queries (start + end) — and we
  //       fall through to nulls if any lookup fails.
  const enriched = await Promise.all(
    head.map(async (s): Promise<PositionBuildSession> => {
      const outcomes = outcomesByCondition.get(s.marketConditionId) ?? [];
      const outcomeName =
        s.outcomeIndex == null
          ? null
          : outcomes.find((o) => o.index === s.outcomeIndex)?.name ?? null;

      const base: PositionBuildSession = {
        marketConditionId: s.marketConditionId,
        marketSlug: s.marketSlug,
        outcomeIndex: s.outcomeIndex,
        outcomeName,
        side: s.side,
        sessionStart: s.sessionStart,
        sessionEnd: s.sessionEnd,
        durationMs: s.sessionEnd.getTime() - s.sessionStart.getTime(),
        tradeCount: s.tradeCount,
        totalVolumeUsd: s.totalVolumeUsd,
        priceStart: null,
        priceEnd: null,
        probabilityDeltaPct: null,
      };

      const market = marketByslug.get(s.marketSlug);
      if (!market || !outcomeName) return base;

      const outcomeId = await resolveOutcomeId(market.id, outcomeName);
      if (!outcomeId) return base;

      try {
        const [startSnap, endSnap, latestSnap] = await Promise.all([
          prisma!.marketPrice.findFirst({
            where: { outcomeId, snapshotAt: { lte: s.sessionStart } },
            orderBy: { snapshotAt: 'desc' },
            select: { price: true },
          }),
          prisma!.marketPrice.findFirst({
            where: { outcomeId, snapshotAt: { gte: s.sessionEnd } },
            orderBy: { snapshotAt: 'asc' },
            select: { price: true },
          }),
          // Fallback for when no snapshot exists at-or-after sessionEnd
          // (e.g. session ended within the last cron interval): use the
          // most recent snapshot we do have.
          prisma!.marketPrice.findFirst({
            where: { outcomeId },
            orderBy: { snapshotAt: 'desc' },
            select: { price: true },
          }),
        ]);

        const priceStart = startSnap?.price ?? null;
        const priceEnd = endSnap?.price ?? latestSnap?.price ?? null;

        if (priceStart == null || priceEnd == null) {
          return { ...base, priceStart, priceEnd, probabilityDeltaPct: null };
        }

        const deltaPct = Math.round((priceEnd - priceStart) * 100 * 100) / 100;
        return {
          ...base,
          priceStart,
          priceEnd,
          probabilityDeltaPct: deltaPct,
        };
      } catch {
        // Cross-schema MarketPrice query failed — degrade gracefully.
        return base;
      }
    }),
  );

  return enriched;
}
