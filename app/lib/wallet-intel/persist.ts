/**
 * Wallet Intelligence → Neon Persistence
 *
 * Mirrors app/lib/polymarket/persist.ts in style: per-row try/catch, P2002
 * swallow on unique-constraint races, structured warnings, and "never throw
 * from the cron" semantics. Each exported helper persists one logical entity
 * (snapshot / wallet / profile / positions / trades / value) — the orchestrator
 * in ingest.ts composes them.
 *
 * Hash strategy: WalletTrade.dedupHash = sha256(`${txHash}:${asset}:${side}:${size}:${price}`)
 * sliced to 32 chars. `price` is included so partial fills at different prices
 * inside the same on-chain tx (rare but possible — multi-leg fills) are kept
 * distinct. Two-layer dedup (Redis 6h refresh marker + DB unique hash)
 * guarantees no double-inserts even across overlapping cron runs.
 */

import { createHash } from 'crypto'
import { prisma } from '../../../lib/db'
import type {
  PolymarketHolder,
  PolymarketPosition,
  PolymarketProfile,
  PolymarketTrade,
} from './types'

// ─── Constants ──────────────────────────────────────────────────────

const BUCKET_15_MIN_MS = 15 * 60 * 1000

// ─── Helpers ────────────────────────────────────────────────────────

/** Bucket a timestamp down to the nearest 15-minute boundary (UTC). */
function bucket15Min(ts: Date): Date {
  const ms = ts.getTime()
  return new Date(Math.floor(ms / BUCKET_15_MIN_MS) * BUCKET_15_MIN_MS)
}

/** Bucket a date down to 00:00:00 UTC of the same calendar day. */
function bucketStartOfDayUtc(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

/** Normalize a wallet address to lowercase 0x+40 hex. Returns null if invalid. */
function normalizeAddress(addr: string | undefined | null): string | null {
  if (!addr || typeof addr !== 'string') return null
  const lower = addr.toLowerCase().trim()
  if (!/^0x[a-f0-9]{40}$/.test(lower)) return null
  return lower
}

function isP2002(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
}

function makeTradeDedupHash(
  txHash: string,
  asset: string,
  side: string,
  size: number,
  price: number,
): string {
  // Include `price` so multi-leg fills at different prices in the same on-chain
  // tx aren't collapsed into one row by the unique constraint.
  return createHash('sha256')
    .update(`${txHash}:${asset}:${side}:${size}:${price}`)
    .digest('hex')
    .slice(0, 32)
}

// ─── 1. Market holder snapshot ─────────────────────────────────────

/**
 * Upsert a 15-min bucketed snapshot of a market's top holders. Composite
 * unique (marketConditionId, snapshotAt) means concurrent crons in the same
 * bucket are idempotent — second writer hits P2002 and we swallow.
 */
export async function persistMarketHolderSnapshot(args: {
  conditionId: string
  marketSlug: string
  holders: PolymarketHolder[]
  snapshotAt: Date
}): Promise<void> {
  if (!prisma) return
  const snapshotAt = bucket15Min(args.snapshotAt)

  try {
    await prisma.marketHolderSnapshot.upsert({
      where: {
        marketConditionId_snapshotAt: {
          marketConditionId: args.conditionId,
          snapshotAt,
        },
      },
      update: {
        holdersJson: args.holders as unknown as object,
        totalHolders: args.holders.length,
        marketSlug: args.marketSlug,
      },
      create: {
        marketConditionId: args.conditionId,
        marketSlug: args.marketSlug,
        snapshotAt,
        holdersJson: args.holders as unknown as object,
        totalHolders: args.holders.length,
      },
    })
  } catch (err) {
    if (isP2002(err)) return
    console.warn(
      `[wallet-persist] Snapshot ${args.conditionId} failed:`,
      err instanceof Error ? err.message : err,
    )
  }
}

// ─── 2. Wallet upsert ──────────────────────────────────────────────

/**
 * Upsert a Wallet row. `firstSeenAt` is only set on insert (Prisma upsert
 * `update` block omits it); `lastSeenAt` is bumped every refresh.
 *
 * Returns the wallet UUID on success, '' on failure (caller skips dependent
 * writes when the id is empty).
 */
export async function persistWallet(holder: {
  proxyAddress: string
  username?: string
}): Promise<string> {
  if (!prisma) return ''
  const addr = normalizeAddress(holder.proxyAddress)
  if (!addr) return ''
  const now = new Date()

  try {
    const row = await prisma.wallet.upsert({
      where: { proxyAddress: addr },
      update: { lastSeenAt: now },
      create: {
        proxyAddress: addr,
        proxyType: 'unknown',
        firstSeenAt: now,
        lastSeenAt: now,
        active: true,
      },
      select: { id: true },
    })
    return row.id
  } catch (err) {
    if (isP2002(err)) {
      // Concurrent upsert collision (two crons / two markets racing on the
      // same wallet). The other writer will have completed; we still return
      // '' to signal "skip dependent writes this tick" — the next refresh
      // cycle (6h via Redis marker, or sooner if marker absent) will pick
      // this wallet up cleanly.
      console.warn(
        `[wallet-persist] concurrent upsert collision for ${addr}, will retry next tick`,
      )
      return ''
    }
    console.warn(
      `[wallet-persist] Wallet upsert ${addr} failed:`,
      err instanceof Error ? err.message : err,
    )
    return ''
  }
}

// ─── 3. Wallet profile ─────────────────────────────────────────────

/**
 * Upsert a WalletProfile row. When `profile` is null we still bump
 * `lastFetchedAt` so the orchestrator's "stale profile" check (V2) can
 * tell "we looked and got nothing" from "we never looked".
 */
export async function persistWalletProfile(
  walletId: string,
  profile: PolymarketProfile | null,
): Promise<void> {
  if (!prisma || !walletId) return
  const now = new Date()

  try {
    if (!profile) {
      // Mark as fetched, leave fields untouched on existing rows; insert empty stub if absent.
      await prisma.walletProfile.upsert({
        where: { walletId },
        update: { lastFetchedAt: now },
        create: { walletId, verifiedBadge: false, lastFetchedAt: now },
      })
      return
    }

    await prisma.walletProfile.upsert({
      where: { walletId },
      update: {
        pseudonym: profile.pseudonym ?? null,
        username: profile.name ?? null,
        xUsername: profile.xUsername ?? null,
        profileImageUrl: profile.profileImage ?? null,
        lastFetchedAt: now,
      },
      create: {
        walletId,
        pseudonym: profile.pseudonym ?? null,
        username: profile.name ?? null,
        xUsername: profile.xUsername ?? null,
        profileImageUrl: profile.profileImage ?? null,
        verifiedBadge: false,
        lastFetchedAt: now,
      },
    })
  } catch (err) {
    console.warn(
      `[wallet-persist] Profile upsert ${walletId} failed:`,
      err instanceof Error ? err.message : err,
    )
  }
}

// ─── 4. Wallet positions ───────────────────────────────────────────

/**
 * Upsert today's positions snapshot. Unique key is
 * (walletId, marketConditionId, outcomeIndex, snapshotDate) so running the
 * cron twice on the same day overwrites with the latest values rather than
 * duplicating. snapshotDate is bucketed to UTC start-of-day.
 *
 * Returns count of successfully written rows (best-effort).
 */
export async function persistWalletPositions(
  walletId: string,
  positions: PolymarketPosition[],
  snapshotDate: Date,
): Promise<number> {
  if (!prisma || !walletId || positions.length === 0) return 0
  const day = bucketStartOfDayUtc(snapshotDate)
  let written = 0

  for (const p of positions) {
    // Resolve a marketSlug — the data-api position doesn't carry it; fall back
    // to title (truncated) so the column is non-null. ingest.ts overrides this
    // when it knows the registry slug for that conditionId.
    const marketSlug = (p.title || p.conditionId).slice(0, 200)

    try {
      await prisma.walletPosition.upsert({
        where: {
          walletId_marketConditionId_outcomeIndex_snapshotDate: {
            walletId,
            marketConditionId: p.conditionId,
            outcomeIndex: p.outcomeIndex,
            snapshotDate: day,
          },
        },
        update: {
          marketSlug,
          outcomeName: p.outcomeName,
          size: p.size,
          avgPrice: p.avgPrice,
          currentValueUsd: p.currentValue,
          pnlUsd: p.cashPnl,
          pnlPercent: p.percentPnl,
        },
        create: {
          walletId,
          marketConditionId: p.conditionId,
          marketSlug,
          outcomeIndex: p.outcomeIndex,
          outcomeName: p.outcomeName,
          size: p.size,
          avgPrice: p.avgPrice,
          currentValueUsd: p.currentValue,
          pnlUsd: p.cashPnl,
          pnlPercent: p.percentPnl,
          snapshotDate: day,
        },
      })
      written++
    } catch (err) {
      if (isP2002(err)) continue
      console.warn(
        `[wallet-persist] Position ${walletId}/${p.conditionId} failed:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return written
}

// ─── 5. Wallet trades ──────────────────────────────────────────────

/**
 * Insert trades for a wallet. Dedup key = sha256(txHash:asset:side:size) sliced
 * to 32 chars — this catches both (a) the same trade appearing in two cron
 * runs and (b) the rare case where Polymarket returns the same trade twice
 * in one response.
 *
 * `marketSlug` is supplied by the caller (the orchestrator), since the
 * /trades response doesn't always populate `title` reliably.
 */
export async function persistWalletTrades(
  walletId: string,
  marketSlug: string,
  trades: PolymarketTrade[],
): Promise<{ inserted: number; skipped: number }> {
  if (!prisma || !walletId || trades.length === 0) {
    return { inserted: 0, skipped: 0 }
  }

  let inserted = 0
  let skipped = 0

  for (const t of trades) {
    const dedupHash = makeTradeDedupHash(t.transactionHash, t.asset, t.side, t.size, t.price)
    const valueUsd = t.size * t.price
    const tradeTimestamp = new Date(t.timestamp * 1000)

    try {
      await prisma.walletTrade.create({
        data: {
          walletId,
          marketConditionId: t.conditionId,
          marketSlug,
          side: t.side,
          assetTokenId: t.asset,
          outcomeIndex: t.outcomeIndex,
          size: t.size,
          price: t.price,
          valueUsd,
          transactionHash: t.transactionHash,
          tradeTimestamp,
          dedupHash,
        },
      })
      inserted++
    } catch (err) {
      if (isP2002(err)) {
        skipped++
        continue
      }
      console.warn(
        `[wallet-persist] Trade ${walletId}/${t.transactionHash} failed:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return { inserted, skipped }
}

// ─── 6. Wallet chain-first-activity ────────────────────────────────

/**
 * Persist the on-chain "first activity" timestamp for a wallet. This is an
 * approximation derived in ingest.ts from the earliest fetched trade — a true
 * wallet age requires a Polygon RPC sweep (V2). The value is monotonic going
 * backwards: once stored, we only overwrite when the new candidate is EARLIER
 * (a later refresh might surface a still-older trade as we paginate). NULL or
 * later values are ignored so we don't clobber a known-good value.
 */
export async function persistChainFirstActivity(
  walletId: string,
  chainFirstActivityAt: Date | null,
): Promise<void> {
  if (!prisma || !walletId || !chainFirstActivityAt) return

  try {
    const existing = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { chainFirstActivityAt: true },
    })
    if (!existing) return

    // Skip if we already have a value AND the new candidate isn't earlier.
    if (
      existing.chainFirstActivityAt &&
      existing.chainFirstActivityAt.getTime() <= chainFirstActivityAt.getTime()
    ) {
      return
    }

    await prisma.wallet.update({
      where: { id: walletId },
      data: { chainFirstActivityAt },
    })
  } catch (err) {
    console.warn(
      `[wallet-persist] ChainFirstActivity update ${walletId} failed:`,
      err instanceof Error ? err.message : err,
    )
  }
}

// ─── 7. Wallet value ───────────────────────────────────────────────

/**
 * Update Wallet.totalValueUsd and bump lastSeenAt. Skips silently if walletId
 * is empty or value is null (we still bumped lastSeenAt in persistWallet).
 */
export async function persistWalletValue(
  walletId: string,
  value: number | null,
): Promise<void> {
  if (!prisma || !walletId) return
  try {
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        totalValueUsd: value ?? undefined,
        lastSeenAt: new Date(),
      },
    })
  } catch (err) {
    console.warn(
      `[wallet-persist] Value update ${walletId} failed:`,
      err instanceof Error ? err.message : err,
    )
  }
}
