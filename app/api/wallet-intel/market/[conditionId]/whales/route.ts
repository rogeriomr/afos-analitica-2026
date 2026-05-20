/**
 * GET /api/wallet-intel/market/[conditionId]/whales?timeframe=24h|7d|30d|all
 *
 * Top 20 wallets by sum(valueUsd) of WalletTrade for the market over the
 * requested timeframe (default `30d`). Joined with Wallet profile +
 * WalletScore (when available). Also cross-references the latest
 * `MarketHolderSnapshot` to surface each whale's % of observed supply
 * on outcomeIndex 0 ("YES") and outcomeIndex 1 ("NO") — null when the
 * whale doesn't appear in the snapshot.
 *
 * Auth: gated by middleware (Basic auth via WALLET_INTEL_PASSWORD).
 */

import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import {
  ONE_DAY_MS,
  SEVEN_DAYS_MS,
  THIRTY_DAYS_MS,
} from '../../../../../lib/wallet-intel/queries';
import { isValidConditionId } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Timeframe = '24h' | '7d' | '30d' | 'all';
const VALID_TIMEFRAMES: ReadonlySet<Timeframe> = new Set(['24h', '7d', '30d', 'all']);

function parseTimeframe(raw: string | null): Timeframe {
  if (!raw) return '30d';
  return (VALID_TIMEFRAMES.has(raw as Timeframe) ? raw : '30d') as Timeframe;
}

function sinceFor(tf: Timeframe): Date | null {
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

// ─── snapshot helpers (mirrors holders/route.ts shape) ────────────────

interface SnapshotEntry {
  proxyAddress: string;
  amount: number;
  outcomeIndex: number;
}

function coerceNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function parseSnapshotHolders(raw: unknown): SnapshotEntry[] {
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

interface SupplyLookup {
  totalsByOutcome: Map<number, number>;
  amountByAddrAndOutcome: Map<string, Map<number, number>>;
}

function buildSupplyLookup(entries: SnapshotEntry[]): SupplyLookup {
  const totalsByOutcome = new Map<number, number>();
  const amountByAddrAndOutcome = new Map<string, Map<number, number>>();
  for (const e of entries) {
    totalsByOutcome.set(e.outcomeIndex, (totalsByOutcome.get(e.outcomeIndex) ?? 0) + e.amount);
    let inner = amountByAddrAndOutcome.get(e.proxyAddress);
    if (!inner) {
      inner = new Map<number, number>();
      amountByAddrAndOutcome.set(e.proxyAddress, inner);
    }
    inner.set(e.outcomeIndex, (inner.get(e.outcomeIndex) ?? 0) + e.amount);
  }
  return { totalsByOutcome, amountByAddrAndOutcome };
}

/**
 * Compute the wallet's holding on `outcomeIndex` as a % of total observed
 * supply for that outcome. Returns null when (a) supply lookup missing,
 * (b) total for that outcome is 0/missing, or (c) the wallet is not a
 * holder on this outcome.
 */
function supplyPctFor(
  lookup: SupplyLookup | null,
  proxyAddress: string,
  outcomeIndex: number,
): number | null {
  if (!lookup) return null;
  const total = lookup.totalsByOutcome.get(outcomeIndex);
  if (!total || total <= 0) return null;
  const inner = lookup.amountByAddrAndOutcome.get(proxyAddress);
  if (!inner) return null;
  const amt = inner.get(outcomeIndex);
  if (amt == null || amt <= 0) return null;
  return Math.min(100, (amt / total) * 100);
}

export async function GET(
  request: Request,
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

    const url = new URL(request.url);
    const timeframe = parseTimeframe(url.searchParams.get('timeframe'));
    const since = sinceFor(timeframe);

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

    if (grouped.length === 0) {
      return NextResponse.json({ conditionId, timeframe, whales: [] });
    }

    const walletIds = grouped.map(g => g.walletId);
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
    const walletById = new Map(wallets.map(w => [w.id, w]));

    // Build the supply lookup once; multi-outcome markets (>2) are
    // outside today's scope — for those, yesSupplyPct/noSupplyPct
    // still reference outcomeIndex 0/1 only and may be null for outcomes
    // 2+. Revisit if/when the schema supports non-binary markets.
    const supplyLookup = snapshot
      ? buildSupplyLookup(parseSnapshotHolders(snapshot.holdersJson))
      : null;

    const whales = grouped
      .map(g => {
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
          yesSupplyPct: supplyPctFor(supplyLookup, addr, 0),
          noSupplyPct: supplyPctFor(supplyLookup, addr, 1),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    return NextResponse.json({ conditionId, timeframe, whales });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[wallet-intel-api] market/[conditionId]/whales GET failed:', error);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
