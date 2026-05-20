/**
 * GET /api/wallet-intel/market/[conditionId]/holders
 *
 * Returns latest holder snapshot for the market plus concentration metrics
 * (top-5 and top-10 shares).
 *
 * Auth: gated by middleware (Basic auth via WALLET_INTEL_PASSWORD).
 */

import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import { isValidConditionId } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    const snapshot = await prisma.marketHolderSnapshot.findFirst({
      where: { marketConditionId: conditionId },
      orderBy: { snapshotAt: 'desc' },
    });

    if (!snapshot) {
      return NextResponse.json(
        { error: 'snapshot_not_found', message: `No holder snapshot for ${conditionId}` },
        { status: 404 },
      );
    }

    const holders = parseHolders(snapshot.holdersJson);

    // Sort by amount desc for concentration calc + top holders list.
    holders.sort((a, b) => b.amount - a.amount);

    const totalAmount = holders.reduce((acc, h) => acc + h.amount, 0);
    const sumOf = (n: number) =>
      holders.slice(0, n).reduce((acc, h) => acc + h.amount, 0);
    const concentrationTop5Pct = totalAmount > 0 ? (sumOf(5) / totalAmount) * 100 : 0;
    const concentrationTop10Pct = totalAmount > 0 ? (sumOf(10) / totalAmount) * 100 : 0;

    // Enrich top-10 with usernames from WalletProfile when wallet exists.
    const topTen = holders.slice(0, 10);
    const usernameByAddress = new Map<string, string>();
    if (topTen.length > 0) {
      const walletRows = await prisma.wallet.findMany({
        where: { proxyAddress: { in: topTen.map(h => h.proxyAddress) } },
        select: { proxyAddress: true, profile: { select: { username: true } } },
      });
      for (const w of walletRows) {
        if (w.profile?.username) usernameByAddress.set(w.proxyAddress, w.profile.username);
      }
    }

    const topHolders = topTen.map(h => ({
      proxyAddress: h.proxyAddress,
      username: usernameByAddress.get(h.proxyAddress) ?? undefined,
      amount: h.amount,
      outcomeIndex: h.outcomeIndex ?? 0,
    }));

    return NextResponse.json({
      conditionId,
      marketSlug: snapshot.marketSlug,
      latestSnapshotAt: snapshot.snapshotAt.toISOString(),
      totalHolders: snapshot.totalHolders,
      topHolders,
      concentrationTop5Pct,
      concentrationTop10Pct,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[wallet-intel-api] market/[conditionId]/holders GET failed:', error);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
