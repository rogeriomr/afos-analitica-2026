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
 * Heuristic extractor for the candidate / subject name from a binary
 * "Will X ... ?" prediction-market question. Bounded narrowly to
 * **political-style** markets where YES means "supports X" and NO means
 * "against X". Returns null for anything ambiguous so the UI safely
 * skips rendering a "supports / against" subtitle.
 *
 * Positive examples (returns the captured name):
 *   - "Will Tarcisio de Freitas win the 2026 Brazilian presidential election?"
 *     → "Tarcisio de Freitas"
 *   - "Will Vicky Dávila win the 2026 Colombian presidential election" → "Vicky Dávila"
 *   - "Will Renan Santos finish in second place in the first round..."
 *     → "Renan Santos"
 *
 * Negative cases (returns null) — explicitly NOT a candidate name:
 *   - "Will Brazil's Annual Inflation in 2026 be less than 5%?"
 *     (subject starts with possessive "Brazil's" → not a person)
 *   - "Any Brazil STF Justice removed by impeachment before 2027"
 *     (does not match the "Will <X> (win|finish|be|hit|reach)" pattern)
 *   - "Will the Fed rate hit 5%" (subject contains "rate")
 *   - "Will US GDP reach ..." (subject contains "gdp")
 *   - "Will inflation be less than 5%" (subject contains "inflation")
 *   - Anything whose verb is not in {win, finish, be, hit, reach}.
 *
 * The captured group is also lightly trimmed/sanitised: a name longer
 * than 80 characters is treated as a bad capture and returns null
 * (defensive — keeps malformed questions from rendering huge subtitles).
 */
export function extractCandidateFromQuestion(question: string | null | undefined): string | null {
  if (!question) return null
  // Capture group: subject before the binary verb. The verb list is
  // intentionally short — adding more verbs widens the capture surface
  // and starts matching non-political markets (price, weather, sports).
  const m = question.match(/^Will\s+(.+?)\s+(?:win|finish|be|hit|reach)\b/i)
  if (!m || !m[1]) return null
  const name = m[1].trim()
  if (name.length === 0 || name.length > 80) return null
  // Drop possessive "<X>'s" subjects ("Brazil's Annual Inflation ...")
  // — these are abstract subjects, not people we can say "supports".
  if (/'s$/.test(name)) return null
  // Drop subjects that obviously refer to macro/sport/weather topics
  // rather than a candidate. This list is the load-bearing safety net.
  if (/\b(inflation|election|justice|annual|gdp|rate|price|stock|index|temperature|weather|impeachment)\b/i.test(name)) return null
  return name
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
