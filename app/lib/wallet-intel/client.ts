/**
 * Polymarket Data API Client — Wallet Intelligence
 *
 * Covers data-api.polymarket.com endpoints: /holders, /positions, /trades,
 * /activity, /value, /v1/leaderboard, /profile. Each public function calls
 * acquireToken(EndpointKey) before issuing a request so the in-process token
 * bucket (./rate-limiter) keeps us within Polymarket's 10-second windows.
 * Circuit breaker, timeout, retry-with-jitter, and address/conditionId regex
 * validation all mirror app/lib/polymarket/client.ts. Public functions never
 * throw — they return null, [], or a typed object.
 */

import type {
  PolymarketActivity,
  PolymarketActivityType,
  PolymarketHolder,
  PolymarketLeaderboardEntry,
  PolymarketPosition,
  PolymarketProfile,
  PolymarketTrade,
  PolymarketTradeSide,
} from './types';
import { acquireToken, type EndpointKey } from './rate-limiter';

// ─── Constants ──────────────────────────────────────────────────────

const DATA_API_BASE = 'https://data-api.polymarket.com';
// Reserved for future use (orderbook reads, market lookups). Not used yet.
export const CLOB_API_BASE = 'https://clob.polymarket.com';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;

// Proactively slow down when the API tells us we're below 20% of remaining budget.
const RATE_LIMIT_SLOWDOWN_THRESHOLD = 0.2;
const RATE_LIMIT_SLOWDOWN_MS = 500;

// ─── Circuit Breaker ────────────────────────────────────────────────

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const circuit = {
  state: 'CLOSED' as CircuitState,
  failureCount: 0,
  lastFailureAt: 0,
  cooldownMs: 5 * 60 * 1000, // 5 minutes
  threshold: 3,
};

function checkCircuit(): boolean {
  if (circuit.state === 'CLOSED') return true;
  if (circuit.state === 'OPEN') {
    if (Date.now() - circuit.lastFailureAt > circuit.cooldownMs) {
      circuit.state = 'HALF_OPEN';
      console.warn('[wallet-intel-client] Circuit HALF_OPEN — attempting probe request');
      return true;
    }
    return false;
  }
  // HALF_OPEN: allow one request
  return true;
}

function recordSuccess(): void {
  if (circuit.state !== 'CLOSED') {
    console.warn('[wallet-intel-client] Circuit CLOSED — recovered');
  }
  circuit.state = 'CLOSED';
  circuit.failureCount = 0;
}

function recordFailure(): void {
  circuit.failureCount++;
  circuit.lastFailureAt = Date.now();
  if (circuit.failureCount >= circuit.threshold || circuit.state === 'HALF_OPEN') {
    circuit.state = 'OPEN';
    console.warn(
      `[wallet-intel-client] Circuit OPEN — ${circuit.failureCount} consecutive failures, cooldown ${circuit.cooldownMs / 1000}s`,
    );
  }
}

// ─── Validation ─────────────────────────────────────────────────────

const WALLET_RE = /^0x[a-f0-9]{40}$/;
const CONDITION_ID_RE = /^0x[a-f0-9]{64}$/;

/** True if `addr` is a 42-char lowercase hex Ethereum address. */
export function isValidWalletAddress(addr: string): boolean {
  return typeof addr === 'string' && WALLET_RE.test(addr);
}

/** True if `cid` is a 66-char lowercase hex Polymarket conditionId. */
export function isValidConditionId(cid: string): boolean {
  return typeof cid === 'string' && CONDITION_ID_RE.test(cid);
}

// ─── Core Fetch ─────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter (AWS algorithm). */
function backoffDelay(attempt: number): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

async function fetchWithTimeout(url: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch with rate-limiter token acquisition, exponential backoff w/ jitter,
 * and circuit-breaker integration. Transient failures (5xx, network, timeout)
 * are retried up to `retries` times. 4xx (besides 429) and circuit-open both
 * short-circuit to null.
 */
async function fetchWithRetry(
  url: string,
  key: EndpointKey,
  retries: number = MAX_RETRIES,
): Promise<Response | null> {
  if (!checkCircuit()) {
    console.warn('[wallet-intel-client] Circuit OPEN — skipping request:', url);
    return null;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquireToken(key);

    try {
      const res = await fetchWithTimeout(url);

      // Proactive slowdown when the server warns we're near the cap.
      const remainingHeader = res.headers.get('x-ratelimit-remaining');
      const limitHeader = res.headers.get('x-ratelimit-limit');
      if (remainingHeader && limitHeader) {
        const remaining = Number(remainingHeader);
        const limit = Number(limitHeader);
        if (Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0) {
          if (remaining / limit < RATE_LIMIT_SLOWDOWN_THRESHOLD) {
            await sleep(RATE_LIMIT_SLOWDOWN_MS);
          }
        }
      }

      if (res.status === 429) {
        console.warn('[wallet-intel-client] Rate limited (429); backing off');
        if (attempt < retries) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        recordFailure();
        return null;
      }

      if (res.ok) {
        recordSuccess();
        return res;
      }

      // 5xx: retry
      if (res.status >= 500 && attempt < retries) {
        console.warn(
          `[wallet-intel-client] Server error ${res.status}, retry ${attempt + 1}/${retries}`,
        );
        await sleep(backoffDelay(attempt));
        continue;
      }

      // 4xx (not 429): don't retry — bad request shape, not transient.
      console.error(`[wallet-intel-client] Client error ${res.status}: ${url}`);
      recordFailure();
      return null;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes('aborted')) {
        console.error(`[wallet-intel-client] Timeout (${DEFAULT_TIMEOUT_MS}ms): ${url}`);
      } else {
        console.error(`[wallet-intel-client] Network error: ${msg}`);
      }

      if (attempt < retries) {
        await sleep(backoffDelay(attempt));
        continue;
      }

      recordFailure();
      return null;
    }
  }

  return null;
}

// ─── Safe JSON Helpers ──────────────────────────────────────────────

async function safeJsonArray(res: Response): Promise<unknown[]> {
  try {
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[wallet-intel-client] JSON parse error:', error);
    return [];
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function asOptionalNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function asBool(v: unknown): boolean {
  return v === true;
}

function asTradeSide(v: unknown): PolymarketTradeSide {
  return v === 'SELL' ? 'SELL' : 'BUY';
}

function asActivityType(v: unknown): PolymarketActivityType {
  const allowed: readonly PolymarketActivityType[] = [
    'TRADE', 'SPLIT', 'MERGE', 'REDEEM', 'REWARD', 'CONVERSION',
  ];
  return (allowed as readonly string[]).includes(v as string)
    ? (v as PolymarketActivityType)
    : 'TRADE';
}

// ─── Row Parsers ────────────────────────────────────────────────────

function parseHolder(raw: unknown): PolymarketHolder | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const tokenId = asString(r.tokenId) ?? asString(r.asset);
  const holder = asString(r.holder) ?? asString(r.proxyWallet);
  if (!tokenId || !holder) return null;
  return {
    tokenId,
    // Normalize address to lowercase — every downstream lookup (dedup,
    // proxyAddress matching, RedFlag joins) expects lowercase hex.
    holder: holder.toLowerCase(),
    // Polymarket /holders uses `pseudonym` for the public name; fall back
    // to `username`/`name` for forward-compat with other Data API endpoints.
    username: asString(r.username) ?? asString(r.name) ?? asString(r.pseudonym),
    amount: asNumber(r.amount),
    outcomeIndex: asNumber(r.outcomeIndex),
  };
}

function parsePosition(raw: unknown): PolymarketPosition | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const user = asString(r.user) ?? asString(r.proxyWallet);
  const conditionId = asString(r.conditionId);
  if (!user || !conditionId) return null;
  return {
    user,
    conditionId,
    outcomeIndex: asNumber(r.outcomeIndex),
    outcomeName: asString(r.outcome) ?? asString(r.outcomeName) ?? '',
    size: asNumber(r.size),
    avgPrice: asNumber(r.avgPrice),
    initialValue: asNumber(r.initialValue),
    currentValue: asNumber(r.currentValue),
    cashPnl: asNumber(r.cashPnl),
    percentPnl: asNumber(r.percentPnl),
    title: asString(r.title) ?? '',
  };
}

function parseTrade(raw: unknown): PolymarketTrade | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const proxyWallet = asString(r.proxyWallet) ?? asString(r.user);
  const conditionId = asString(r.conditionId);
  const transactionHash = asString(r.transactionHash) ?? asString(r.txHash);
  if (!proxyWallet || !conditionId || !transactionHash) return null;
  return {
    proxyWallet,
    side: asTradeSide(r.side),
    asset: asString(r.asset) ?? '',
    conditionId,
    outcomeIndex: asNumber(r.outcomeIndex),
    size: asNumber(r.size),
    price: asNumber(r.price),
    timestamp: asNumber(r.timestamp),
    transactionHash,
    title: asString(r.title),
  };
}

function parseActivity(raw: unknown): PolymarketActivity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const user = asString(r.user) ?? asString(r.proxyWallet);
  const transactionHash = asString(r.transactionHash) ?? asString(r.txHash);
  if (!user || !transactionHash) return null;
  return {
    type: asActivityType(r.type),
    user,
    market: asString(r.market),
    conditionId: asString(r.conditionId),
    outcomeIndex: asOptionalNumber(r.outcomeIndex),
    size: asOptionalNumber(r.size),
    price: asOptionalNumber(r.price),
    usdcSize: asOptionalNumber(r.usdcSize),
    timestamp: asNumber(r.timestamp),
    transactionHash,
    title: asString(r.title),
  };
}

function parseLeaderboardEntry(raw: unknown, fallbackRank: number): PolymarketLeaderboardEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const proxyWallet = asString(r.proxyWallet) ?? asString(r.user);
  if (!proxyWallet) return null;
  return {
    rank: asOptionalNumber(r.rank) ?? fallbackRank,
    proxyWallet,
    userName: asString(r.userName) ?? asString(r.name),
    vol: asNumber(r.vol),
    pnl: asNumber(r.pnl),
    profileImage: asString(r.profileImage),
    xUsername: asString(r.xUsername),
    verifiedBadge: asBool(r.verifiedBadge),
  };
}

function parseProfile(raw: unknown): PolymarketProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const proxyWallet = asString(r.proxyWallet) ?? asString(r.user);
  if (!proxyWallet) return null;
  return {
    proxyWallet,
    name: asString(r.name),
    pseudonym: asString(r.pseudonym),
    displayUsernamePublic:
      typeof r.displayUsernamePublic === 'boolean' ? r.displayUsernamePublic : undefined,
    profileImage: asString(r.profileImage),
    xUsername: asString(r.xUsername),
  };
}

// ─── Query-String Helper ────────────────────────────────────────────

type QueryValue = string | number | boolean | undefined | null | readonly (string | number)[];

function buildQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.join(','))}`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * GET /holders?market={conditionId}&limit={n}
 * Top holders of a market by token amount.
 * Returns [] on validation failure, circuit-open, or hard HTTP error.
 */
export async function fetchHolders(
  conditionId: string,
  opts?: { limit?: number },
): Promise<PolymarketHolder[]> {
  if (!isValidConditionId(conditionId)) {
    console.error(`[wallet-intel-client] Invalid conditionId: "${conditionId}"`);
    return [];
  }
  const qs = buildQuery({ market: conditionId, limit: opts?.limit });
  const res = await fetchWithRetry(`${DATA_API_BASE}/holders${qs}`, 'general');
  if (!res) return [];
  const tokenGroups = await safeJsonArray(res);

  // Polymarket /holders returns [{ token, holders: [{...}, ...] }, ...] — one
  // group per outcome token. Flatten into the canonical PolymarketHolder[]
  // by propagating the group's token id onto each inner holder before parse.
  const flat: PolymarketHolder[] = [];
  for (const group of tokenGroups) {
    if (!group || typeof group !== 'object') continue;
    const g = group as Record<string, unknown>;
    const tokenId = asString(g.token) ?? asString(g.tokenId);
    const inner = Array.isArray(g.holders) ? g.holders : [];
    for (const h of inner) {
      if (!h || typeof h !== 'object') continue;
      const enriched = { ...(h as Record<string, unknown>), tokenId: tokenId ?? '' };
      const parsed = parseHolder(enriched);
      if (parsed) flat.push(parsed);
    }
  }
  return flat;
}

/**
 * GET /positions?user={addr}&market={cid}&sizeThreshold={n}&sortBy={key}
 * Open positions for a user. `sizeThreshold` filters out dust positions.
 * Returns [] on validation failure, circuit-open, or hard HTTP error.
 */
export async function fetchPositions(
  user: string,
  opts?: {
    market?: string;
    sizeThreshold?: number;
    sortBy?: 'TOKENS' | 'CURRENT' | 'INITIAL' | 'CASHPNL' | 'PERCENTPNL' | 'PRICE';
  },
): Promise<PolymarketPosition[]> {
  if (!isValidWalletAddress(user)) {
    console.error(`[wallet-intel-client] Invalid wallet: "${user}"`);
    return [];
  }
  if (opts?.market !== undefined && !isValidConditionId(opts.market)) {
    console.error(`[wallet-intel-client] Invalid market conditionId: "${opts.market}"`);
    return [];
  }
  const qs = buildQuery({
    user,
    market: opts?.market,
    sizeThreshold: opts?.sizeThreshold,
    sortBy: opts?.sortBy,
  });
  const res = await fetchWithRetry(`${DATA_API_BASE}/positions${qs}`, 'positions');
  if (!res) return [];
  const rows = await safeJsonArray(res);
  return rows.map(parsePosition).filter((p): p is PolymarketPosition => p !== null);
}

/**
 * GET /trades?user={addr}&market={cid}&filterType={CASH|TOKENS}&filterAmount={n}
 *           &takerOnly={true|false}&limit={n}&offset={n}
 * Trades executed by a user. Supports market filter and CASH/TOKENS amount filter.
 * Returns [] on validation failure, circuit-open, or hard HTTP error.
 */
export async function fetchTrades(
  user: string,
  opts?: {
    market?: string;
    takerOnly?: boolean;
    limit?: number;
    offset?: number;
    filterType?: 'CASH' | 'TOKENS';
    filterAmount?: number;
  },
): Promise<PolymarketTrade[]> {
  if (!isValidWalletAddress(user)) {
    console.error(`[wallet-intel-client] Invalid wallet: "${user}"`);
    return [];
  }
  if (opts?.market !== undefined && !isValidConditionId(opts.market)) {
    console.error(`[wallet-intel-client] Invalid market conditionId: "${opts.market}"`);
    return [];
  }
  const qs = buildQuery({
    user,
    market: opts?.market,
    takerOnly: opts?.takerOnly,
    limit: opts?.limit,
    offset: opts?.offset,
    filterType: opts?.filterType,
    filterAmount: opts?.filterAmount,
  });
  const res = await fetchWithRetry(`${DATA_API_BASE}/trades${qs}`, 'trades');
  if (!res) return [];
  const rows = await safeJsonArray(res);
  return rows.map(parseTrade).filter((t): t is PolymarketTrade => t !== null);
}

/**
 * GET /trades?market={cid}&limit={n}&offset={n}
 * All trades in a market (no user filter). Useful for tape/flow analysis.
 * Returns [] on validation failure, circuit-open, or hard HTTP error.
 */
export async function fetchTradesByMarket(
  conditionId: string,
  opts?: { limit?: number; offset?: number },
): Promise<PolymarketTrade[]> {
  if (!isValidConditionId(conditionId)) {
    console.error(`[wallet-intel-client] Invalid conditionId: "${conditionId}"`);
    return [];
  }
  const qs = buildQuery({ market: conditionId, limit: opts?.limit, offset: opts?.offset });
  const res = await fetchWithRetry(`${DATA_API_BASE}/trades${qs}`, 'trades');
  if (!res) return [];
  const rows = await safeJsonArray(res);
  return rows.map(parseTrade).filter((t): t is PolymarketTrade => t !== null);
}

/**
 * GET /activity?user={addr}&market={cid}&type={csv}&start={unix}&end={unix}
 *             &limit={n}&offset={n}
 * Semantic event timeline (TRADE/SPLIT/MERGE/REDEEM/REWARD/CONVERSION).
 * Multiple `type` values are sent as a comma-separated list.
 * Returns [] on validation failure, circuit-open, or hard HTTP error.
 */
export async function fetchActivity(
  user: string,
  opts?: {
    market?: string;
    type?: PolymarketActivityType[];
    start?: number;
    end?: number;
    limit?: number;
    offset?: number;
  },
): Promise<PolymarketActivity[]> {
  if (!isValidWalletAddress(user)) {
    console.error(`[wallet-intel-client] Invalid wallet: "${user}"`);
    return [];
  }
  if (opts?.market !== undefined && !isValidConditionId(opts.market)) {
    console.error(`[wallet-intel-client] Invalid market conditionId: "${opts.market}"`);
    return [];
  }
  const qs = buildQuery({
    user,
    market: opts?.market,
    type: opts?.type,
    start: opts?.start,
    end: opts?.end,
    limit: opts?.limit,
    offset: opts?.offset,
  });
  const res = await fetchWithRetry(`${DATA_API_BASE}/activity${qs}`, 'general');
  if (!res) return [];
  const rows = await safeJsonArray(res);
  return rows.map(parseActivity).filter((a): a is PolymarketActivity => a !== null);
}

/**
 * GET /value?user={addr}
 * Total USD value of a user's open positions. Returns null on failure.
 * Note: the endpoint sometimes returns an object and sometimes an array of
 * one object — handle both.
 */
export async function fetchValue(user: string): Promise<number | null> {
  if (!isValidWalletAddress(user)) {
    console.error(`[wallet-intel-client] Invalid wallet: "${user}"`);
    return null;
  }
  const res = await fetchWithRetry(`${DATA_API_BASE}/value?user=${encodeURIComponent(user)}`, 'general');
  if (!res) return null;

  try {
    const data = (await res.json()) as unknown;
    const obj: Record<string, unknown> | null = Array.isArray(data)
      ? (data[0] && typeof data[0] === 'object' ? (data[0] as Record<string, unknown>) : null)
      : (data && typeof data === 'object' ? (data as Record<string, unknown>) : null);
    if (!obj) return null;
    const value = asOptionalNumber(obj.value);
    if (value === undefined) return null;
    // The canonical wire shape is PolymarketValueResponse { user, value };
    // we expose just the number for caller ergonomics.
    return value;
  } catch (error) {
    console.error('[wallet-intel-client] JSON parse error for /value:', error);
    return null;
  }
}

/**
 * GET /v1/leaderboard?timePeriod={DAY|WEEK|MONTH|ALL}&category={...}
 *                    &orderBy={PNL|VOL}&limit={n}&offset={n}
 * Top traders. Max `limit` is 50 per call; paginate with `offset` for more.
 * Returns [] on circuit-open or hard HTTP error.
 */
export async function fetchLeaderboard(
  opts?: {
    timePeriod?: 'DAY' | 'WEEK' | 'MONTH' | 'ALL';
    category?: string;
    orderBy?: 'PNL' | 'VOL';
    limit?: number;
    offset?: number;
  },
): Promise<PolymarketLeaderboardEntry[]> {
  const limit = opts?.limit;
  if (limit !== undefined && (limit < 1 || limit > 50)) {
    console.warn(`[wallet-intel-client] Leaderboard limit ${limit} outside [1,50]; clamping at request time`);
  }
  const qs = buildQuery({
    timePeriod: opts?.timePeriod,
    category: opts?.category,
    orderBy: opts?.orderBy,
    limit: limit === undefined ? undefined : Math.max(1, Math.min(50, limit)),
    offset: opts?.offset,
  });
  const res = await fetchWithRetry(`${DATA_API_BASE}/v1/leaderboard${qs}`, 'general');
  if (!res) return [];
  const rows = await safeJsonArray(res);
  const baseRank = (opts?.offset ?? 0) + 1;
  return rows
    .map((row, i) => parseLeaderboardEntry(row, baseRank + i))
    .filter((e): e is PolymarketLeaderboardEntry => e !== null);
}

/**
 * GET /profile?user={addr}
 * Best-effort profile lookup. The exact profile endpoint URL is not officially
 * documented; if /profile returns 404/4xx the function logs a warning and
 * returns null rather than throwing. Callers should treat null as "unknown".
 */
export async function fetchProfile(wallet: string): Promise<PolymarketProfile | null> {
  if (!isValidWalletAddress(wallet)) {
    console.error(`[wallet-intel-client] Invalid wallet: "${wallet}"`);
    return null;
  }
  const res = await fetchWithRetry(
    `${DATA_API_BASE}/profile?user=${encodeURIComponent(wallet)}`,
    'general',
  );
  if (!res) {
    console.warn(`[wallet-intel-client] Profile lookup unavailable for ${wallet}`);
    return null;
  }
  // /profile may return an object or a single-element array; handle both.
  try {
    const data = (await res.json()) as unknown;
    const obj: Record<string, unknown> | null = Array.isArray(data)
      ? (data[0] && typeof data[0] === 'object' ? (data[0] as Record<string, unknown>) : null)
      : (data && typeof data === 'object' ? (data as Record<string, unknown>) : null);
    if (!obj) return null;
    // Ensure proxyWallet is present — backfill from the input if the API omits it.
    if (!asString(obj.proxyWallet) && !asString(obj.user)) {
      obj.proxyWallet = wallet;
    }
    return parseProfile(obj);
  } catch (error) {
    console.error('[wallet-intel-client] JSON parse error for /profile:', error);
    return null;
  }
}

/**
 * Snapshot of circuit-breaker state for /api/health-style probes.
 */
export function getCircuitStatus(): { state: CircuitState; failures: number } {
  return { state: circuit.state, failures: circuit.failureCount };
}
