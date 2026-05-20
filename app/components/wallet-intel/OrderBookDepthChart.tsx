'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n/context';

interface Level {
  price: number;
  size: number;
}

// Mirrors NormalizedBookLite from LiquidityImpactCard — bids/asks are
// optional because the type predates this chart. We treat absent arrays
// as empty so the card renders an "empty book" state instead of crashing.
interface NormalizedBook {
  bestBid: number | null;
  bestAsk: number | null;
  bids?: Level[];
  asks?: Level[];
  tokenId?: string;
  fetchedAt?: Date | string;
  tickSize: number;
  minOrderSize: number;
}

interface Props {
  yesBook: NormalizedBook | null;
  noBook: NormalizedBook | null;
  marketQuestion?: string | null;
}

interface EnrichedLevel extends Level {
  /** USDC notional at this level alone: price × size */
  tickUsd: number;
  /** USDC cumulative from best price up to (and including) this level */
  cumUsd: number;
  /** This level's share of the side's total USD depth, ∈ [0, 1] */
  sharePct: number;
}

interface BookSideEnriched {
  /** Total USDC depth of this side */
  totalUsd: number;
  /** Per-level enrichment in best-first order (same order as input array) */
  levels: EnrichedLevel[];
}

function enrichSide(levels: Level[]): BookSideEnriched {
  let cum = 0;
  const tickArr = levels.map((l) => {
    const tickUsd = l.price * l.size;
    cum += tickUsd;
    return { ...l, tickUsd, cumUsd: cum, sharePct: 0 };
  });
  const totalUsd = cum;
  if (totalUsd > 0) {
    for (const lv of tickArr) lv.sharePct = lv.tickUsd / totalUsd;
  }
  return { totalUsd, levels: tickArr };
}

function formatPrice(p: number): string {
  // Polymarket tick size 0.001 → always show 3 decimals.
  return p.toFixed(3);
}

function formatShares(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}k`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(2)}`;
}

function formatPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

interface HoverPayload {
  bookKey: 'yes' | 'no';
  side: 'asks' | 'bids';
  level: EnrichedLevel;
}

interface BookCardProps {
  bookKey: 'yes' | 'no';
  title: string;
  book: NormalizedBook | null;
  hover: HoverPayload | null;
  onHover: (p: HoverPayload | null) => void;
  /** i18n strings — passed in to keep this presentational component free of namespacing */
  labels: {
    bestBid: string;
    bestAsk: string;
    spread: string;
    midpoint: string;
    asksHeader: string;
    bidsHeader: string;
    colPrice: string;
    colSize: string;
    colTick: string;
    colCum: string;
    emptyBook: string;
    hoverHint: string;
    detailPrice: string;
    detailCapitalTick: string;
    detailCapitalCum: string;
    detailShareOfDepth: string;
    spreadInline: string; // template "{spread} (mid {mid})"
    totalDepth: string;
  };
}

function BookCard({ bookKey, title, book, hover, onHover, labels }: BookCardProps) {
  // Enrich both sides up-front. useMemo to avoid recomputing on hover state change.
  const enrichedAsks = useMemo(
    () => (book ? enrichSide(book.asks ?? []) : { totalUsd: 0, levels: [] as EnrichedLevel[] }),
    [book],
  );
  const enrichedBids = useMemo(
    () => (book ? enrichSide(book.bids ?? []) : { totalUsd: 0, levels: [] as EnrichedLevel[] }),
    [book],
  );

  // Shared visual scale across both sides so the asymmetry between asks/bids
  // is honest. A side with $3 of depth next to a side with $11M renders a
  // visually-trivial bar — that IS the point.
  const maxTickUsd = useMemo(() => {
    const a = enrichedAsks.levels.reduce((m, l) => Math.max(m, l.tickUsd), 0);
    const b = enrichedBids.levels.reduce((m, l) => Math.max(m, l.tickUsd), 0);
    return Math.max(a, b, 1);
  }, [enrichedAsks, enrichedBids]);

  if (!book) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <header className="mb-2">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
        </header>
        <p className="text-xs text-slate-500 dark:text-slate-400">{labels.emptyBook}</p>
      </div>
    );
  }

  const mid =
    book.bestBid != null && book.bestAsk != null ? (book.bestBid + book.bestAsk) / 2 : null;
  const spread =
    book.bestBid != null && book.bestAsk != null ? book.bestAsk - book.bestBid : null;

  // Display asks in REVERSE (worst-at-top, best-adjacent-to-spread).
  // Display bids in NATURAL order (best-at-top, walking down to worst).
  const asksDisplay = [...enrichedAsks.levels].reverse();
  const bidsDisplay = enrichedBids.levels;

  // Show detail strip for the currently-hovered tick of THIS book.
  const myHover = hover && hover.bookKey === bookKey ? hover : null;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-500">
            {labels.totalDepth}{' '}
            <span className="text-emerald-700 dark:text-emerald-400">
              {formatUsd(enrichedAsks.totalUsd)} ask
            </span>
            {' / '}
            <span className="text-red-700 dark:text-red-400">{formatUsd(enrichedBids.totalUsd)} bid</span>
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
          <div>
            <span className="text-slate-500 dark:text-slate-500">{labels.bestBid}: </span>
            <span className="font-mono tabular-nums text-red-700 dark:text-red-400">
              {book.bestBid != null ? formatPrice(book.bestBid) : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-500">{labels.bestAsk}: </span>
            <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {book.bestAsk != null ? formatPrice(book.bestAsk) : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-500">{labels.midpoint}: </span>
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
              {mid != null ? formatPrice(mid) : '—'}
            </span>
          </div>
        </div>
      </header>

      {/* Detail strip — updates on hover. Reserved height so layout doesn't jump. */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-[11px] min-h-[44px]">
        {myHover ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 font-mono tabular-nums">
            <div>
              <span className="text-slate-500 dark:text-slate-500">{labels.detailPrice}: </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {formatPrice(myHover.level.price)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-500">{labels.detailCapitalTick}: </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {formatUsd(myHover.level.tickUsd)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-500">{labels.detailCapitalCum}: </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {formatUsd(myHover.level.cumUsd)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-500">{labels.detailShareOfDepth}: </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {formatPct(myHover.level.sharePct)}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-slate-400 dark:text-slate-600 leading-tight">{labels.hoverHint}</p>
        )}
      </div>

      {/* Asks (worst-at-top → best-adjacent-to-spread) */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-red-700 dark:text-red-400 bg-red-50/40 dark:bg-red-950/20">
          {labels.asksHeader} <span className="text-slate-500 dark:text-slate-500 font-mono normal-case tracking-normal">({asksDisplay.length})</span>
        </div>
        <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-x-2 px-4 py-1 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-sans">
          <span>{labels.colPrice}</span>
          <span className="text-right">{labels.colSize}</span>
          <span className="text-right">{labels.colTick}</span>
          <span className="text-right">{labels.colCum}</span>
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {asksDisplay.length === 0 ? (
            <p className="px-4 py-3 text-[11px] text-slate-500 dark:text-slate-400">{labels.emptyBook}</p>
          ) : (
            asksDisplay.map((lv) => (
              <BookRow
                key={`ask-${lv.price}`}
                lv={lv}
                maxTickUsd={maxTickUsd}
                side="asks"
                isHovered={
                  myHover != null && myHover.side === 'asks' && myHover.level.price === lv.price
                }
                onHover={(active) =>
                  onHover(active ? { bookKey, side: 'asks', level: lv } : null)
                }
              />
            ))
          )}
        </div>
      </div>

      {/* Spread strip */}
      <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/50 font-mono tabular-nums">
        {labels.spread}: {spread != null ? formatPrice(spread) : '—'}{' '}
        <span className="opacity-60">·</span> {labels.midpoint}: {mid != null ? formatPrice(mid) : '—'}
      </div>

      {/* Bids (best-at-top → worst-at-bottom) */}
      <div>
        <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20">
          {labels.bidsHeader} <span className="text-slate-500 dark:text-slate-500 font-mono normal-case tracking-normal">({bidsDisplay.length})</span>
        </div>
        <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-x-2 px-4 py-1 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-sans">
          <span>{labels.colPrice}</span>
          <span className="text-right">{labels.colSize}</span>
          <span className="text-right">{labels.colTick}</span>
          <span className="text-right">{labels.colCum}</span>
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {bidsDisplay.length === 0 ? (
            <p className="px-4 py-3 text-[11px] text-slate-500 dark:text-slate-400">{labels.emptyBook}</p>
          ) : (
            bidsDisplay.map((lv) => (
              <BookRow
                key={`bid-${lv.price}`}
                lv={lv}
                maxTickUsd={maxTickUsd}
                side="bids"
                isHovered={
                  myHover != null && myHover.side === 'bids' && myHover.level.price === lv.price
                }
                onHover={(active) =>
                  onHover(active ? { bookKey, side: 'bids', level: lv } : null)
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface BookRowProps {
  lv: EnrichedLevel;
  maxTickUsd: number;
  side: 'asks' | 'bids';
  isHovered: boolean;
  onHover: (active: boolean) => void;
}

function BookRow({ lv, maxTickUsd, side, isHovered, onHover }: BookRowProps) {
  // Width is a fraction of the GLOBAL max tick USD (across both sides) — when
  // one side has $11M of depth and the other has $3, the visual shows that
  // honestly: the small side renders as a barely-visible sliver.
  const widthPct = Math.max(0, Math.min(100, (lv.tickUsd / maxTickUsd) * 100));
  const barColor =
    side === 'asks'
      ? 'bg-red-200/60 dark:bg-red-900/30'
      : 'bg-emerald-200/60 dark:bg-emerald-900/30';
  const priceColor =
    side === 'asks'
      ? 'text-red-700 dark:text-red-400'
      : 'text-emerald-700 dark:text-emerald-400';
  const hoverBg = isHovered ? 'bg-slate-100 dark:bg-slate-800/60' : '';

  return (
    <div
      className={`relative grid grid-cols-[60px_1fr_1fr_1fr] gap-x-2 px-4 py-1 text-[11px] font-mono tabular-nums cursor-default ${hoverBg} hover:bg-slate-100 dark:hover:bg-slate-800/60`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      tabIndex={0}
    >
      {/* Background bar — fills from the side the action moves toward. Asks bar
          fills FROM left so that "deeper level" feels wider rightward. Same
          for bids — analyst reading left→right gets a consistent visual. */}
      <div
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 ${barColor}`}
        style={{ width: `${widthPct}%`, transition: 'width 120ms ease' }}
      />
      <span className={`relative ${priceColor} font-semibold`}>{formatPrice(lv.price)}</span>
      <span className="relative text-right text-slate-700 dark:text-slate-300">{formatShares(lv.size)}</span>
      <span className="relative text-right text-slate-700 dark:text-slate-300">{formatUsd(lv.tickUsd)}</span>
      <span className="relative text-right text-slate-500 dark:text-slate-500">{formatUsd(lv.cumUsd)}</span>
    </div>
  );
}

export function OrderBookDepthChart({ yesBook, noBook, marketQuestion }: Props) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<HoverPayload | null>(null);

  const labels = {
    bestBid: t('wiMarket.bestBid'),
    bestAsk: t('wiMarket.bestAsk'),
    spread: t('wiMarket.spread'),
    midpoint: t('wiMarket.midpoint'),
    asksHeader: t('wiMarket.obAsks'),
    bidsHeader: t('wiMarket.obBids'),
    colPrice: t('wiMarket.obColPrice'),
    colSize: t('wiMarket.obColSize'),
    colTick: t('wiMarket.obColTick'),
    colCum: t('wiMarket.obColCum'),
    emptyBook: t('wiMarket.obEmpty'),
    hoverHint: t('wiMarket.obHoverHint'),
    detailPrice: t('wiMarket.obDetailPrice'),
    detailCapitalTick: t('wiMarket.obDetailTick'),
    detailCapitalCum: t('wiMarket.obDetailCum'),
    detailShareOfDepth: t('wiMarket.obDetailShare'),
    spreadInline: t('wiMarket.spread'),
    totalDepth: t('wiMarket.obTotalDepth'),
  };

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-[10px] uppercase tracking-wider font-bold">
          {t('wiMarket.obTabBadge')}
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
          {t('wiMarket.obSectionTitle')}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('wiMarket.obSectionSubtitle')}</p>
        {marketQuestion && (
          <p className="text-xs text-slate-500 dark:text-slate-500 italic">{marketQuestion}</p>
        )}
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <BookCard
          bookKey="yes"
          title={t('wiMarket.obYesBook')}
          book={yesBook}
          hover={hover}
          onHover={setHover}
          labels={labels}
        />
        <BookCard
          bookKey="no"
          title={t('wiMarket.obNoBook')}
          book={noBook}
          hover={hover}
          onHover={setHover}
          labels={labels}
        />
      </div>
    </section>
  );
}
