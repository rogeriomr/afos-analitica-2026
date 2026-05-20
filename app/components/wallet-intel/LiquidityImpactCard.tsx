'use client';

/**
 * Liquidity & Impact card for the market drill-down.
 *
 * Reads the raw `/api/wallet-intel/market/[conditionId]/orderbook` payload
 * (fetched server-side, passed in as `data`) and renders:
 *
 *   1. Header strip — best bid / ask / spread / midpoint stats + relative
 *      "updated" timestamp.
 *   2. Depth bars — per-side USDC depth for YES asks / YES bids / NO asks /
 *      NO bids. Asymmetric ratios (>50×) get a warning icon.
 *   3. Interactive impact slider — pick a size ($1k / $10k / $100k / $1M)
 *      and a side (Buy YES / Buy NO) and the precomputed ForwardResult
 *      is surfaced (VWAP, new top-of-book, fill %, thin-book banner).
 *   4. Collapsible "Why is this market thick?" panel with three neutral
 *      interpretations pre-filled with the live asymmetry ratio.
 *
 * Gracefully degrades to a single muted line when `yesBook` is null
 * (Polymarket unreachable or no token ids resolved). Math is owned by the
 * backend — this component is presentation only.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n/context';
import { RelativeTime } from './RelativeTime';

type Side = 'yes' | 'no';
type Action = 'buy' | 'sell';
type SizeKey = '1000' | '10000' | '100000' | '1000000';

export interface ForwardResult {
  fillVwap: number;
  postPrice: number;
  sharesAcquired: number;
  filledUsd: number;
  thinBook: boolean;
  feeUsd: number;
}

export interface NormalizedBookLite {
  bestBid: number | null;
  bestAsk: number | null;
  tickSize: number;
  minOrderSize: number;
}

export interface LiquidityImpactData {
  conditionId: string;
  tokenIds: { yes: string; no: string } | null;
  yesBook: NormalizedBookLite | null;
  noBook: NormalizedBookLite | null;
  yesImpact: {
    buy: Record<SizeKey, ForwardResult>;
    sell: Record<SizeKey, ForwardResult>;
  };
  noImpact: {
    buy: Record<SizeKey, ForwardResult>;
    sell: Record<SizeKey, ForwardResult>;
  };
  yesDepthUsd: { bids: number; asks: number };
  noDepthUsd: { bids: number; asks: number };
  fetchedAt: string;
}

interface Props {
  data: LiquidityImpactData;
}

const SIZES: ReadonlyArray<{ key: SizeKey; label: string }> = [
  { key: '1000', label: '$1k' },
  { key: '10000', label: '$10k' },
  { key: '100000', label: '$100k' },
  { key: '1000000', label: '$1M' },
];

const ASYMMETRY_THRESHOLD = 50;

function formatUsdCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function formatPrice(p: number | null | undefined, digits = 3): string {
  if (p == null || !Number.isFinite(p)) return '—';
  return `$${p.toFixed(digits)}`;
}

function applyPlaceholders(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
}

/** Ratio of larger / smaller, clamped to a sane display value. Returns Infinity-safe. */
function asymmetryRatio(asks: number, bids: number): number {
  const a = Math.max(0, asks);
  const b = Math.max(0, bids);
  if (a <= 0 && b <= 0) return 0;
  if (a > 0 && b <= 0) return Infinity;
  if (b > 0 && a <= 0) return Infinity;
  return Math.max(a, b) / Math.min(a, b);
}

function formatRatio(r: number): string {
  if (!Number.isFinite(r)) return '∞';
  if (r >= 1000) return `${Math.round(r).toLocaleString('en-US')}`;
  if (r >= 100) return r.toFixed(0);
  if (r >= 10) return r.toFixed(1);
  return r.toFixed(2);
}

/** Stat block (label above, value below). */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="text-sm font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
        {value}
      </span>
    </div>
  );
}

interface DepthBarProps {
  label: string;
  amountUsd: number;
  maxUsd: number;
  /** Tailwind color class (e.g. 'bg-emerald-500'). */
  colorClass: string;
  warning?: string | null;
}

function DepthBar({ label, amountUsd, maxUsd, colorClass, warning }: DepthBarProps) {
  const pct = maxUsd > 0 ? Math.max(2, Math.min(100, (amountUsd / maxUsd) * 100)) : 2;
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-1 gap-2">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1">
          {label}
          {warning && (
            <span
              className="inline-flex items-center text-amber-600 dark:text-amber-400"
              title={warning}
              aria-label={warning}
            >
              {/* tiny warning glyph */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2 1 21h22L12 2zm0 4.84L19.53 19H4.47L12 6.84zM11 10v5h2v-5h-2zm0 6v2h2v-2h-2z" />
              </svg>
            </span>
          )}
        </span>
        <span className="text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
          {formatUsdCompact(amountUsd)}
        </span>
      </div>
      <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div
          className={`${colorClass} h-full transition-[width] duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function LiquidityImpactCard({ data }: Props) {
  const { t } = useTranslation();
  const [side, setSide] = useState<Side>('yes');
  const [sizeKey, setSizeKey] = useState<SizeKey>('10000');
  const [whyOpen, setWhyOpen] = useState(false);

  // Pick the book that's currently being inspected.
  const book = side === 'yes' ? data.yesBook : data.noBook;
  // Buy YES means lifting YES asks; Buy NO means lifting NO asks.
  // For the impact slider we only surface "buy" (the spec's
  // "Buy YES / Buy NO" toggle) — the "sell" half of the API
  // payload is reserved for future use.
  const action: Action = 'buy';
  const impactSide = side === 'yes' ? data.yesImpact : data.noImpact;
  const result = impactSide[action][sizeKey];

  // Max depth value across all four bars — used to scale bar widths so
  // the largest bar is at 100% and the others are proportional.
  const maxDepthUsd = useMemo(() => {
    return Math.max(
      data.yesDepthUsd.asks,
      data.yesDepthUsd.bids,
      data.noDepthUsd.asks,
      data.noDepthUsd.bids,
      1,
    );
  }, [data.yesDepthUsd, data.noDepthUsd]);

  const yesRatio = asymmetryRatio(data.yesDepthUsd.asks, data.yesDepthUsd.bids);
  const noRatio = asymmetryRatio(data.noDepthUsd.asks, data.noDepthUsd.bids);

  // Graceful degradation: if the YES book is missing the orderbook fetch
  // failed and nothing useful can be rendered beyond a muted line.
  if (!data.yesBook) {
    return (
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <header className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('wiMarket.liquidityCardTitle')}
          </h2>
        </header>
        <div className="px-4 sm:px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
          {t('wiMarket.liquidityUnavailable')}
        </div>
      </section>
    );
  }

  const yesBook = data.yesBook;
  const bestBid = yesBook.bestBid;
  const bestAsk = yesBook.bestAsk;
  const spread =
    bestBid != null && bestAsk != null && Number.isFinite(bestBid) && Number.isFinite(bestAsk)
      ? bestAsk - bestBid
      : null;
  const midpoint =
    bestBid != null && bestAsk != null && Number.isFinite(bestBid) && Number.isFinite(bestAsk)
      ? (bestAsk + bestBid) / 2
      : null;

  // Δ in percentage points between post-trade top of book and the pre-trade
  // midpoint (matches the spec's "Δ X pp" copy).
  const deltaPp =
    midpoint != null &&
    result &&
    Number.isFinite(result.postPrice) &&
    Number.isFinite(midpoint)
      ? (result.postPrice - midpoint) * 100
      : null;

  const requestedUsd = Number(sizeKey);
  const filledPct =
    result && Number.isFinite(result.filledUsd) && requestedUsd > 0
      ? Math.min(100, (result.filledUsd / requestedUsd) * 100)
      : 0;

  // Ratio used in the "why thick" reason 1. Prefers the heavier side (YES
  // is usually the speculative side, but fall back to NO if YES is empty).
  const dominantRatio =
    Number.isFinite(yesRatio) && yesRatio > 0 ? yesRatio : noRatio;

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Section 1: header + stats */}
      <header className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('wiMarket.liquidityCardTitle')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('wiMarket.liquiditySubtitle')}
            </p>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('wiMarket.liquidityUpdated')}{' '}
            <RelativeTime iso={data.fetchedAt} />
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label={t('wiMarket.bestBid')} value={formatPrice(bestBid)} />
          <Stat label={t('wiMarket.bestAsk')} value={formatPrice(bestAsk)} />
          <Stat label={t('wiMarket.spread')} value={spread != null ? formatPrice(spread, 4) : '—'} />
          <Stat label={t('wiMarket.midpoint')} value={formatPrice(midpoint)} />
        </div>
      </header>

      {/* Section 2: depth bars */}
      <div className="px-4 sm:px-5 py-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('wiMarket.depthHeader')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <DepthBar
            label={t('wiMarket.depthYesAsks')}
            amountUsd={data.yesDepthUsd.asks}
            maxUsd={maxDepthUsd}
            colorClass="bg-emerald-500"
            warning={
              Number.isFinite(yesRatio) && yesRatio > ASYMMETRY_THRESHOLD
                ? t('wiMarket.depthAsymmetric')
                : !Number.isFinite(yesRatio) && data.yesDepthUsd.asks > 0
                  ? t('wiMarket.depthAsymmetric')
                  : null
            }
          />
          <DepthBar
            label={t('wiMarket.depthYesBids')}
            amountUsd={data.yesDepthUsd.bids}
            maxUsd={maxDepthUsd}
            colorClass="bg-red-500"
            warning={
              Number.isFinite(yesRatio) && yesRatio > ASYMMETRY_THRESHOLD
                ? t('wiMarket.depthAsymmetric')
                : null
            }
          />
          <DepthBar
            label={t('wiMarket.depthNoAsks')}
            amountUsd={data.noDepthUsd.asks}
            maxUsd={maxDepthUsd}
            colorClass="bg-emerald-500"
            warning={
              Number.isFinite(noRatio) && noRatio > ASYMMETRY_THRESHOLD
                ? t('wiMarket.depthAsymmetric')
                : !Number.isFinite(noRatio) && data.noDepthUsd.asks > 0
                  ? t('wiMarket.depthAsymmetric')
                  : null
            }
          />
          <DepthBar
            label={t('wiMarket.depthNoBids')}
            amountUsd={data.noDepthUsd.bids}
            maxUsd={maxDepthUsd}
            colorClass="bg-red-500"
            warning={
              Number.isFinite(noRatio) && noRatio > ASYMMETRY_THRESHOLD
                ? t('wiMarket.depthAsymmetric')
                : null
            }
          />
        </div>
      </div>

      {/* Section 3: interactive impact slider */}
      <div className="px-4 sm:px-5 py-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t('wiMarket.impactHeader')}
          </h3>
          <div
            role="group"
            aria-label={t('wiMarket.impactHeader')}
            className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-0.5"
          >
            <button
              type="button"
              onClick={() => setSide('yes')}
              aria-pressed={side === 'yes'}
              className={
                'px-2.5 py-1 text-xs font-medium rounded transition-colors ' +
                (side === 'yes'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200')
              }
            >
              {t('wiMarket.impactBuyYes')}
            </button>
            <button
              type="button"
              onClick={() => setSide('no')}
              aria-pressed={side === 'no'}
              className={
                'px-2.5 py-1 text-xs font-medium rounded transition-colors ' +
                (side === 'no'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200')
              }
            >
              {t('wiMarket.impactBuyNo')}
            </button>
          </div>
        </div>

        <div
          role="group"
          aria-label="Order size"
          className="inline-flex w-full sm:w-auto items-center rounded-md border border-slate-200 dark:border-slate-800 overflow-hidden"
        >
          {SIZES.map((s, i) => {
            const active = sizeKey === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSizeKey(s.key)}
                aria-pressed={active}
                data-size={s.key}
                className={
                  'flex-1 sm:flex-none px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors ' +
                  (i > 0 ? 'border-l border-slate-200 dark:border-slate-800 ' : '') +
                  (active
                    ? 'bg-primary text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800')
                }
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Result block */}
        {result == null ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('wiMarket.impactEmptySide')}
          </p>
        ) : !Number.isFinite(result.postPrice) ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('wiMarket.impactEmptySide')}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t('wiMarket.impactVwap')}
                </div>
                <div
                  className="text-base font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100"
                  data-testid="impact-vwap"
                >
                  {Number.isFinite(result.fillVwap) ? formatPrice(result.fillVwap, 3) : '—'}
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t('wiMarket.impactPostPrice')}
                </div>
                <div className="text-base font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  <span data-testid="impact-post-price">{formatPrice(result.postPrice, 3)}</span>
                  {midpoint != null && (
                    <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                      ({t('wiMarket.impactWasPrice')} {formatPrice(midpoint, 3)}
                      {deltaPp != null && (
                        <>
                          {' · '}
                          {t('wiMarket.impactDelta')} {deltaPp >= 0 ? '+' : ''}
                          {deltaPp.toFixed(1)} {t('wiMarket.impactDeltaPp')}
                        </>
                      )}
                      )
                    </span>
                  )}
                </div>
              </div>
            </div>

            {result.thinBook && (
              <>
                <div className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                  {t('wiMarket.impactFilled')}:{' '}
                  <span className="font-semibold">
                    {formatUsdCompact(result.filledUsd)} / {formatUsdCompact(requestedUsd)}
                  </span>{' '}
                  <span className="text-slate-500">({filledPct.toFixed(0)}%)</span>{' '}
                  {t('wiMarket.impactRequested')}
                </div>
                <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  {t('wiMarket.impactThinBook')}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Section 4: why-thick expandable */}
      <div className="px-4 sm:px-5 py-3">
        <button
          type="button"
          onClick={() => setWhyOpen((v) => !v)}
          aria-expanded={whyOpen}
          aria-label={whyOpen ? t('wiMarket.whyThickCollapse') : t('wiMarket.whyThickExpand')}
          className="w-full flex items-center justify-between gap-2 text-left text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-slate-50"
        >
          <span>{t('wiMarket.whyThickHeader')}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={'transition-transform ' + (whyOpen ? 'rotate-180' : '')}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {whyOpen && (
          <ol className="mt-3 space-y-3 list-decimal list-inside text-xs text-slate-600 dark:text-slate-300">
            <li>
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {t('wiMarket.thickReason1Title')}
              </span>
              <span className="ml-1">
                {applyPlaceholders(t('wiMarket.thickReason1Body'), {
                  ratio: formatRatio(dominantRatio),
                })}
              </span>
            </li>
            <li>
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {t('wiMarket.thickReason2Title')}
              </span>
              <span className="ml-1">{t('wiMarket.thickReason2Body')}</span>
            </li>
            <li>
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {t('wiMarket.thickReason3Title')}
              </span>
              <span className="ml-1">{t('wiMarket.thickReason3Body')}</span>
            </li>
          </ol>
        )}
      </div>
    </section>
  );
}
