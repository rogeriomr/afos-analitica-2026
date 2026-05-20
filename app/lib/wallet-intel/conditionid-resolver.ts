/**
 * Slug → conditionId Resolver
 *
 * Polymarket holder/positions/trades endpoints key off conditionId (66-char
 * hex). Our `ELECTION_REGISTRY` only knows event slugs. This module bridges
 * the two via gamma-api (`fetchEventBySlug`) and caches the result in Redis
 * for 7 days — conditionId is immutable once an event ships, so a long TTL
 * is safe.
 *
 * Failure mode: returns null (logged) — callers MUST handle null and skip
 * the market for this run; the next cron will re-attempt.
 */

import { Redis } from '@upstash/redis'
import { fetchEventBySlug } from '../polymarket/client'
import { isValidConditionId } from './client'
import { prisma } from '../../../lib/db'

const CACHE_PREFIX = 'wallet-intel:slug-cid:'
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

/**
 * Resolve a Polymarket event slug to the conditionId of its first market.
 *
 * Lookup order:
 *   1. Redis cache (`wallet-intel:slug-cid:{slug}`)
 *   2. gamma-api via `fetchEventBySlug` — uses event.markets[0].conditionId
 *
 * Returns null when the slug is unknown, the event has no markets, or the
 * first market's conditionId is missing/malformed.
 */
export async function resolveConditionId(slug: string): Promise<string | null> {
  if (!slug || typeof slug !== 'string') return null

  const redis = getRedis()
  const cacheKey = `${CACHE_PREFIX}${slug}`

  // 1. Cache hit
  if (redis) {
    try {
      const cached = await redis.get<string>(cacheKey)
      if (cached && isValidConditionId(cached)) {
        return cached
      }
    } catch (err) {
      console.warn(
        `[conditionid-resolver] Redis read failed for ${slug}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  // 2. Fetch from gamma-api
  const event = await fetchEventBySlug(slug)
  if (!event || !event.markets || event.markets.length === 0) {
    console.warn(`[conditionid-resolver] No markets for slug "${slug}"`)
    return null
  }

  const firstMarket = event.markets[0]
  const firstConditionId = firstMarket?.conditionId
  if (!firstConditionId || !isValidConditionId(firstConditionId)) {
    console.warn(
      `[conditionid-resolver] Invalid/missing conditionId for slug "${slug}": "${firstConditionId}"`,
    )
    return null
  }

  // Best-effort persistence of market metadata (outcome names, question) so
  // downstream UIs can surface "Lula" instead of "outcome 0". ParsedMarket
  // already exposes outcomes as a string[] (parsed from Gamma's JSON string)
  // — the array index IS the outcome index, which is the contract used by
  // /holders, /positions and /trades responses. Failure here MUST NOT break
  // slug resolution: the next resolver call will retry, and consumers fall
  // back to "outcome N" when metadata is missing.
  if (prisma) {
    const outcomes = (firstMarket?.outcomes ?? []).map((name, index) => ({
      index,
      name,
    }))
    const question = firstMarket?.question || event.title || null
    try {
      await prisma.marketMetadata.upsert({
        where: { conditionId: firstConditionId },
        create: {
          conditionId: firstConditionId,
          marketSlug: slug,
          question,
          outcomesJson: outcomes,
        },
        update: {
          marketSlug: slug,
          question,
          outcomesJson: outcomes,
          lastFetchedAt: new Date(),
        },
      })
    } catch (err) {
      console.warn(
        `[conditionid-resolver] failed to persist MarketMetadata for ${slug}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  // Best-effort cache write — failure does not break resolution.
  if (redis) {
    try {
      await redis.set(cacheKey, firstConditionId, { ex: CACHE_TTL_SECONDS })
    } catch (err) {
      console.warn(
        `[conditionid-resolver] Redis write failed for ${slug}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return firstConditionId
}
