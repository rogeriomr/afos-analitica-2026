/**
 * AFOS Wallet Intelligence — Dev Seed
 *
 * Populates the `wallet` Postgres schema with **synthetic** but realistic
 * Polymarket-shaped data so the entire UI + rules pipeline can be validated
 * locally (the user can't reach Polymarket directly due to regional block).
 *
 * Designed so every ACTIVE rule fires at least once:
 *   wallet_new_whale       → new_wallet_big_bet
 *   wallet_concentration   → concentration_unilateral
 *   wallet_whale_velocity  → whale_velocity
 *   wallet_single_market   → single_market_focus
 *   wallet_fragmented      → trade_fragmentation
 *   wallet_coord{1,2,3,4}  → coordinated_entry
 *   wallet_normal{1,2}     → control group (no flags expected)
 *
 * Synthetic disclaimer:
 *   conditionIds and proxyAddresses below are PLACEHOLDERS — they do NOT
 *   correspond to any real Polymarket condition tokens or chain wallets.
 *   Slugs DO match `ELECTION_REGISTRY` so any slug-based UI lookups work.
 *
 * Idempotency:
 *   The script wipes the entire wallet schema (wipes ONLY the wallet schema —
 *   never touches iam/crm/research/market/governance/ai) and re-inserts from
 *   scratch. Running it N times produces the same final state.
 *
 * Usage:
 *   1. Set DATABASE_URL in .env.local (Neon pooled URL).
 *   2. npx tsx scripts/seed-wallet-intel-dev.ts
 *
 * WARNING: this script DELETES every row in the wallet schema. Do NOT run in
 * production. There is no confirmation prompt — assume dev usage only.
 */

import './_load-env'

import { createHash } from 'crypto'
import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

import { seedFlagRules } from '../app/lib/wallet-intel/seed-rules'
import { runDetection } from '../app/lib/wallet-intel/detector'
import { recomputeAllScores } from '../app/lib/wallet-intel/scoring'

// ─── Helpers ────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const ADDRESS_RE = /^0x[a-f0-9]{40}$/
const CONDITION_RE = /^0x[a-f0-9]{64}$/

/** Pad a short hex stub to a full 40-char lowercase address (`0x` + 40 hex). */
function addr(stub: string): string {
  const clean = stub.replace(/^0x/, '').toLowerCase()
  if (!/^[a-f0-9]+$/.test(clean)) throw new Error(`addr: non-hex stub "${stub}"`)
  if (clean.length > 40) throw new Error(`addr: stub too long "${stub}"`)
  const out = `0x${clean.padEnd(40, '0')}`
  if (!ADDRESS_RE.test(out)) throw new Error(`addr: invalid output "${out}"`)
  return out
}

/** Pad a short hex stub to a full 64-char lowercase conditionId (`0x` + 64 hex). */
function cid(stub: string): string {
  const clean = stub.replace(/^0x/, '').toLowerCase()
  if (!/^[a-f0-9]+$/.test(clean)) throw new Error(`cid: non-hex stub "${stub}"`)
  if (clean.length > 64) throw new Error(`cid: stub too long "${stub}"`)
  const out = `0x${clean.padEnd(64, '0')}`
  if (!CONDITION_RE.test(out)) throw new Error(`cid: invalid output "${out}"`)
  return out
}

/** Synthetic asset token id — full 64-char hex, distinct per (market, outcome). */
function tokenId(marketStub: string, outcomeIdx: number): string {
  const base = marketStub.replace(/^0x/, '').padEnd(60, '0')
  return `0x${base}${String(outcomeIdx).padStart(4, '0')}`.slice(0, 66).toLowerCase()
}

/** Synthetic on-chain tx hash — full 64-char hex, distinct per call. */
let txCounter = 0
function nextTxHash(): string {
  txCounter += 1
  return `0x${createHash('sha256').update(`tx-${txCounter}`).digest('hex')}`
}

/** Mirrors persist.ts: sha256(txHash:asset:side:size:price).slice(0,32). */
function makeTradeDedupHash(
  txHash: string,
  asset: string,
  side: string,
  size: number,
  price: number,
): string {
  return createHash('sha256')
    .update(`${txHash}:${asset}:${side}:${size}:${price}`)
    .digest('hex')
    .slice(0, 32)
}

/** UTC start-of-day for a given Date. */
function startOfDayUtc(d: Date = new Date()): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

/** Bucket to nearest 15-minute boundary (matches persist.ts). */
function bucket15Min(d: Date = new Date()): Date {
  const BUCKET = 15 * 60 * 1000
  return new Date(Math.floor(d.getTime() / BUCKET) * BUCKET)
}

// ─── Markets (synthetic conditionIds, real slugs) ──────────────────

const MARKETS = {
  br: {
    slug: 'brazil-presidential-election',
    conditionId: cid('b1cd' + 'b1cd'.repeat(15)), // 0xb1cd...
  },
  co: {
    slug: 'colombia-presidential-election',
    conditionId: cid('c01b' + 'c01b'.repeat(15)), // 0xc01b...
  },
  us: {
    slug: 'presidential-election-winner-2028',
    conditionId: cid('5a28' + '5a28'.repeat(15)), // 0x5a28...
  },
} as const

// ─── Wallet stubs (short hex, padded later) ────────────────────────

const W = {
  new_whale: addr('feed'),
  concentration: addr('c0c1'),
  whale_velocity: addr('fa57'),
  single_market: addr('51c1'),
  fragmented: addr('f4a6'),
  coord1: addr('c001'),
  coord2: addr('c002'),
  coord3: addr('c003'),
  coord4: addr('c004'),
  // 5th wallet so EVERY wallet in the ring sees ≥4 others — covers both the
  // current rule default (min_coordinated_wallets=3) and any stale DB row left
  // at the pre-fix value of 4 (seedFlagRules.update does NOT overwrite
  // paramsJson once a row exists).
  coord5: addr('c005'),
  normal1: addr('a001'),
  normal2: addr('a002'),
} as const

// ─── Main ───────────────────────────────────────────────────────────

interface SeededWallet {
  id: string
  proxyAddress: string
  label: string
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL not configured (.env.local)')
    process.exit(1)
  }

  const adapter = new PrismaNeon({ connectionString: url })
  const prisma = new PrismaClient({ adapter })

  console.log('\nAFOS Wallet Intelligence — dev seed\n')

  // ─── 1. Wipe wallet schema (in dependency order) ─────────────────
  console.log('wiping wallet schema…')
  await prisma.walletScore.deleteMany({})
  await prisma.redFlag.deleteMany({})
  await prisma.walletTrade.deleteMany({})
  await prisma.walletPosition.deleteMany({})
  await prisma.walletProfile.deleteMany({})
  await prisma.marketHolderSnapshot.deleteMany({})
  await prisma.wallet.deleteMany({})
  // FlagRule rows are NOT wiped here — seedFlagRules upserts them and
  // preserves admin-tuned severity/enabled/paramsJson columns.
  console.log('  ok')

  // ─── 2. Seed FlagRules (idempotent upsert) ───────────────────────
  const ruleSeed = await seedFlagRules()
  const ruleCount = await prisma.flagRule.count()
  console.log(
    `flag rules seeded (created=${ruleSeed.created} updated=${ruleSeed.updated} total=${ruleCount})`,
  )

  // ─── 3. Create wallets ───────────────────────────────────────────
  const now = new Date()
  const today = startOfDayUtc(now)
  const seeded: SeededWallet[] = []

  async function createWallet(args: {
    proxyAddress: string
    label: string
    firstSeenAt: Date
    chainFirstActivityAt: Date | null
    totalValueUsd?: number | null
    profile?: {
      pseudonym?: string | null
      username?: string | null
      xUsername?: string | null
      verifiedBadge?: boolean
    } | null
  }): Promise<SeededWallet> {
    const w = await prisma.wallet.create({
      data: {
        proxyAddress: args.proxyAddress,
        proxyType: 'safe',
        firstSeenAt: args.firstSeenAt,
        chainFirstActivityAt: args.chainFirstActivityAt,
        lastSeenAt: now,
        totalValueUsd: args.totalValueUsd ?? null,
        active: true,
      },
    })
    if (args.profile !== null && args.profile !== undefined) {
      await prisma.walletProfile.create({
        data: {
          walletId: w.id,
          pseudonym: args.profile.pseudonym ?? null,
          username: args.profile.username ?? null,
          xUsername: args.profile.xUsername ?? null,
          verifiedBadge: args.profile.verifiedBadge ?? false,
          lastFetchedAt: now,
        },
      })
    }
    const sw: SeededWallet = { id: w.id, proxyAddress: w.proxyAddress, label: args.label }
    seeded.push(sw)
    return sw
  }

  // 1) Fresh whale — chainFirstActivityAt 10 days ago, $25k position on BR.
  const wNewWhale = await createWallet({
    proxyAddress: W.new_whale,
    label: 'new_whale',
    firstSeenAt: new Date(now.getTime() - 10 * DAY_MS),
    chainFirstActivityAt: new Date(now.getTime() - 10 * DAY_MS),
    totalValueUsd: 25_400,
    profile: {
      pseudonym: 'NewWhale10d',
      username: 'newwhale',
      xUsername: 'newwhale_x',
      verifiedBadge: true,
    },
  })

  // 2) Concentration wallet — old, dominates one outcome on COL.
  const wConcentration = await createWallet({
    proxyAddress: W.concentration,
    label: 'concentration',
    firstSeenAt: new Date(now.getTime() - 180 * DAY_MS),
    chainFirstActivityAt: new Date(now.getTime() - 180 * DAY_MS),
    totalValueUsd: 60_000,
    profile: {
      pseudonym: 'ConcWhale',
      username: 'concwhale',
      xUsername: null,
      verifiedBadge: false,
    },
  })

  // 3) Whale velocity — established but bursty.
  const wWhaleVel = await createWallet({
    proxyAddress: W.whale_velocity,
    label: 'whale_velocity',
    firstSeenAt: new Date(now.getTime() - 120 * DAY_MS),
    chainFirstActivityAt: new Date(now.getTime() - 120 * DAY_MS),
    totalValueUsd: 120_000,
    profile: null, // NULL profile to exercise empty-state UI
  })

  // 4) Single-market focus — 30 trades, all on COL.
  const wSingle = await createWallet({
    proxyAddress: W.single_market,
    label: 'single_market',
    firstSeenAt: new Date(now.getTime() - 60 * DAY_MS),
    chainFirstActivityAt: new Date(now.getTime() - 60 * DAY_MS),
    totalValueUsd: 8_500,
    profile: null, // NULL profile to exercise empty-state UI
  })

  // 5) Fragmented — many tiny trades in 24h.
  const wFrag = await createWallet({
    proxyAddress: W.fragmented,
    label: 'fragmented',
    firstSeenAt: new Date(now.getTime() - 45 * DAY_MS),
    chainFirstActivityAt: new Date(now.getTime() - 45 * DAY_MS),
    totalValueUsd: 91_000,
    profile: {
      pseudonym: 'IcebergTrader',
      username: 'iceberg',
      xUsername: 'iceberg_x',
      verifiedBadge: false,
    },
  })

  // 6-10) Coordinated ring — 5 wallets entering BUY on BR within 5min.
  const coordAddrs: readonly string[] = [
    W.coord1,
    W.coord2,
    W.coord3,
    W.coord4,
    W.coord5,
  ]
  const coordWallets: SeededWallet[] = []
  for (let i = 0; i < coordAddrs.length; i++) {
    const cw = await createWallet({
      proxyAddress: coordAddrs[i],
      label: `coord${i + 1}`,
      firstSeenAt: new Date(now.getTime() - 30 * DAY_MS),
      chainFirstActivityAt: new Date(now.getTime() - 30 * DAY_MS),
      totalValueUsd: 5_000 + i * 1_000,
      profile: null,
    })
    coordWallets.push(cw)
  }

  // 10-11) Control group — no flags expected.
  const wNorm1 = await createWallet({
    proxyAddress: W.normal1,
    label: 'normal1',
    firstSeenAt: new Date(now.getTime() - 90 * DAY_MS),
    chainFirstActivityAt: new Date(now.getTime() - 90 * DAY_MS),
    totalValueUsd: 3_200,
    profile: {
      pseudonym: 'CasualBettor',
      username: 'casual1',
      xUsername: null,
      verifiedBadge: false,
    },
  })
  const wNorm2 = await createWallet({
    proxyAddress: W.normal2,
    label: 'normal2',
    firstSeenAt: new Date(now.getTime() - 95 * DAY_MS),
    chainFirstActivityAt: new Date(now.getTime() - 95 * DAY_MS),
    totalValueUsd: 1_800,
    profile: null,
  })

  console.log(`wallets created: ${seeded.length}`)

  // ─── 4. Positions (today's snapshot, snapshotDate = today UTC) ──
  const positions: Prisma.WalletPositionCreateManyInput[] = [
    // new_whale — single big position on BR YES (outcome 0), $25,400.
    {
      walletId: wNewWhale.id,
      marketConditionId: MARKETS.br.conditionId,
      marketSlug: MARKETS.br.slug,
      outcomeIndex: 0,
      outcomeName: 'Yes',
      size: 50_800,
      avgPrice: 0.5,
      currentValueUsd: 25_400,
      pnlUsd: 400,
      pnlPercent: 1.6,
      snapshotDate: today,
    },
    // concentration — heavy COL outcome-0 position ($60k notional).
    {
      walletId: wConcentration.id,
      marketConditionId: MARKETS.co.conditionId,
      marketSlug: MARKETS.co.slug,
      outcomeIndex: 0,
      outcomeName: 'Yes',
      size: 600_000,
      avgPrice: 0.1,
      currentValueUsd: 60_000,
      pnlUsd: 0,
      pnlPercent: 0,
      snapshotDate: today,
    },
    // whale_velocity — modest position on BR (the velocity rule fires off trades, not positions).
    {
      walletId: wWhaleVel.id,
      marketConditionId: MARKETS.br.conditionId,
      marketSlug: MARKETS.br.slug,
      outcomeIndex: 1,
      outcomeName: 'No',
      size: 200_000,
      avgPrice: 0.4,
      currentValueUsd: 80_000,
      pnlUsd: 5_000,
      pnlPercent: 6.6,
      snapshotDate: today,
    },
    // single_market — modest position on COL.
    {
      walletId: wSingle.id,
      marketConditionId: MARKETS.co.conditionId,
      marketSlug: MARKETS.co.slug,
      outcomeIndex: 1,
      outcomeName: 'No',
      size: 12_000,
      avgPrice: 0.7,
      currentValueUsd: 8_500,
      pnlUsd: 100,
      pnlPercent: 1.2,
      snapshotDate: today,
    },
    // fragmented — modest BR position.
    {
      walletId: wFrag.id,
      marketConditionId: MARKETS.br.conditionId,
      marketSlug: MARKETS.br.slug,
      outcomeIndex: 0,
      outcomeName: 'Yes',
      size: 150_000,
      avgPrice: 0.6,
      currentValueUsd: 91_000,
      pnlUsd: 1_000,
      pnlPercent: 1.1,
      snapshotDate: today,
    },
    // coord wallets — each small BR YES position.
    ...coordWallets.map((cw, i) => ({
      walletId: cw.id,
      marketConditionId: MARKETS.br.conditionId,
      marketSlug: MARKETS.br.slug,
      outcomeIndex: 0,
      outcomeName: 'Yes',
      size: 8_000 + i * 1_000,
      avgPrice: 0.5,
      currentValueUsd: 4_000 + i * 500,
      pnlUsd: 0,
      pnlPercent: 0,
      snapshotDate: today,
    })),
    // normal control — small positions spread across markets.
    {
      walletId: wNorm1.id,
      marketConditionId: MARKETS.us.conditionId,
      marketSlug: MARKETS.us.slug,
      outcomeIndex: 0,
      outcomeName: 'Yes',
      size: 5_000,
      avgPrice: 0.32,
      currentValueUsd: 1_600,
      pnlUsd: 50,
      pnlPercent: 3.2,
      snapshotDate: today,
    },
    {
      walletId: wNorm2.id,
      marketConditionId: MARKETS.br.conditionId,
      marketSlug: MARKETS.br.slug,
      outcomeIndex: 1,
      outcomeName: 'No',
      size: 3_000,
      avgPrice: 0.6,
      currentValueUsd: 1_800,
      pnlUsd: -50,
      pnlPercent: -2.7,
      snapshotDate: today,
    },
  ]

  await prisma.walletPosition.createMany({ data: positions, skipDuplicates: true })
  console.log(`positions: ${positions.length}`)

  // ─── 5. Trades ───────────────────────────────────────────────────
  const trades: Prisma.WalletTradeCreateManyInput[] = []

  function pushTrade(args: {
    walletId: string
    market: { slug: string; conditionId: string }
    outcomeIndex: 0 | 1
    side: 'BUY' | 'SELL'
    size: number
    price: number
    tradeTimestamp: Date
  }): void {
    const valueUsd = args.size * args.price
    const asset = tokenId(args.market.conditionId, args.outcomeIndex)
    const txHash = nextTxHash()
    trades.push({
      walletId: args.walletId,
      marketConditionId: args.market.conditionId,
      marketSlug: args.market.slug,
      side: args.side,
      assetTokenId: asset,
      outcomeIndex: args.outcomeIndex,
      size: args.size,
      price: args.price,
      valueUsd,
      transactionHash: txHash,
      tradeTimestamp: args.tradeTimestamp,
      dedupHash: makeTradeDedupHash(txHash, asset, args.side, args.size, args.price),
    })
  }

  // --- wallet_new_whale: one big entry trade (irrelevant to its rule, but
  //     gives the UI a recent trade to render).
  pushTrade({
    walletId: wNewWhale.id,
    market: MARKETS.br,
    outcomeIndex: 0,
    side: 'BUY',
    size: 50_800,
    price: 0.5,
    tradeTimestamp: new Date(now.getTime() - 2 * DAY_MS),
  })

  // --- wallet_whale_velocity: 5 trades in last 1h, total ~$80k.
  //     Sizes chosen so sum > $50k threshold and within 1h window.
  const velAmounts = [18_000, 16_000, 17_000, 15_000, 14_000]
  for (let i = 0; i < velAmounts.length; i++) {
    pushTrade({
      walletId: wWhaleVel.id,
      market: MARKETS.br,
      outcomeIndex: 1,
      side: 'BUY',
      size: velAmounts[i] / 0.4,
      price: 0.4,
      // Distribute across last 50 minutes (well inside the 1h window).
      tradeTimestamp: new Date(now.getTime() - (50 - i * 10) * 60_000),
    })
  }

  // --- wallet_single_market: 30 trades over 20d, ALL on COL.
  for (let i = 0; i < 30; i++) {
    const ageDays = 20 - (i * 20) / 30 // 20d ago → ~now
    pushTrade({
      walletId: wSingle.id,
      market: MARKETS.co,
      outcomeIndex: (i % 2) as 0 | 1,
      side: i % 3 === 0 ? 'SELL' : 'BUY',
      size: 500 + (i % 5) * 100,
      price: 0.5 + ((i % 7) - 3) * 0.02,
      tradeTimestamp: new Date(now.getTime() - ageDays * DAY_MS),
    })
  }

  // --- wallet_fragmented: 600 trades in last 24h, median = $150 (< $200), total = $90k.
  //     Rule thresholds: trade_count > 500, median < $200, total > $50k.
  //     300 × $50 + 300 × $250 → sorted [50…50, 250…250], median = (50+250)/2 = 150.
  for (let i = 0; i < 600; i++) {
    const isBig = i % 2 === 1
    const valueUsd = isBig ? 250 : 50
    const price = 0.6
    const size = valueUsd / price
    // Spread within last 23h — well inside the 24h window.
    const ageMin = (i * 23 * 60) / 600 // 0 → 23h
    pushTrade({
      walletId: wFrag.id,
      market: MARKETS.br,
      outcomeIndex: 0,
      side: i % 4 === 0 ? 'SELL' : 'BUY',
      size,
      price,
      tradeTimestamp: new Date(now.getTime() - ageMin * 60_000),
    })
  }

  // --- coordinated_entry: 4 wallets BUY on BR within 5min window in last 24h.
  //     Anchor timestamp = 6h ago. Trades spread within ±2min of anchor.
  const coordAnchor = new Date(now.getTime() - 6 * HOUR_MS)
  for (let i = 0; i < coordWallets.length; i++) {
    pushTrade({
      walletId: coordWallets[i].id,
      market: MARKETS.br,
      outcomeIndex: 0,
      side: 'BUY',
      size: 10_000 + i * 500,
      price: 0.5,
      tradeTimestamp: new Date(coordAnchor.getTime() + i * 60_000), // +0,+1,+2,+3 min
    })
  }
  // Add a second "supporting" trade per coord wallet so positions feel real.
  for (let i = 0; i < coordWallets.length; i++) {
    pushTrade({
      walletId: coordWallets[i].id,
      market: MARKETS.br,
      outcomeIndex: 0,
      side: 'BUY',
      size: 2_000,
      price: 0.55,
      tradeTimestamp: new Date(now.getTime() - (8 + i) * HOUR_MS),
    })
  }

  // --- wallet_concentration: a few historic BUYs on COL outcome 0 (so 30d window has activity).
  for (let i = 0; i < 4; i++) {
    pushTrade({
      walletId: wConcentration.id,
      market: MARKETS.co,
      outcomeIndex: 0,
      side: 'BUY',
      size: 150_000,
      price: 0.1,
      tradeTimestamp: new Date(now.getTime() - (10 + i) * DAY_MS),
    })
  }

  // --- normal control group: 2-3 normal trades each.
  for (let i = 0; i < 3; i++) {
    pushTrade({
      walletId: wNorm1.id,
      market: i === 0 ? MARKETS.us : MARKETS.br,
      outcomeIndex: 0,
      side: 'BUY',
      size: 1_500,
      price: 0.4,
      tradeTimestamp: new Date(now.getTime() - (5 + i * 3) * DAY_MS),
    })
  }
  for (let i = 0; i < 2; i++) {
    pushTrade({
      walletId: wNorm2.id,
      market: i === 0 ? MARKETS.br : MARKETS.us,
      outcomeIndex: 1,
      side: 'SELL',
      size: 800,
      price: 0.6,
      tradeTimestamp: new Date(now.getTime() - (7 + i * 4) * DAY_MS),
    })
  }

  // Persist in chunks so the createMany payload stays under Neon's wire limit.
  const CHUNK = 500
  let tradesInserted = 0
  for (let i = 0; i < trades.length; i += CHUNK) {
    const slice = trades.slice(i, i + CHUNK)
    const res = await prisma.walletTrade.createMany({ data: slice, skipDuplicates: true })
    tradesInserted += res.count
  }
  console.log(`trades: ${tradesInserted}`)

  // ─── 6. MarketHolderSnapshots ────────────────────────────────────
  // One snapshot per market at bucketed `now`. holdersJson has ~15 entries.
  // For the COL market we ensure wConcentration owns > 50% of outcome 0.
  const snapAt = bucket15Min(now)

  function fillerHolder(seed: number, outcomeIndex: 0 | 1, amount: number): {
    tokenId: string
    holder: string
    amount: number
    outcomeIndex: 0 | 1
  } {
    // Deterministic synthetic filler holder address — distinct from all seeded
    // wallet addresses (uses a different stub prefix space).
    const stub = `ffff${seed.toString(16).padStart(4, '0')}`
    return {
      tokenId: 'filler',
      holder: addr(stub),
      amount,
      outcomeIndex,
    }
  }

  // BR market — wConcentration NOT dominant here; spread evenly.
  const brHolders = [
    { tokenId: 'br0', holder: wNewWhale.proxyAddress, amount: 50_800, outcomeIndex: 0 },
    { tokenId: 'br0', holder: wWhaleVel.proxyAddress, amount: 200_000, outcomeIndex: 1 },
    { tokenId: 'br0', holder: wFrag.proxyAddress, amount: 150_000, outcomeIndex: 0 },
    ...coordWallets.map((cw, i) => ({
      tokenId: 'br0',
      holder: cw.proxyAddress,
      amount: 8_000 + i * 1_000,
      outcomeIndex: 0 as const,
    })),
    // Filler holders to make outcome 0 NOT dominated by any single wallet on BR.
    ...Array.from({ length: 8 }, (_, i) => fillerHolder(i, 0, 70_000 + i * 5_000)),
  ]

  // COL market — wConcentration owns 70% of outcome 0 → > 0.40 threshold.
  const colOutcome0Total = 600_000 + /* filler */ 250_000 // wConc dominates
  void colOutcome0Total
  const colHolders = [
    { tokenId: 'co0', holder: wConcentration.proxyAddress, amount: 600_000, outcomeIndex: 0 },
    { tokenId: 'co0', holder: wSingle.proxyAddress, amount: 12_000, outcomeIndex: 1 },
    // Small filler holders on outcome 0 — must NOT exceed 257k total so wConc > 60%.
    ...Array.from({ length: 6 }, (_, i) => fillerHolder(20 + i, 0, 35_000 + i * 1_000)),
    // Some outcome-1 filler.
    ...Array.from({ length: 6 }, (_, i) => fillerHolder(30 + i, 1, 18_000 + i * 1_500)),
  ]

  // US market — diverse small holders.
  const usHolders = [
    { tokenId: 'us0', holder: wNorm1.proxyAddress, amount: 5_000, outcomeIndex: 0 },
    { tokenId: 'us0', holder: wNorm2.proxyAddress, amount: 3_000, outcomeIndex: 1 },
    ...Array.from({ length: 13 }, (_, i) => fillerHolder(40 + i, (i % 2) as 0 | 1, 4_000 + i * 800)),
  ]

  const snapshots: Prisma.MarketHolderSnapshotCreateManyInput[] = [
    {
      marketConditionId: MARKETS.br.conditionId,
      marketSlug: MARKETS.br.slug,
      snapshotAt: snapAt,
      holdersJson: brHolders as unknown as Prisma.InputJsonValue,
      totalHolders: brHolders.length,
    },
    {
      marketConditionId: MARKETS.co.conditionId,
      marketSlug: MARKETS.co.slug,
      snapshotAt: snapAt,
      holdersJson: colHolders as unknown as Prisma.InputJsonValue,
      totalHolders: colHolders.length,
    },
    {
      marketConditionId: MARKETS.us.conditionId,
      marketSlug: MARKETS.us.slug,
      snapshotAt: snapAt,
      holdersJson: usHolders as unknown as Prisma.InputJsonValue,
      totalHolders: usHolders.length,
    },
  ]
  await prisma.marketHolderSnapshot.createMany({ data: snapshots, skipDuplicates: true })
  console.log(`holder snapshots: ${snapshots.length}`)

  // ─── 7. Run detection ────────────────────────────────────────────
  await prisma.$disconnect() // detector + scoring use the singleton in lib/db.ts

  console.log('\nrunning detection…')
  const det = await runDetection()
  console.log(
    `  evaluated=${det.walletsEvaluated} flags=${det.flagsRaised} durationMs=${det.durationMs}`,
  )

  console.log('\nrecomputing scores…')
  const sc = await recomputeAllScores()
  console.log(`  scores updated: ${sc.updated}`)

  // ─── 8. Final report ─────────────────────────────────────────────
  // Re-open a quick connection to count distinct flagged wallets cleanly.
  const adapter2 = new PrismaNeon({ connectionString: url })
  const prisma2 = new PrismaClient({ adapter: adapter2 })
  const flaggedWalletsRows = await prisma2.redFlag.findMany({
    select: { walletId: true },
    distinct: ['walletId'],
  })
  const totalFlags = await prisma2.redFlag.count()
  await prisma2.$disconnect()

  console.log('\n--- seed complete ---')
  console.log(`wallets created: ${seeded.length}`)
  console.log(`positions: ${positions.length}`)
  console.log(`trades: ${tradesInserted}`)
  console.log(`holder snapshots: ${snapshots.length}`)
  console.log(`flag rules seeded: ${ruleCount}`)
  console.log(
    `detection: ${totalFlags} flags raised across ${flaggedWalletsRows.length} wallets`,
  )
  console.log(
    `seeded ${seeded.length} wallets, ${tradesInserted} trades; detection raised ${totalFlags} flags across ${flaggedWalletsRows.length} wallets`,
  )
}

main().catch((err) => {
  console.error('seed-wallet-intel-dev failed:', err)
  process.exit(1)
})
