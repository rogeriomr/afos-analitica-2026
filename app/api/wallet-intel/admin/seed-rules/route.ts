/**
 * POST /api/wallet-intel/admin/seed-rules
 *
 * Idempotently upserts FlagRule rows from the in-code rule registry.
 * Safe to re-run; admin-tuned thresholds / disabled flags are preserved
 * by the underlying seedFlagRules implementation.
 *
 * Auth: gated by middleware (Basic auth via WALLET_INTEL_PASSWORD).
 */

import { NextResponse } from 'next/server';
import { seedFlagRules } from '../../../../lib/wallet-intel/seed-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await seedFlagRules();
    return NextResponse.json({
      created: result.created,
      updated: result.updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[wallet-intel-admin] seed-rules POST failed:', error);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
