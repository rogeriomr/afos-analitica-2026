/**
 * GET /api/wallet-intel/market/[conditionId]/orderbook
 *
 * Returns the YES + NO orderbooks for a market along with pre-computed
 * forward-impact figures for a standard ladder of order sizes ($1k, $10k,
 * $100k, $1M). Powers the price-impact UI panel that lets analysts answer
 * "how much would it cost to move this market by X%?".
 *
 * Resolution chain for YES/NO tokenIds:
 *   1. Try wallet.market_metadata.outcomesJson[*].tokenId — usually NOT
 *      present (our resolver only stores {index, name}), so this misses.
 *   2. Hit gamma-api.polymarket.com/markets?condition_ids={cid} and pull
 *      `clobTokenIds` (an array of 2 stringified-uint256 token ids).
 *   3. If both fail, return tokenIds=null + null books + empty impact maps.
 *      We do NOT return 500 — missing data is a legitimate state for newly
 *      tracked / closed / non-CLOB markets. console.warn once per request.
 *
 * Auth: gated by middleware (Basic auth via WALLET_INTEL_PASSWORD).
 */

import { NextResponse } from 'next/server';
import { isValidConditionId } from '../../../_shared';
import {
  fetchBooksBatch,
  forwardImpact,
  totalSideUsd,
  type ForwardResult,
  type NormalizedBook,
} from '../../../../../lib/wallet-intel/orderbook';

export const runtime = 'nodejs';
// Orderbook snapshots are cached briefly at the CDN (30 s) so the price-impact
// panel can re-render without hammering CLOB on every navigation. 30 s is the
// sweet spot: the spreads we're studying don't move materially inside half a
// minute, and the cache amortizes the per-request cost of two CLOB hits +
// one gamma-api lookup. `dynamic` still re-validates per request so admin
// scans of stale markets always see a fresh fetch.
export const dynamic = 'force-dynamic';

// Standard impact ladder — covers the realistic operator range from
// retail-size to institutional-size orders.
const IMPACT_SIZES_USD = [1_000, 10_000, 100_000, 1_000_000] as const;
type ImpactSizeKey = (typeof IMPACT_SIZES_USD)[number] extends infer K
  ? K extends number
    ? `${K}`
    : never
  : never;

interface ImpactMap {
  buy: Record<ImpactSizeKey, ForwardResult>;
  sell: Record<ImpactSizeKey, ForwardResult>;
}

// In-process memoization for clobTokenIds. Lives for the lifetime of the
// Node worker — that's ample for our needs since clobTokenIds for a given
// conditionId are immutable. The Map is bounded by # of distinct condition
// ids the worker has seen (small in practice).
const tokenIdCache = new Map<string, { yes: string; no: string }>();

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const GAMMA_TIMEOUT_MS = 10_000;

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Resolve YES/NO tokenIds via gamma-api. Polymarket returns markets as
 * `clobTokenIds: '["yesTokenId","noTokenId"]'` (stringified JSON array of
 * two stringified uint256). We parse defensively — if anything is shaped
 * unexpectedly we return null and let the caller fall back.
 *
 * Convention: index 0 = YES, index 1 = NO. This mirrors Polymarket's
 * `outcomes` ordering on binary markets and matches what holder/positions
 * endpoints expect.
 */
async function fetchTokenIdsFromGamma(
  conditionId: string,
): Promise<{ yes: string; no: string } | null> {
  const url = `${GAMMA_API_BASE}/markets?condition_ids=${encodeURIComponent(conditionId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GAMMA_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn(
        `[wallet-intel-api/orderbook] gamma-api ${res.status} for ${conditionId}`,
      );
      return null;
    }
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data) ? data : [];
    if (list.length === 0) return null;
    const market = list[0] as Record<string, unknown>;

    // clobTokenIds may arrive as a stringified JSON array (canonical) or
    // already-parsed array (older fixtures). Handle both.
    const raw = market.clobTokenIds;
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (!Array.isArray(parsed) || parsed.length < 2) return null;
    const yes = asString(parsed[0]);
    const no = asString(parsed[1]);
    if (!yes || !no) return null;
    return { yes, no };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[wallet-intel-api/orderbook] gamma-api network for ${conditionId}: ${msg}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTokenIds(
  conditionId: string,
): Promise<{ yes: string; no: string } | null> {
  const cached = tokenIdCache.get(conditionId);
  if (cached) return cached;
  const resolved = await fetchTokenIdsFromGamma(conditionId);
  if (resolved) tokenIdCache.set(conditionId, resolved);
  return resolved;
}

/**
 * Build the buy/sell impact map for one book at every size in the ladder.
 * `buy` walks asks (asc), `sell` walks bids (desc).
 */
function buildImpactMap(book: NormalizedBook): ImpactMap {
  const buy = {} as Record<ImpactSizeKey, ForwardResult>;
  const sell = {} as Record<ImpactSizeKey, ForwardResult>;
  for (const size of IMPACT_SIZES_USD) {
    const key = String(size) as ImpactSizeKey;
    buy[key] = forwardImpact(book.asks, size);
    sell[key] = forwardImpact(book.bids, size);
  }
  return { buy, sell };
}

function emptyImpactMap(): ImpactMap {
  const empty: ForwardResult = {
    fillVwap: NaN,
    postPrice: NaN,
    sharesAcquired: 0,
    filledUsd: 0,
    thinBook: true,
    feeUsd: 0,
  };
  const buy = {} as Record<ImpactSizeKey, ForwardResult>;
  const sell = {} as Record<ImpactSizeKey, ForwardResult>;
  for (const size of IMPACT_SIZES_USD) {
    const key = String(size) as ImpactSizeKey;
    buy[key] = empty;
    sell[key] = empty;
  }
  return { buy, sell };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ conditionId: string }> },
) {
  try {
    const { conditionId: raw } = await context.params;
    const conditionId = raw.toLowerCase();
    if (!isValidConditionId(conditionId)) {
      return NextResponse.json(
        {
          error: 'invalid_condition_id',
          message: 'conditionId must match /^0x[a-f0-9]{64}$/',
        },
        { status: 400 },
      );
    }

    const tokenIds = await resolveTokenIds(conditionId);
    if (!tokenIds) {
      console.warn(
        `[wallet-intel-api/orderbook] no tokenIds resolved for ${conditionId} — returning empty payload`,
      );
      return NextResponse.json(
        {
          conditionId,
          tokenIds: null,
          yesBook: null,
          noBook: null,
          yesImpact: emptyImpactMap(),
          noImpact: emptyImpactMap(),
          yesDepthUsd: { bids: 0, asks: 0 },
          noDepthUsd: { bids: 0, asks: 0 },
          fetchedAt: new Date().toISOString(),
        },
        {
          status: 200,
          headers: {
            // Short cache even on empty payload: a closed-then-reopened market
            // could legitimately gain tokenIds in the next minute.
            'Cache-Control': 'public, max-age=30',
          },
        },
      );
    }

    // Single batched CLOB hit instead of two sequential — cheaper and atomic.
    const books = await fetchBooksBatch([tokenIds.yes, tokenIds.no]);
    const yesBook = books.get(tokenIds.yes) ?? null;
    const noBook = books.get(tokenIds.no) ?? null;

    const yesImpact = yesBook ? buildImpactMap(yesBook) : emptyImpactMap();
    const noImpact = noBook ? buildImpactMap(noBook) : emptyImpactMap();

    const yesDepthUsd = {
      bids: yesBook ? totalSideUsd(yesBook.bids) : 0,
      asks: yesBook ? totalSideUsd(yesBook.asks) : 0,
    };
    const noDepthUsd = {
      bids: noBook ? totalSideUsd(noBook.bids) : 0,
      asks: noBook ? totalSideUsd(noBook.asks) : 0,
    };

    return NextResponse.json(
      {
        conditionId,
        tokenIds,
        yesBook,
        noBook,
        yesImpact,
        noImpact,
        yesDepthUsd,
        noDepthUsd,
        fetchedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          // 30s is the contract between this API and the UI panel: shorter
          // than the typical analyst's reading time, long enough to absorb
          // tab-revisits without re-hitting CLOB.
          'Cache-Control': 'public, max-age=30',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[wallet-intel-api] market/[conditionId]/orderbook GET failed:', error);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
