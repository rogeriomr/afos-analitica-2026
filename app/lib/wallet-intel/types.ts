/**
 * Polymarket Data API — Type Definitions
 *
 * Strongly-typed shapes for every response returned by data-api.polymarket.com.
 * Optional fields are kept optional (?:) to reflect the API's actual nullability.
 * Readonly is applied to value-object shapes that consumers should treat as immutable.
 */

// ─── Holders ────────────────────────────────────────────────────────

/**
 * A single holder entry from GET /holders.
 * `outcomeIndex` maps into the market's outcome array (0 = YES, 1 = NO, etc.).
 */
export interface PolymarketHolder {
  readonly tokenId: string;
  readonly holder: string;
  readonly username?: string;
  readonly amount: number;
  readonly outcomeIndex: number;
}

// ─── Positions ──────────────────────────────────────────────────────

/**
 * A user position from GET /positions.
 * Sizes/values are in token (shares) and USD respectively.
 */
export interface PolymarketPosition {
  readonly user: string;
  readonly conditionId: string;
  readonly outcomeIndex: number;
  readonly outcomeName: string;
  readonly size: number;
  readonly avgPrice: number;
  readonly initialValue: number;
  readonly currentValue: number;
  readonly cashPnl: number;
  readonly percentPnl: number;
  readonly title: string;
}

// ─── Trades ─────────────────────────────────────────────────────────

/**
 * Side of a trade — BUY adds exposure, SELL reduces it.
 */
export type PolymarketTradeSide = 'BUY' | 'SELL';

/**
 * A single trade from GET /trades.
 * `timestamp` is unix seconds. `transactionHash` is the on-chain tx hash.
 */
export interface PolymarketTrade {
  readonly proxyWallet: string;
  readonly side: PolymarketTradeSide;
  readonly asset: string;
  readonly conditionId: string;
  readonly outcomeIndex: number;
  readonly size: number;
  readonly price: number;
  readonly timestamp: number;
  readonly transactionHash: string;
  readonly title?: string;
}

// ─── Activity ───────────────────────────────────────────────────────

/**
 * Semantic event types returned by GET /activity.
 * TRADE covers BUY/SELL; the others are conditional-token mechanics.
 */
export type PolymarketActivityType =
  | 'TRADE'
  | 'SPLIT'
  | 'MERGE'
  | 'REDEEM'
  | 'REWARD'
  | 'CONVERSION';

/**
 * A user activity row from GET /activity.
 * Field availability varies by `type`: e.g. SPLIT/MERGE may omit price.
 */
export interface PolymarketActivity {
  readonly type: PolymarketActivityType;
  readonly user: string;
  readonly market?: string;
  readonly conditionId?: string;
  readonly outcomeIndex?: number;
  readonly size?: number;
  readonly price?: number;
  readonly usdcSize?: number;
  readonly timestamp: number;
  readonly transactionHash: string;
  readonly title?: string;
}

// ─── Leaderboard ────────────────────────────────────────────────────

/**
 * One leaderboard row from GET /v1/leaderboard.
 * `vol` is cumulative USD volume, `pnl` is cumulative USD PnL for the period.
 */
export interface PolymarketLeaderboardEntry {
  readonly rank: number;
  readonly proxyWallet: string;
  readonly userName?: string;
  readonly vol: number;
  readonly pnl: number;
  readonly profileImage?: string;
  readonly xUsername?: string;
  readonly verifiedBadge: boolean;
}

// ─── Profile ────────────────────────────────────────────────────────

/**
 * User profile (best-effort — endpoint URL not officially documented).
 * Caller should not assume any field besides `proxyWallet` is present.
 */
export interface PolymarketProfile {
  readonly proxyWallet: string;
  readonly name?: string;
  readonly pseudonym?: string;
  readonly displayUsernamePublic?: boolean;
  readonly profileImage?: string;
  readonly xUsername?: string;
}

// ─── Value ──────────────────────────────────────────────────────────

/**
 * Response shape for GET /value — total USD value of a user's open positions.
 */
export interface PolymarketValueResponse {
  readonly user: string;
  readonly value: number;
}
