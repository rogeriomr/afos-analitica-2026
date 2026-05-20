/**
 * Cron Job: /api/cron/refresh-wallets
 *
 * Vercel cron (every 2h) → Polymarket data-api (/holders, /positions, /trades,
 * /value, /profile) → Neon (wallet schema). Auth via Bearer CRON_SECRET; bypassed
 * outside Vercel for local dev (matches refresh-elections/refresh-polls).
 */

import { NextResponse } from 'next/server'
import { refreshWalletData } from '../../../lib/wallet-intel/ingest'
import { buildNoCacheHeaders } from '../../../lib/cache/headers'
import { requireCronAuth } from '../../../../lib/cron/auth'

// Prisma + adapter-neon both need the Node.js runtime.
export const runtime = 'nodejs'

// Vercel Hobby cron hard cap is 60s; ingest.ts uses a 45s soft budget.
export const maxDuration = 60

export async function GET(request: Request): Promise<NextResponse> {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  const startedAt = Date.now()

  try {
    console.log('[cron-wallets] Starting wallet intelligence refresh...')
    const result = await refreshWalletData()
    console.log(
      `[cron-wallets] Done — markets ${result.marketsProcessed}, wallets ${result.walletsProcessed} ok / ${result.walletsSkipped} skipped, trades +${result.tradesInserted} / dedup ${result.tradesSkipped}, ${result.durationMs}ms${result.partial ? ' (partial)' : ''}`,
    )
    return NextResponse.json(result, { status: 200, headers: buildNoCacheHeaders() })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cron-wallets] Ingest failed:', message)
    return NextResponse.json(
      { error: 'ingest_failed', message, elapsed: Date.now() - startedAt },
      { status: 500, headers: buildNoCacheHeaders() },
    )
  }
}
