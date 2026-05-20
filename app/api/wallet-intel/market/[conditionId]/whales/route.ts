/**
 * GET /api/wallet-intel/market/[conditionId]/whales
 *
 * Top 20 wallets by sum(valueUsd) of WalletTrade for the market over the
 * last 30 days. Joined with Wallet profile + WalletScore (when available).
 *
 * Auth: gated by middleware (Basic auth via WALLET_INTEL_PASSWORD).
 */

import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import { THIRTY_DAYS_MS } from '../../../../../lib/wallet-intel/queries';
import { isValidConditionId } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ conditionId: string }> },
) {
  try {
    const { conditionId: raw } = await context.params;
    const conditionId = raw.toLowerCase();
    if (!isValidConditionId(conditionId)) {
      return NextResponse.json(
        { error: 'invalid_condition_id', message: 'conditionId must match /^0x[a-f0-9]{64}$/' },
        { status: 400 },
      );
    }

    if (!prisma) {
      return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
    }

    const since = new Date(Date.now() - THIRTY_DAYS_MS);

    const grouped = await prisma.walletTrade.groupBy({
      by: ['walletId'],
      where: {
        marketConditionId: conditionId,
        tradeTimestamp: { gte: since },
      },
      _sum: { valueUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { valueUsd: 'desc' } },
      take: 20,
    });

    if (grouped.length === 0) {
      return NextResponse.json({ conditionId, whales: [] });
    }

    const walletIds = grouped.map(g => g.walletId);
    const wallets = await prisma.wallet.findMany({
      where: { id: { in: walletIds } },
      include: {
        profile: { select: { username: true } },
        score: { select: { totalScore: true, flagCount: true } },
      },
    });
    const walletById = new Map(wallets.map(w => [w.id, w]));

    const whales = grouped
      .map(g => {
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

    return NextResponse.json({ conditionId, whales });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[wallet-intel-api] market/[conditionId]/whales GET failed:', error);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
