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

/** Common time-window constants, exported so the API routes can stay 1:1 with these queries. */
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
export const FOURTEEN_DAYS_MS = 14 * ONE_DAY_MS;
export const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

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

export interface WhalesResponse {
  conditionId: string;
  whales: Array<{
    proxyAddress: string;
    username?: string;
    totalValueUsd30d: number;
    tradeCount30d: number;
    totalScore: number | null;
    flagCount: number | null;
  }>;
}

export async function getMarketWhales(
  conditionId: string,
): Promise<WhalesResponse | { error: string }> {
  if (!prisma) return { error: 'database_unavailable' };

  const since = new Date(Date.now() - THIRTY_DAYS_MS);

  const grouped = await prisma.walletTrade.groupBy({
    by: ['walletId'],
    where: { marketConditionId: conditionId, tradeTimestamp: { gte: since } },
    _sum: { valueUsd: true },
    _count: { _all: true },
    orderBy: { _sum: { valueUsd: 'desc' } },
    take: 20,
  });
  if (grouped.length === 0) return { conditionId, whales: [] };

  const walletIds = grouped.map((g) => g.walletId);
  const wallets = await prisma.wallet.findMany({
    where: { id: { in: walletIds } },
    include: {
      profile: { select: { username: true } },
      score: { select: { totalScore: true, flagCount: true } },
    },
  });
  const walletById = new Map(wallets.map((w) => [w.id, w]));

  const whales = grouped
    .map((g) => {
      const w = walletById.get(g.walletId);
      if (!w) return null;
      return {
        proxyAddress: w.proxyAddress,
        username: w.profile?.username ?? undefined,
        totalValueUsd30d: g._sum.valueUsd ?? 0,
        tradeCount30d: g._count._all,
        totalScore: w.score?.totalScore ?? null,
        flagCount: w.score?.flagCount ?? null,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return { conditionId, whales };
}
