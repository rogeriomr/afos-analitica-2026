/**
 * GET /api/wallet-intel/leaderboard
 *
 * Top 100 wallets ranked by score, volume, or PnL over a time window.
 *
 * Query params:
 *   - orderBy:    score | volume | pnl  (default: score)
 *   - timePeriod: 30d | 7d | all        (default: 30d)
 *
 * Auth: gated by middleware (Basic auth via WALLET_INTEL_PASSWORD).
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/db';
import { SEVEN_DAYS_MS, THIRTY_DAYS_MS } from '../../../lib/wallet-intel/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ORDER = ['score', 'volume', 'pnl'] as const;
type OrderBy = typeof VALID_ORDER[number];

const VALID_PERIOD = ['30d', '7d', 'all'] as const;
type TimePeriod = typeof VALID_PERIOD[number];

function periodCutoff(p: TimePeriod): Date | null {
  if (p === 'all') return null;
  const windowMs = p === '7d' ? SEVEN_DAYS_MS : THIRTY_DAYS_MS;
  return new Date(Date.now() - windowMs);
}

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const orderByRaw = (url.searchParams.get('orderBy') ?? 'score').toLowerCase();
    const timePeriodRaw = (url.searchParams.get('timePeriod') ?? '30d').toLowerCase();

    if (!(VALID_ORDER as readonly string[]).includes(orderByRaw)) {
      return NextResponse.json(
        { error: 'invalid_order_by', message: `orderBy must be one of: ${VALID_ORDER.join(',')}` },
        { status: 400 },
      );
    }
    if (!(VALID_PERIOD as readonly string[]).includes(timePeriodRaw)) {
      return NextResponse.json(
        { error: 'invalid_time_period', message: `timePeriod must be one of: ${VALID_PERIOD.join(',')}` },
        { status: 400 },
      );
    }
    const orderBy = orderByRaw as OrderBy;
    const timePeriod = timePeriodRaw as TimePeriod;

    if (!prisma) {
      return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
    }

    const cutoff = periodCutoff(timePeriod);
    const LIMIT = 100;

    // Step 1: pick candidate walletIds via the primary metric.
    let candidateIds: string[] = [];

    if (orderBy === 'score') {
      const rows = await prisma.walletScore.findMany({
        orderBy: { totalScore: 'desc' },
        take: LIMIT,
        select: { walletId: true },
      });
      candidateIds = rows.map(r => r.walletId);
    } else if (orderBy === 'volume') {
      const grouped = await prisma.walletTrade.groupBy({
        by: ['walletId'],
        where: cutoff ? { tradeTimestamp: { gte: cutoff } } : {},
        _sum: { valueUsd: true },
        orderBy: { _sum: { valueUsd: 'desc' } },
        take: LIMIT,
      });
      candidateIds = grouped.map(g => g.walletId);
    } else {
      // pnl: sum WalletPosition.pnlUsd from the *latest snapshot* per wallet.
      // Prisma groupBy can't express "latest per group" cleanly without raw SQL
      // and we want to keep this read-only & portable. Strategy:
      //   1. find the global max snapshotDate per wallet via groupBy.
      //   2. fetch positions where (walletId, snapshotDate) ∈ that set.
      //   3. aggregate pnlUsd by wallet, sort desc, take 100.
      const groupedDates = await prisma.walletPosition.groupBy({
        by: ['walletId'],
        _max: { snapshotDate: true },
      });
      const pairs = groupedDates
        .filter(g => g._max.snapshotDate != null)
        .map(g => ({ walletId: g.walletId, snapshotDate: g._max.snapshotDate as Date }));
      if (pairs.length === 0) {
        return NextResponse.json({ entries: [], generatedAt: new Date().toISOString() });
      }
      // OR of pairs would be huge; fetch all positions for those walletIds
      // at their max date in one shot via a single IN over walletIds, then
      // filter to (walletId, snapshotDate) matches in JS.
      const walletIdList = pairs.map(p => p.walletId);
      const allPositions = await prisma.walletPosition.findMany({
        where: { walletId: { in: walletIdList } },
        select: { walletId: true, snapshotDate: true, pnlUsd: true },
      });
      const dateByWallet = new Map(pairs.map(p => [p.walletId, p.snapshotDate.getTime()]));
      const pnlByWallet = new Map<string, number>();
      for (const p of allPositions) {
        if (p.snapshotDate.getTime() === dateByWallet.get(p.walletId)) {
          pnlByWallet.set(p.walletId, (pnlByWallet.get(p.walletId) ?? 0) + p.pnlUsd);
        }
      }
      candidateIds = Array.from(pnlByWallet.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, LIMIT)
        .map(([id]) => id);
    }

    if (candidateIds.length === 0) {
      return NextResponse.json({ entries: [], generatedAt: new Date().toISOString() });
    }

    // Step 2: hydrate each candidate with profile, score, volume30d, pnl.
    const [wallets, volumeGrouped, latestPositionDates] = await Promise.all([
      prisma.wallet.findMany({
        where: { id: { in: candidateIds } },
        include: {
          profile: { select: { username: true } },
          score: { select: { totalScore: true, flagCount: true } },
        },
      }),
      prisma.walletTrade.groupBy({
        by: ['walletId'],
        where: {
          walletId: { in: candidateIds },
          tradeTimestamp: { gte: new Date(Date.now() - THIRTY_DAYS_MS) },
        },
        _sum: { valueUsd: true },
      }),
      prisma.walletPosition.groupBy({
        by: ['walletId'],
        where: { walletId: { in: candidateIds } },
        _max: { snapshotDate: true },
      }),
    ]);

    const volumeByWallet = new Map(
      volumeGrouped.map(g => [g.walletId, g._sum.valueUsd ?? 0]),
    );
    const latestDateByWallet = new Map(
      latestPositionDates
        .filter(g => g._max.snapshotDate != null)
        .map(g => [g.walletId, (g._max.snapshotDate as Date).getTime()]),
    );

    // PnL hydration: pull positions at latest snapshot per candidate.
    const positionsForPnl = await prisma.walletPosition.findMany({
      where: { walletId: { in: candidateIds } },
      select: { walletId: true, snapshotDate: true, pnlUsd: true },
    });
    const pnlByWallet = new Map<string, number>();
    for (const p of positionsForPnl) {
      if (p.snapshotDate.getTime() === latestDateByWallet.get(p.walletId)) {
        pnlByWallet.set(p.walletId, (pnlByWallet.get(p.walletId) ?? 0) + p.pnlUsd);
      }
    }

    const walletById = new Map(wallets.map(w => [w.id, w]));

    // Preserve the candidate ordering established in step 1.
    const entries = candidateIds
      .map(id => {
        const w = walletById.get(id);
        if (!w) return null;
        return {
          proxyAddress: w.proxyAddress,
          username: w.profile?.username ?? undefined,
          totalScore: w.score?.totalScore ?? null,
          flagCount: w.score?.flagCount ?? null,
          totalVolume30d: volumeByWallet.get(id) ?? 0,
          currentPnlUsd: pnlByWallet.get(id) ?? 0,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    return NextResponse.json({ entries, generatedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[wallet-intel-api] leaderboard GET failed:', error);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
