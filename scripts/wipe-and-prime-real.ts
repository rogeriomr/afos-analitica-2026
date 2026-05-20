/**
 * Wipe synthetic wallet data, prime from real Polymarket Data API.
 *
 * Designed to run locally (with VPN if your ISP blocks polymarket.com) — no
 * Vercel time budget. Iterates all enabled ELECTION_REGISTRY markets, takes
 * the top 50 holders per market, then for each unique holder fetches their
 * profile/positions/trades/value and persists.
 *
 * Preserves `wallet.MarketMetadata` and `wallet.FlagRule` rows (admin-owned).
 *
 * Run:  npx tsx scripts/wipe-and-prime-real.ts
 */

import './_load-env'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { ELECTION_REGISTRY } from '../app/lib/polymarket/country-market-map'
import { resolveConditionId } from '../app/lib/wallet-intel/conditionid-resolver'
import {
  fetchHolders,
  fetchProfile,
  fetchPositions,
  fetchTrades,
  fetchValue,
} from '../app/lib/wallet-intel/client'
import {
  persistMarketHolderSnapshot,
  persistWallet,
  persistWalletProfile,
  persistWalletPositions,
  persistWalletTrades,
  persistWalletValue,
  persistChainFirstActivity,
} from '../app/lib/wallet-intel/persist'
import { seedFlagRules } from '../app/lib/wallet-intel/seed-rules'
import { runDetection } from '../app/lib/wallet-intel/detector'
import { recomputeAllScores } from '../app/lib/wallet-intel/scoring'

const HOLDERS_PER_MARKET = 50
const WALLET_CONCURRENCY = 4
const TRADES_LIMIT = 100

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function startOfDayUtc(d: Date): Date {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  return x
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
  })

  console.log('\n=== wipe wallet schema (preserves MarketMetadata + FlagRule) ===')
  await prisma.walletScore.deleteMany()
  await prisma.redFlag.deleteMany()
  await prisma.walletTrade.deleteMany()
  await prisma.walletPosition.deleteMany()
  await prisma.walletProfile.deleteMany()
  await prisma.marketHolderSnapshot.deleteMany()
  await prisma.wallet.deleteMany()
  console.log('  done\n')

  console.log('=== resolving 19 enabled markets ===')
  const enabled = ELECTION_REGISTRY.filter((e) => e.enabled)
  type MarketResolved = { slug: string; conditionId: string }
  const markets: MarketResolved[] = []
  for (const entry of enabled) {
    const cid = await resolveConditionId(entry.slug)
    if (cid) {
      markets.push({ slug: entry.slug, conditionId: cid })
      console.log(`  ✓ ${entry.slug} → ${cid.slice(0, 12)}...`)
    } else {
      console.log(`  ✗ ${entry.slug} — unresolved`)
    }
  }
  console.log(`  ${markets.length}/${enabled.length} resolved\n`)

  console.log('=== fetching holders + snapshotting ===')
  const uniqueAddresses = new Set<string>()
  const now = new Date()
  for (const m of markets) {
    const holders = await fetchHolders(m.conditionId, { limit: HOLDERS_PER_MARKET })
    await persistMarketHolderSnapshot({
      conditionId: m.conditionId,
      marketSlug: m.slug,
      holders,
      snapshotAt: now,
    })
    for (const h of holders) uniqueAddresses.add(h.holder)
    console.log(`  ${m.slug}: ${holders.length} holders`)
  }
  console.log(`  ${uniqueAddresses.size} unique wallets to refresh\n`)

  console.log('=== refreshing wallets (concurrency 4) ===')
  const addresses = Array.from(uniqueAddresses)
  let walletsPersisted = 0
  let tradesInserted = 0
  let tradesSkipped = 0
  let errors = 0

  const chunks = chunk(addresses, WALLET_CONCURRENCY)
  for (let i = 0; i < chunks.length; i++) {
    const slice = chunks[i]
    await Promise.all(
      slice.map(async (addr) => {
        try {
          const [profile, positions, trades, value] = await Promise.all([
            fetchProfile(addr),
            fetchPositions(addr),
            fetchTrades(addr, { takerOnly: true, limit: TRADES_LIMIT }),
            fetchValue(addr),
          ])

          const walletId = await persistWallet({ proxyAddress: addr, username: profile?.pseudonym ?? undefined })
          if (!walletId) {
            errors++
            return
          }

          await persistWalletProfile(walletId, profile)

          // Group trades by marketSlug, use registry slug if conditionId matches one
          const tradesBySlug = new Map<string, typeof trades>()
          for (const t of trades) {
            const market = markets.find((m) => m.conditionId === t.conditionId)
            const slug = market?.slug ?? t.conditionId
            const arr = tradesBySlug.get(slug) ?? []
            arr.push(t)
            tradesBySlug.set(slug, arr)
          }
          for (const [slug, ts] of tradesBySlug) {
            const result = await persistWalletTrades(walletId, slug, ts)
            tradesInserted += result.inserted
            tradesSkipped += result.skipped
          }

          await persistWalletPositions(walletId, positions, startOfDayUtc(now))
          await persistWalletValue(walletId, value)

          const earliestTradeMs = trades.length ? Math.min(...trades.map((t) => t.timestamp * 1000)) : null
          await persistChainFirstActivity(walletId, earliestTradeMs ? new Date(earliestTradeMs) : null)

          walletsPersisted++
        } catch (err) {
          errors++
          console.warn(`  ${addr.slice(0, 12)}... failed:`, err instanceof Error ? err.message : err)
        }
      }),
    )
    if (i % 5 === 4 || i === chunks.length - 1) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000)
      console.log(`  chunk ${i + 1}/${chunks.length} — ${walletsPersisted} ok, ${errors} err, ${elapsed}s elapsed`)
    }
  }
  console.log(`  done: ${walletsPersisted} wallets, ${tradesInserted} trades inserted, ${tradesSkipped} dedup, ${errors} errors\n`)

  console.log('=== seeding flag rules (idempotent) ===')
  const seed = await seedFlagRules()
  console.log(`  created=${seed.created} updated=${seed.updated}\n`)

  console.log('=== running detection ===')
  const detect = await runDetection()
  console.log(`  evaluated=${detect.walletsEvaluated} flags=${detect.flagsRaised} in ${detect.durationMs}ms\n`)

  console.log('=== recomputing scores ===')
  const scored = await recomputeAllScores()
  console.log(`  scored=${scored.updated}\n`)

  const total = await prisma.wallet.count()
  const flagged = await prisma.wallet.count({ where: { score: { isNot: null } } })
  const totalTrades = await prisma.walletTrade.count()
  const elapsedTotal = Math.round((Date.now() - startedAt) / 1000)

  console.log('=== final state ===')
  console.log(`  wallets: ${total}`)
  console.log(`  flagged wallets (have a score): ${flagged}`)
  console.log(`  trades: ${totalTrades}`)
  console.log(`  total elapsed: ${elapsedTotal}s`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
