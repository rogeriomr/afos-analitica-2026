/**
 * POST /api/wallet-intel/admin/run-detection
 *
 * Manually triggers the red-flag detection pipeline and then recomputes
 * all wallet scores. Accepts an optional JSON body to restrict the run
 * to specific walletIds or marketConditionIds.
 *
 * Auth: gated by middleware (Basic auth via WALLET_INTEL_PASSWORD).
 */

import { NextResponse } from 'next/server';
import { runDetection } from '../../../../lib/wallet-intel/detector';
import { recomputeAllScores } from '../../../../lib/wallet-intel/scoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AdminRunBody {
  walletIds?: string[];
  marketConditionIds?: string[];
}

function parseBody(raw: unknown): AdminRunBody {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const out: AdminRunBody = {};
  if (Array.isArray(obj.walletIds)) {
    out.walletIds = obj.walletIds.filter((v): v is string => typeof v === 'string');
  }
  if (Array.isArray(obj.marketConditionIds)) {
    out.marketConditionIds = obj.marketConditionIds.filter(
      (v): v is string => typeof v === 'string',
    );
  }
  return out;
}

export async function POST(request: Request) {
  try {
    let body: AdminRunBody = {};
    try {
      const text = await request.text();
      if (text.trim().length > 0) {
        body = parseBody(JSON.parse(text));
      }
    } catch (e) {
      return NextResponse.json(
        { error: 'invalid_json', message: e instanceof Error ? e.message : 'parse failed' },
        { status: 400 },
      );
    }

    const result = await runDetection(body);
    // Best-effort score recomputation. Failure here should not mask a
    // successful detection run, so we surface the error but still return 200.
    try {
      await recomputeAllScores();
    } catch (e) {
      console.error('[wallet-intel-admin] recomputeAllScores failed:', e);
    }

    return NextResponse.json({
      walletsEvaluated: result.walletsEvaluated,
      flagsRaised: result.flagsRaised,
      durationMs: result.durationMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[wallet-intel-admin] run-detection POST failed:', error);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
