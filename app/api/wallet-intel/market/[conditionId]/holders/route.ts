/**
 * GET /api/wallet-intel/market/[conditionId]/holders
 *
 * Returns latest holder snapshot for the market broken down **per outcome**.
 * For each outcome we expose the top-15 holders along with their share of
 * observed supply, plus per-outcome top-5/top-10 concentration metrics.
 *
 * Auth: gated by middleware (Basic auth via WALLET_INTEL_PASSWORD).
 */

import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import { isValidConditionId } from '../../../_shared';
import {
  getMarketOutcomes,
  getMarketQuestion,
} from '../../../../../lib/wallet-intel/market-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOP_PER_OUTCOME = 15;

interface HolderEntry {
  proxyAddress: string;
  amount: number;
  outcomeIndex: number;
  username?: string;
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
    // Field is `holder` per app/lib/wallet-intel/client.ts:parseHolder (the canonical
    // wallet-intel shape persisted into MarketHolderSnapshot.holdersJson). Aliases
    // kept for backward-compat with any legacy snapshot rows.
    const addr = (obj.holder ?? obj.proxyAddress ?? obj.address ?? obj.proxy_address) as unknown;
    if (typeof addr !== 'string') continue;
    const outcomeIndexRaw =
      typeof obj.outcomeIndex === 'number'
        ? obj.outcomeIndex
        : typeof obj.outcome_index === 'number'
          ? obj.outcome_index
          : 0;
    const usernameRaw = obj.username;
    const entry: HolderEntry = {
      proxyAddress: addr.toLowerCase(),
      amount: coerceNumber(obj.amount ?? obj.size ?? obj.shares),
      outcomeIndex: Number.isInteger(outcomeIndexRaw) ? outcomeIndexRaw : 0,
    };
    if (typeof usernameRaw === 'string' && usernameRaw.length > 0) {
      entry.username = usernameRaw;
    }
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

    // Group by outcomeIndex.
    const byOutcome = new Map<number, HolderEntry[]>();
    for (const h of holders) {
      const arr = byOutcome.get(h.outcomeIndex);
      if (arr) arr.push(h);
      else byOutcome.set(h.outcomeIndex, [h]);
    }

    // Metadata lookups (best-effort; never block the response).
    const [outcomeMeta, marketQuestion] = await Promise.all([
      getMarketOutcomes(conditionId).catch(() => []),
      getMarketQuestion(conditionId).catch(() => null),
    ]);
    const outcomeNameByIndex = new Map<number, string>(
      outcomeMeta.map((o) => [o.index, o.name]),
    );

    // Enrich top holders across all outcomes with usernames from WalletProfile.
    const allTopAddresses = new Set<string>();
    for (const [, group] of byOutcome) {
      group.sort((a, b) => b.amount - a.amount);
      for (const h of group.slice(0, TOP_PER_OUTCOME)) {
        allTopAddresses.add(h.proxyAddress);
      }
    }
    const usernameByAddress = new Map<string, string>();
    if (allTopAddresses.size > 0) {
      const walletRows = await prisma.wallet.findMany({
        where: { proxyAddress: { in: Array.from(allTopAddresses) } },
        select: { proxyAddress: true, profile: { select: { username: true } } },
      });
      for (const w of walletRows) {
        if (w.profile?.username) usernameByAddress.set(w.proxyAddress, w.profile.username);
      }
    }

    // Build the ordered outcome list: union of metadata indices and indices
    // actually present in holdersJson (covers the "metadata not yet populated"
    // case gracefully without dropping outcomes from the snapshot).
    const indexSet = new Set<number>();
    for (const o of outcomeMeta) indexSet.add(o.index);
    for (const k of byOutcome.keys()) indexSet.add(k);
    const orderedIndices = Array.from(indexSet).sort((a, b) => a - b);

    const outcomes = orderedIndices.map((index) => {
      const group = byOutcome.get(index) ?? [];
      // group is already sorted desc above (or empty).
      const totalObservedSupply = group.reduce((acc, h) => acc + h.amount, 0);
      const sumOf = (n: number) =>
        group.slice(0, n).reduce((acc, h) => acc + h.amount, 0);
      const concentrationTop5Pct =
        totalObservedSupply > 0
          ? Math.min(100, (sumOf(5) / totalObservedSupply) * 100)
          : 0;
      const concentrationTop10Pct =
        totalObservedSupply > 0
          ? Math.min(100, (sumOf(10) / totalObservedSupply) * 100)
          : 0;

      const topHolders = group.slice(0, TOP_PER_OUTCOME).map((h) => ({
        proxyAddress: h.proxyAddress,
        username:
          usernameByAddress.get(h.proxyAddress) ?? h.username ?? null,
        amount: h.amount,
        sharePct:
          totalObservedSupply > 0 ? (h.amount / totalObservedSupply) * 100 : 0,
      }));

      return {
        index,
        name: outcomeNameByIndex.get(index) ?? null,
        totalObservedSupply,
        holderCount: group.length,
        topHolders,
        concentrationTop5Pct,
        concentrationTop10Pct,
      };
    });

    return NextResponse.json({
      conditionId,
      marketSlug: snapshot.marketSlug,
      marketQuestion: marketQuestion ?? null,
      latestSnapshotAt: snapshot.snapshotAt.toISOString(),
      totalHolders: snapshot.totalHolders,
      outcomes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[wallet-intel-api] market/[conditionId]/holders GET failed:', error);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
