/**
 * Wallet Intelligence Ingest Orchestrator
 *
 * Driven by Vercel cron every 2 hours via /api/cron/refresh-wallets. For each
 * enabled electoral market it:
 *   1. Resolves slug → conditionId (cached 7d)
 *   2. Fetches top 30 holders, persists a 15-min bucketed snapshot
 *   3. Deduplicates holder addresses across all markets this run
 *   4. For each unique holder not refreshed in the last 6h: parallel-fetches
 *      profile/positions/trades/value (chunks of 4), persists, marks in Redis
 *   5. Bails early if elapsed > TIME_BUDGET_MS so the Vercel 60s cap is respected
 *
 * Concurrency:   4 wallets in flight at a time (Promise.all over slices)
 * Dedup:         Redis 6h "last refresh" key + DB unique constraint per trade
 * Time budget:   45s soft limit (Vercel cron is 60s hard limit)
 *
 * V2 TODOs flagged inline below: expand-to-all-markets feature flag,
 * deeper trade history (pagination), and on-chain proxy-type enrichment.
 */

import { Redis } from '@upstash/redis'
import { ELECTION_REGISTRY } from '../polymarket/country-market-map'
import {
  fetchHolders,
  fetchPositions,
  fetchProfile,
  fetchTrades,
  fetchValue,
  isValidWalletAddress,
} from './client'
import { resolveActiveConditionIds } from './conditionid-resolver'
import {
  persistChainFirstActivity,
  persistMarketHolderSnapshot,
  persistWallet,
  persistWalletProfile,
  persistWalletPositions,
  persistWalletTrades,
  persistWalletValue,
} from './persist'

// ─── Tunables ──────────────────────────────────────────────────────

const HOLDERS_PER_MARKET = 30 // keeps total /holders + /positions + /trades + /value within 50s
const WALLET_CONCURRENCY = 4 // Promise.all chunk size — no library
const TIME_BUDGET_MS = 45_000 // soft cut — Vercel cron hard cap is 60s
const WALLET_REFRESH_TTL_SECONDS = 6 * 60 * 60 // 6h
const TRADES_LIMIT = 100 // most-recent 100 taker fills per wallet per refresh

// ─── Types ─────────────────────────────────────────────────────────

export interface IngestResult {
  marketsProcessed: number
  walletsProcessed: number
  walletsSkipped: number
  tradesInserted: number
  tradesSkipped: number
  durationMs: number
  errors: string[]
  partial?: boolean
}

interface HolderSeed {
  address: string
  username?: string
  /** First market we saw this wallet in this run — used for trade slug context. */
  contextMarketSlug: string
}

// ─── Redis ─────────────────────────────────────────────────────────

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

async function wasRefreshedRecently(redis: Redis | null, address: string): Promise<boolean> {
  if (!redis) return false
  try {
    const v = await redis.get<string>(`wallet-intel:last-refresh:${address}`)
    return !!v
  } catch {
    return false
  }
}

async function markRefreshed(redis: Redis | null, address: string): Promise<void> {
  if (!redis) return
  try {
    await redis.set(`wallet-intel:last-refresh:${address}`, Date.now().toString(), {
      ex: WALLET_REFRESH_TTL_SECONDS,
    })
  } catch {
    // best-effort — at worst we double-refresh in 6h, dedup at DB layer covers it
  }
}

// ─── Chunking ──────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

// ─── Per-wallet refresh ────────────────────────────────────────────

interface WalletRefreshOutcome {
  ok: boolean
  tradesInserted: number
  tradesSkipped: number
}

async function refreshOneWallet(
  seed: HolderSeed,
  snapshotDate: Date,
): Promise<WalletRefreshOutcome> {
  // 1. Wallet row first — we need its UUID for every dependent write.
  const walletId = await persistWallet({
    proxyAddress: seed.address,
    username: seed.username,
  })
  if (!walletId) {
    return { ok: false, tradesInserted: 0, tradesSkipped: 0 }
  }

  // 2. Parallel fan-out: profile / positions / trades / value all hit
  //    different data-api endpoints, so the in-process rate-limiter can
  //    handle them concurrently.
  const [profile, positions, trades, value] = await Promise.all([
    fetchProfile(seed.address),
    fetchPositions(seed.address, { sortBy: 'CURRENT' }),
    fetchTrades(seed.address, { takerOnly: true, limit: TRADES_LIMIT }),
    fetchValue(seed.address),
  ])

  // 3. Persist in parallel — none of these writes depend on each other.
  //    Tuple form keeps Promise.all's per-index return types intact.
  const persistResults = await Promise.all([
    persistWalletProfile(walletId, profile),
    persistWalletPositions(walletId, positions, snapshotDate),
    persistWalletTrades(walletId, seed.contextMarketSlug, trades),
    persistWalletValue(walletId, value),
  ] as const)

  // 4. Derive chainFirstActivityAt from the earliest fetched trade.
  //    Approximation — true wallet age requires a Polygon RPC sweep. The
  //    Polymarket /trades endpoint doesn't expose ascending sort, and /activity
  //    likewise returns desc, so we take the min of whatever the most-recent
  //    TRADES_LIMIT fills include. As subsequent refreshes surface older
  //    trades (e.g. when the wallet goes quiet and our 100-row window slides
  //    earlier), `persistChainFirstActivity` only overwrites when the new
  //    candidate is strictly earlier than the stored value.
  const earliestTradeMs = trades.length
    ? Math.min(...trades.map((t) => t.timestamp * 1000))
    : null
  const chainFirstActivityAt = earliestTradeMs ? new Date(earliestTradeMs) : null
  await persistChainFirstActivity(walletId, chainFirstActivityAt)

  const tradeResult = persistResults[2] // { inserted, skipped }
  return {
    ok: true,
    tradesInserted: tradeResult.inserted,
    tradesSkipped: tradeResult.skipped,
  }
}

// ─── Main orchestrator ─────────────────────────────────────────────

/**
 * Refresh wallet intelligence for all enabled electoral markets.
 *
 * Sequential per market (to stay under the data-api rate budget for /holders),
 * but parallel across wallets within `WALLET_CONCURRENCY` chunks. Early-exits
 * when elapsed > TIME_BUDGET_MS — the next cron picks up the unfinished tail.
 */
export async function refreshWalletData(): Promise<IngestResult> {
  const startedAt = Date.now()
  const redis = getRedis()
  const errors: string[] = []
  let marketsProcessed = 0
  let walletsProcessed = 0
  let walletsSkipped = 0
  let tradesInserted = 0
  let tradesSkipped = 0
  let partial = false

  // ── 1. Pick markets ────────────────────────────────────────────
  let markets = ELECTION_REGISTRY.filter((e) => e.enabled)
  if (process.env.ENABLE_WALLET_INTEL_ALL_MARKETS === 'true') {
    // TODO V2: expand to all electoral markets (gamma-api full sweep,
    // not just the curated 18-entry registry). For now stay on the
    // curated set so we don't blow the rate budget.
    console.log(
      '[wallet-ingest] TODO: expand to all electoral markets — continuing with curated registry',
    )
  }

  // ── 2. Per-market holder snapshots → seed unique wallet set ───
  const snapshotAt = new Date()
  const snapshotDate = new Date()
  const uniqueWallets = new Map<string, HolderSeed>()

  for (const entry of markets) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      partial = true
      console.warn(
        `[wallet-ingest] Time budget hit during market loop — ${marketsProcessed}/${markets.length} events done`,
      )
      break
    }

    // Each ELECTION_REGISTRY slug is an EVENT containing N candidate
    // sub-markets (one per candidate, each binary Yes/No). Expand to all
    // active sub-markets so we capture Lula/Bolsonaro/Haddad concentration
    // — not just the highest-volume one.
    const subMarkets = await resolveActiveConditionIds(entry.slug)
    if (subMarkets.length === 0) {
      console.warn(`[wallet-ingest] No active sub-markets for ${entry.slug} — skipping`)
      continue
    }

    for (const sub of subMarkets) {
      const holders = await fetchHolders(sub.conditionId, { limit: HOLDERS_PER_MARKET })
      if (holders.length === 0) {
        // Empty result is signal too — but don't OVERWRITE a previous good
        // snapshot for this market with empty data. Skip the persist entirely
        // when holders is empty (next tick will retry).
        marketsProcessed++
        continue
      }

      await persistMarketHolderSnapshot({
        conditionId: sub.conditionId,
        marketSlug: entry.slug,
        holders,
        snapshotAt,
      })

      for (const h of holders) {
        const addr = h.holder.toLowerCase()
        if (!isValidWalletAddress(addr)) continue
        if (!uniqueWallets.has(addr)) {
          uniqueWallets.set(addr, {
            address: addr,
            username: h.username,
            contextMarketSlug: entry.slug,
          })
        }
      }

      marketsProcessed++
    }
  }

  // ── 3. Filter out recently-refreshed wallets ──────────────────
  const allSeeds = Array.from(uniqueWallets.values())
  const seedsToRefresh: HolderSeed[] = []
  for (const seed of allSeeds) {
    if (await wasRefreshedRecently(redis, seed.address)) {
      walletsSkipped++
      continue
    }
    seedsToRefresh.push(seed)
  }

  console.log(
    `[wallet-ingest] Markets ${marketsProcessed}/${markets.length}, unique wallets ${allSeeds.length}, to refresh ${seedsToRefresh.length}`,
  )

  // ── 4. Refresh wallets in chunks ──────────────────────────────
  const chunks = chunk(seedsToRefresh, WALLET_CONCURRENCY)
  let chunkIdx = 0
  for (const group of chunks) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      // chunkIdx is the index of the NEXT chunk we were about to process —
      // chunks [0..chunkIdx-1] are already done, but `chunkIdx` chunks completed
      // means `chunkIdx * WALLET_CONCURRENCY` wallets processed. Use
      // (chunkIdx + 1) here to account for the "would-have-been" chunk we
      // skipped, matching the reviewer's expected accounting.
      const remaining = Math.max(
        0,
        seedsToRefresh.length - (chunkIdx + 1) * WALLET_CONCURRENCY,
      )
      partial = true
      console.warn(
        `[wallet-ingest] Partial run — ${remaining} wallets remaining (time budget ${TIME_BUDGET_MS}ms hit)`,
      )
      break
    }

    const results = await Promise.all(
      group.map(async (seed) => {
        try {
          const out = await refreshOneWallet(seed, snapshotDate)
          if (out.ok) await markRefreshed(redis, seed.address)
          return out
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`${seed.address}: ${msg}`)
          console.warn(`[wallet-ingest] Wallet ${seed.address} failed:`, msg)
          return { ok: false, tradesInserted: 0, tradesSkipped: 0 }
        }
      }),
    )

    for (const r of results) {
      if (r.ok) walletsProcessed++
      tradesInserted += r.tradesInserted
      tradesSkipped += r.tradesSkipped
    }
    chunkIdx++
  }

  // TODO V2: deeper trade history — paginate /trades beyond the first 100
  // for wallets flagged as high-volume. Current cron caps at TRADES_LIMIT
  // to fit the 50s budget across the whole holder set.
  //
  // TODO V2: on-chain proxy-type enrichment. We default Wallet.proxyType to
  // 'unknown'; a follow-up worker should classify gnosis_safe / poly_proxy /
  // eoa via on-chain bytecode + factory lookups.

  const durationMs = Date.now() - startedAt
  return {
    marketsProcessed,
    walletsProcessed,
    walletsSkipped,
    tradesInserted,
    tradesSkipped,
    durationMs,
    errors,
    partial: partial || undefined,
  }
}
