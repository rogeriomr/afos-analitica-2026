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

  const firstConditionId = event.markets[0]?.conditionId
  if (!firstConditionId || !isValidConditionId(firstConditionId)) {
    console.warn(
      `[conditionid-resolver] Invalid/missing conditionId for slug "${slug}": "${firstConditionId}"`,
    )
    return null
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
