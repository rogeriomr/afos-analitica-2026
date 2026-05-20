/**
 * Slug → conditionId(s) Resolver
 *
 * Polymarket holder/positions/trades endpoints key off conditionId (66-char
 * hex). Our `ELECTION_REGISTRY` only knows event slugs. This module bridges
 * the two via gamma-api (`fetchEventBySlug`).
 *
 * Most Polymarket election EVENTS contain N candidate sub-markets (each a
 * binary Yes/No: "Will Lula win?", "Will Tarcísio win?", ...). We track
 * the top N active sub-markets per event by volume so analysts see ALL
 * the relevant candidates, not just the single highest-volume one.
 *
 * Failure mode: returns `[]` / `null` (logged) — callers MUST handle the
 * empty case; the next cron will re-attempt.
 */

import { Redis } from '@upstash/redis'
import { fetchEventBySlug, type ParsedMarket } from '../polymarket/client'
import { isValidConditionId } from './client'
import { prisma } from '../../../lib/db'

/** How many top-volume active sub-markets to track per event (default). */
export const DEFAULT_TOP_N_PER_EVENT = 15

export interface ResolvedSubMarket {
  conditionId: string
  question: string
  /** The event-level slug (same for all sub-markets of the same event). */
  eventSlug: string
  /** Per-sub-market slug from gamma-api (e.g. "will-lula-win"). */
  marketSlug: string
  volume: number
  outcomes: string[]
  /** Current YES probability ∈ [0,1] — the load-bearing favoritism signal.
   * Volume is just turnover (YES+NO) so it misleads about who's likely to win.
   * E.g. a $11M market where YES=0.35% means "everyone bets they LOSE", not "favorite". */
  yesProbability: number
}

const CACHE_PREFIX = 'wallet-intel:slug-cid:'
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

async function persistMetadata(market: ResolvedSubMarket) {
  if (!prisma) return
  const outcomes = market.outcomes.map((name, index) => ({ index, name }))
  try {
    await prisma.marketMetadata.upsert({
      where: { conditionId: market.conditionId },
      create: {
        conditionId: market.conditionId,
        marketSlug: market.eventSlug,
        question: market.question,
        outcomesJson: outcomes,
      },
      update: {
        marketSlug: market.eventSlug,
        question: market.question,
        outcomesJson: outcomes,
        lastFetchedAt: new Date(),
      },
    })
  } catch (err) {
    console.warn(
      `[conditionid-resolver] failed to persist MarketMetadata for ${market.conditionId}:`,
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * Resolve a Polymarket event slug to the top-N most-traded ACTIVE sub-markets.
 *
 * Each entry is a candidate-level binary market (Yes/No). The same event slug
 * (e.g. "brazil-presidential-election") expands to 15+ candidates: Tarcísio,
 * Lula, Bolsonaros, Haddad, etc.
 *
 * Side effect: upserts MarketMetadata for every returned market so downstream
 * UI can surface the candidate question + Yes/No outcomes.
 */
export async function resolveActiveConditionIds(
  slug: string,
  opts?: { topN?: number },
): Promise<ResolvedSubMarket[]> {
  if (!slug || typeof slug !== 'string') return []
  const topN = opts?.topN ?? DEFAULT_TOP_N_PER_EVENT

  const event = await fetchEventBySlug(slug)
  if (!event || !event.markets || event.markets.length === 0) {
    console.warn(`[conditionid-resolver] No markets for slug "${slug}"`)
    return []
  }

  // Filter to active + open + valid conditionId, sort by YES probability desc
  // (the REAL favoritism signal — volume conflates YES+NO turnover and ranks
  // "most-contested" markets above "most-likely" candidates). Slice top N.
  const candidates: ResolvedSubMarket[] = event.markets
    .filter(
      (m: ParsedMarket) =>
        m.active &&
        !m.closed &&
        m.conditionId &&
        isValidConditionId(m.conditionId),
    )
    .map((m: ParsedMarket) => ({
      conditionId: m.conditionId,
      question: m.question || event.title || '',
      eventSlug: slug,
      marketSlug: slug,
      volume: m.volume || 0,
      outcomes: m.outcomes ?? [],
      yesProbability: typeof m.yesPrice === 'number' ? m.yesPrice : 0,
    }))
    .sort((a, b) => b.yesProbability - a.yesProbability)
    .slice(0, topN)

  // Persist metadata for every sub-market we'll ingest. Best-effort — failure
  // here does NOT break the resolver result.
  await Promise.all(candidates.map(persistMetadata))

  return candidates
}

/**
 * Backward-compat: resolve a slug to a SINGLE conditionId (the top-volume
 * active sub-market). Mirrors the previous behavior but routes through the
 * new resolver so MarketMetadata is still populated for that one.
 *
 * Prefer `resolveActiveConditionIds` for new code — this only returns one
 * candidate per event, which silently hides the other 14+.
 */
export async function resolveConditionId(slug: string): Promise<string | null> {
  if (!slug || typeof slug !== 'string') return null

  const redis = getRedis()
  const cacheKey = `${CACHE_PREFIX}${slug}`

  if (redis) {
    try {
      const cached = await redis.get<string>(cacheKey)
      if (cached && isValidConditionId(cached)) return cached
    } catch (err) {
      console.warn(
        `[conditionid-resolver] Redis read failed for ${slug}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  const candidates = await resolveActiveConditionIds(slug, { topN: 1 })
  const first = candidates[0]?.conditionId ?? null

  if (first && redis) {
    try {
      await redis.set(cacheKey, first, { ex: CACHE_TTL_SECONDS })
    } catch (err) {
      console.warn(
        `[conditionid-resolver] Redis write failed for ${slug}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return first
}
