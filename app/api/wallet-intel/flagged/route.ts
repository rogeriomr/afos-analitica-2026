/**
 * GET /api/wallet-intel/flagged
 *
 * Returns wallets with active red flags, ordered by WalletScore.totalScore DESC.
 * Each wallet includes its top-3 most-recently-triggered flags.
 *
 * Query params:
 *   - severity: CSV of low|medium|high|critical (filter: only wallets with at
 *     least one RedFlag of these severities)
 *   - limit:    1..200, default 50
 *   - offset:   >=0, default 0
 *
 * Auth: gated by middleware (Basic auth via WALLET_INTEL_PASSWORD).
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/db';
import { parseSeverityFilter, parseIntParam, type Severity } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const severityRaw = url.searchParams.get('severity');
    const severities = parseSeverityFilter(severityRaw);
    if (severities === 'invalid') {
      return NextResponse.json(
        { error: 'invalid_severity', message: 'severity must be CSV of: low,medium,high,critical' },
        { status: 400 },
      );
    }

    const limit = parseIntParam(url.searchParams.get('limit'), 50, 1, 200);
    if (limit === 'invalid') {
      return NextResponse.json(
        { error: 'invalid_limit', message: 'limit must be integer in [1, 200]' },
        { status: 400 },
      );
    }
    const offset = parseIntParam(url.searchParams.get('offset'), 0, 0, 1_000_000);
    if (offset === 'invalid') {
      return NextResponse.json(
        { error: 'invalid_offset', message: 'offset must be non-negative integer' },
        { status: 400 },
      );
    }

    if (!prisma) {
      return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
    }

    // Filter: wallets that have at least one RedFlag (optionally of the
    // requested severities). We resolve to a set of walletIds first so we
    // can paginate by score afterward.
    const flagWhere: { severity?: { in: Severity[] } } = {};
    if (severities && severities.length > 0) {
      flagWhere.severity = { in: severities };
    }

    // Distinct walletIds matching the flag filter.
    const flaggedWalletRows = await prisma.redFlag.findMany({
      where: flagWhere,
      select: { walletId: true },
      distinct: ['walletId'],
    });
    const flaggedWalletIds = flaggedWalletRows.map(r => r.walletId);
    const total = flaggedWalletIds.length;

    if (total === 0) {
      return NextResponse.json({ wallets: [], total: 0, limit, offset });
    }

    // Pull wallet + score + profile for all candidates, then sort + paginate
    // in JS. Total cardinality is bounded by # flagged wallets (small).
    const wallets = await prisma.wallet.findMany({
      where: { id: { in: flaggedWalletIds } },
      include: {
        profile: { select: { username: true } },
        score: {
          select: {
            totalScore: true,
            flagCount: true,
            highSeverityCount: true,
            lastComputedAt: true,
          },
        },
      },
    });

    // Sort: totalScore DESC, then firstSeenAt DESC for ties. Wallets without
    // a score row sort last (treat as -Infinity).
    wallets.sort((a, b) => {
      const aScore = a.score?.totalScore ?? -Infinity;
      const bScore = b.score?.totalScore ?? -Infinity;
      if (aScore !== bScore) return bScore - aScore;
      return b.firstSeenAt.getTime() - a.firstSeenAt.getTime();
    });

    const page = wallets.slice(offset, offset + limit);

    // Fetch top-3 flags per page wallet. Page size <=200 so N+1 is acceptable;
    // batch into a single findMany then group, ordered desc by triggeredAt.
    const pageIds = page.map(w => w.id);
    const allFlagsForPage = pageIds.length === 0
      ? []
      : await prisma.redFlag.findMany({
          where: { walletId: { in: pageIds }, ...flagWhere },
          orderBy: { triggeredAt: 'desc' },
          select: {
            walletId: true,
            ruleKey: true,
            severity: true,
            triggeredAt: true,
            marketConditionId: true,
          },
        });

    const flagsByWallet = new Map<string, typeof allFlagsForPage>();
    for (const f of allFlagsForPage) {
      const arr = flagsByWallet.get(f.walletId) ?? [];
      if (arr.length < 3) arr.push(f);
      flagsByWallet.set(f.walletId, arr);
    }

    const responseWallets = page.map(w => ({
      proxyAddress: w.proxyAddress,
      username: w.profile?.username ?? undefined,
      totalScore: w.score?.totalScore ?? 0,
      flagCount: w.score?.flagCount ?? 0,
      highSeverityCount: w.score?.highSeverityCount ?? 0,
      lastComputedAt: w.score?.lastComputedAt?.toISOString() ?? null,
      topFlags: (flagsByWallet.get(w.id) ?? []).map(f => ({
        ruleKey: f.ruleKey,
        severity: f.severity,
        triggeredAt: f.triggeredAt.toISOString(),
        marketConditionId: f.marketConditionId ?? undefined,
      })),
    }));

    return NextResponse.json({ wallets: responseWallets, total, limit, offset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[wallet-intel-api] flagged GET failed:', error);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
