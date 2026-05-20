/**
 * GET /api/wallet-intel/wallet/[addr]
 *
 * Full wallet detail view: wallet + profile + positions (last 14 days, latest
 * snapshot per market) + last 200 trades + all flags + score.
 *
 * Auth: gated by middleware (Basic auth via WALLET_INTEL_PASSWORD).
 */

import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { FOURTEEN_DAYS_MS } from '../../../../lib/wallet-intel/queries';
import { isValidAddress } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ addr: string }> },
) {
  try {
    const { addr } = await context.params;
    const proxyAddress = addr.toLowerCase();
    if (!isValidAddress(proxyAddress)) {
      return NextResponse.json(
        { error: 'invalid_address', message: 'addr must match /^0x[a-f0-9]{40}$/' },
        { status: 400 },
      );
    }

    if (!prisma) {
      return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
    }

    const wallet = await prisma.wallet.findUnique({
      where: { proxyAddress },
      include: {
        profile: true,
        score: true,
      },
    });

    if (!wallet) {
      return NextResponse.json(
        { error: 'wallet_not_found', message: `No wallet record for ${proxyAddress}` },
        { status: 404 },
      );
    }

    const now = new Date();
    const d14 = new Date(now.getTime() - FOURTEEN_DAYS_MS);

    // Positions: last 14 days. To deliver "latest snapshot per market", we
    // fetch the window then dedupe in JS keeping the row with the largest
    // snapshotDate per (marketConditionId, outcomeIndex).
    const rawPositions = await prisma.walletPosition.findMany({
      where: { walletId: wallet.id, snapshotDate: { gte: d14 } },
      orderBy: { snapshotDate: 'desc' },
    });

    const positionMap = new Map<string, typeof rawPositions[number]>();
    for (const p of rawPositions) {
      const key = `${p.marketConditionId}::${p.outcomeIndex}`;
      const existing = positionMap.get(key);
      if (!existing || p.snapshotDate > existing.snapshotDate) {
        positionMap.set(key, p);
      }
    }
    const positions = Array.from(positionMap.values()).map(p => ({
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

    const tradeRows = await prisma.walletTrade.findMany({
      where: { walletId: wallet.id },
      orderBy: { tradeTimestamp: 'desc' },
      take: 200,
    });
    const trades = tradeRows.map(t => ({
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

    const flagRows = await prisma.redFlag.findMany({
      where: { walletId: wallet.id },
      orderBy: { triggeredAt: 'desc' },
    });
    const flags = flagRows.map(f => ({
      ruleKey: f.ruleKey,
      severity: f.severity,
      marketConditionId: f.marketConditionId ?? null,
      evidence: f.evidenceJson,
      explanation: f.explanation,
      triggeredAt: f.triggeredAt.toISOString(),
    }));

    return NextResponse.json({
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[wallet-intel-api] wallet/[addr] GET failed:', error);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
