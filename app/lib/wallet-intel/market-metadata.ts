/**
 * Market metadata accessors — outcome names + market questions.
 *
 * Reads from the `wallet.market_metadata` table populated as a side effect
 * by `conditionid-resolver.resolveConditionId`. All helpers degrade
 * gracefully: missing prisma / missing row / malformed JSON => empty / null,
 * never throws. Callers should treat null/empty as "metadata not yet
 * captured" and fall back to `outcome N` / the slug as the display string.
 */

import { prisma } from '../../../lib/db'

export interface Outcome {
  index: number
  name: string
}

function parseOutcomes(raw: unknown): Outcome[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (o): o is { index: number; name: string } =>
        o !== null &&
        typeof o === 'object' &&
        typeof (o as { index?: unknown }).index === 'number' &&
        typeof (o as { name?: unknown }).name === 'string',
    )
    .sort((a, b) => a.index - b.index)
}

/**
 * Resolve all outcomes for a market, sorted by index ascending.
 * Returns [] when prisma is unavailable, the row is missing, or
 * the stored JSON cannot be coerced to {index,name}[].
 */
export async function getMarketOutcomes(conditionId: string): Promise<Outcome[]> {
  if (!prisma) return []
  const row = await prisma.marketMetadata.findUnique({ where: { conditionId } })
  if (!row) return []
  return parseOutcomes(row.outcomesJson)
}

/**
 * Convenience accessor: name of a specific outcome index, or null when
 * unknown. UIs should fall back to `outcome ${index}` in that case.
 */
export async function getOutcomeName(
  conditionId: string,
  outcomeIndex: number,
): Promise<string | null> {
  const outcomes = await getMarketOutcomes(conditionId)
  const match = outcomes.find((o) => o.index === outcomeIndex)
  return match ? match.name : null
}

/**
 * Market-level human-readable question (e.g. "Will Lula win in 2026?").
 * Returns null when the row is missing.
 */
export async function getMarketQuestion(conditionId: string): Promise<string | null> {
  if (!prisma) return null
  const row = await prisma.marketMetadata.findUnique({
    where: { conditionId },
    select: { question: true },
  })
  return row?.question ?? null
}

/**
 * Batch variant for list pages rendering N markets at once. Issues a
 * single `IN (...)` query and groups results by conditionId. Markets
 * with no stored metadata are simply absent from the returned Map —
 * callers should treat missing keys as "unknown outcomes".
 */
export async function getOutcomesByConditionIds(
  conditionIds: string[],
): Promise<Map<string, Outcome[]>> {
  const map = new Map<string, Outcome[]>()
  if (!prisma || conditionIds.length === 0) return map
  const rows = await prisma.marketMetadata.findMany({
    where: { conditionId: { in: conditionIds } },
    select: { conditionId: true, outcomesJson: true },
  })
  for (const r of rows) {
    map.set(r.conditionId, parseOutcomes(r.outcomesJson))
  }
  return map
}
