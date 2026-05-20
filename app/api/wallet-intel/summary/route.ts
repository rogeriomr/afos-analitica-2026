/**
 * GET /api/wallet-intel/summary
 *
 * Dashboard top-line counters:
 *   - total wallets tracked
 *   - flagged wallets count (>=1 RedFlag)
 *   - distribution of flagged wallets by max severity per wallet
 *   - top 5 markets by RedFlag count
 *   - last ingest timestamp (max(Wallet.lastSeenAt))
 *
 * Auth: gated by middleware (Basic auth via WALLET_INTEL_PASSWORD).
 */

import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEVERITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export async function GET() {
  try {
    if (!prisma) {
      return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
    }

    const [
      totalWalletsTracked,
      flaggedDistinct,
      perWalletMaxSeverityRows,
      topMarkets,
      lastSeenAgg,
    ] = await Promise.all([
      prisma.wallet.count(),
      prisma.redFlag.findMany({
        select: { walletId: true },
        distinct: ['walletId'],
      }),
      prisma.redFlag.groupBy({
        by: ['walletId', 'severity'],
      }),
      prisma.redFlag.groupBy({
        by: ['marketConditionId'],
        where: { marketConditionId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { marketConditionId: 'desc' } },
        take: 5,
      }),
      prisma.wallet.aggregate({ _max: { lastSeenAt: true } }),
    ]);

    // Per-wallet max severity, then bucket.
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

    // topMarkets needs marketSlug — fetch from any RedFlag row for each conditionId.
    const conditionIds = topMarkets
      .map(m => m.marketConditionId)
      .filter((v): v is string => v != null);
    const slugLookupRows = conditionIds.length === 0
      ? []
      : await prisma.walletTrade.findMany({
          where: { marketConditionId: { in: conditionIds } },
          select: { marketConditionId: true, marketSlug: true },
          distinct: ['marketConditionId'],
        });
    const slugByCondition = new Map(slugLookupRows.map(r => [r.marketConditionId, r.marketSlug]));

    const topSuspiciousMarkets = topMarkets.map(m => ({
      marketConditionId: m.marketConditionId as string,
      marketSlug: slugByCondition.get(m.marketConditionId as string) ?? '',
      flagCount: m._count._all,
    }));

    return NextResponse.json({
      totalWalletsTracked,
      flaggedWalletsCount: flaggedDistinct.length,
      distribution,
      topSuspiciousMarkets,
      lastIngestedAt: lastSeenAgg._max.lastSeenAt?.toISOString() ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[wallet-intel-api] summary GET failed:', error);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
