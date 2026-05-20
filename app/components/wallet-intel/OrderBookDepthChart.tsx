'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n/context';

interface Level {
  price: number;
  size: number;
}

interface NormalizedBook {
  bestBid: number | null;
  bestAsk: number | null;
  bids?: Level[]; // sorted DESC by price (best first)
  asks?: Level[]; // sorted ASC by price (best first)
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
  tickUsd: number;
  cumUsd: number; // cumulative walking outward from mid
  sharePct: number;
}

/**
 * Build cumulative tick usd for one side. Levels come in best-first order
 * (asks ASC, bids DESC). cumUsd grows as we walk outward from best toward
 * worst — which is the "cost to push price to this level" the analyst
 * wants to see.
 */
function enrichSide(levels: Level[]): { totalUsd: number; levels: EnrichedLevel[] } {
  let cum = 0;
  const arr = levels.map((l) => {
    const tickUsd = l.price * l.size;
    cum += tickUsd;
    return { ...l, tickUsd, cumUsd: cum, sharePct: 0 };
  });
  if (cum > 0) arr.forEach((lv) => (lv.sharePct = lv.tickUsd / cum));
  return { totalUsd: cum, levels: arr };
}

// ─── Formatting ────────────────────────────────────────────────────

const formatPrice = (p: number): string => p.toFixed(3);

const formatPct = (p: number): string => `${(p * 100).toFixed(2)}%`;

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}k`;
  return `$${n.toFixed(2)}`;
}

function formatShares(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

// ─── Chart ─────────────────────────────────────────────────────────

interface ChartViewBox {
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
}

const VIEW: ChartViewBox = {
  width: 720,
  height: 280,
  paddingLeft: 50,
  paddingRight: 20,
  paddingTop: 16,
  paddingBottom: 36,
};

function plotW(v: ChartViewBox = VIEW): number {
  return v.width - v.paddingLeft - v.paddingRight;
}
function plotH(v: ChartViewBox = VIEW): number {
  return v.height - v.paddingTop - v.paddingBottom;
}

/**
 * Convert price ∈ [0, 1] to chart x coordinate.
 */
function xOf(price: number): number {
  return VIEW.paddingLeft + price * plotW();
}

/**
 * Convert USD value to chart y coordinate. yMax is the max cumulative on
 * either side — shared so both curves use the same vertical scale.
 */
function yOf(usd: number, yMax: number): number {
  const h = plotH();
  if (yMax <= 0) return VIEW.paddingTop + h;
  const clamped = Math.max(0, Math.min(usd, yMax));
  return VIEW.paddingTop + h - (clamped / yMax) * h;
}

interface HoverState {
  // Hover is on the CHART of a specific outcome (yes or no), at a particular
  // x-pixel position. Captured price + the closest tick on each side.
  outcome: 'yes' | 'no';
  hoverPrice: number; // ∈ [0, 1]
  // Closest ask level at price >= hoverPrice (the level you'd cross if
  // walking up from mid). null when hoverPrice is below mid (you're not
  // in ask territory) OR no ask level exists at/above hoverPrice.
  ask: EnrichedLevel | null;
  // Closest bid level at price <= hoverPrice. null analogously.
  bid: EnrichedLevel | null;
  // Floating popup position — pixel coords RELATIVE to the chart container.
  popupX: number;
  popupY: number;
  /** True when the hover is to the RIGHT of the midpoint (in ask territory) */
  isAbove: boolean;
}

interface OutcomeChartProps {
  outcome: 'yes' | 'no';
  title: string;
  book: NormalizedBook | null;
  hover: HoverState | null;
  onHover: (h: HoverState | null) => void;
  /** USD scale shared across both charts so visual asymmetry is honest. */
  sharedYMax: number;
  labels: {
    midpoint: string;
    bestBid: string;
    bestAsk: string;
    spread: string;
    totalDepth: string;
    emptyBook: string;
    hoverHint: string;
    askLegend: string;
    bidLegend: string;
    midLegend: string;
    priceAxis: string;
    cumAxis: string;
    /** Inline arrow label rendered to the LEFT of midpoint on chart */
    leftLabel: string;
    /** Inline arrow label rendered to the RIGHT of midpoint on chart */
    rightLabel: string;
    /** Floating popup copy — taught for non-quant audiences */
    popupYesPrice: string;
    popupNoEquivPrefix: string;
    popupActionUp: string;
    popupActionDown: string;
    popupBuyYes: string;
    popupSellYes: string;
    popupBuyNo: string;
    popupSellNo: string;
    popupEquivalentSep: string;
    popupNoLiquidity: string;
    popupTickDepth: string;
  };
}

function OutcomeChart({
  outcome,
  title,
  book,
  hover,
  onHover,
  sharedYMax,
  labels,
}: OutcomeChartProps) {
  const enrichedAsks = useMemo(
    () => (book?.asks ? enrichSide(book.asks) : { totalUsd: 0, levels: [] as EnrichedLevel[] }),
    [book],
  );
  const enrichedBids = useMemo(
    () => (book?.bids ? enrichSide(book.bids) : { totalUsd: 0, levels: [] as EnrichedLevel[] }),
    [book],
  );

  const bestAsk = book?.bestAsk ?? null;
  const bestBid = book?.bestBid ?? null;
  const mid = bestAsk != null && bestBid != null ? (bestAsk + bestBid) / 2 : null;
  const spread = bestAsk != null && bestBid != null ? bestAsk - bestBid : null;

  // Build step-function paths for cumulative curves. Each path starts at
  // the best price on this side at y=0 (no cost) and rises outward to the
  // worst level's cumulative.
  const askPath = useMemo(() => {
    if (enrichedAsks.levels.length === 0 || bestAsk == null) return '';
    let d = `M ${xOf(bestAsk)} ${yOf(0, sharedYMax)}`;
    for (const lv of enrichedAsks.levels) {
      // Step up vertically at this level's price, then horizontal to the
      // next level's price. Mirrors the orderbook's actual stair-step shape.
      d += ` L ${xOf(lv.price)} ${yOf(lv.cumUsd, sharedYMax)}`;
    }
    return d;
  }, [enrichedAsks, bestAsk, sharedYMax]);

  const bidPath = useMemo(() => {
    if (enrichedBids.levels.length === 0 || bestBid == null) return '';
    let d = `M ${xOf(bestBid)} ${yOf(0, sharedYMax)}`;
    for (const lv of enrichedBids.levels) {
      d += ` L ${xOf(lv.price)} ${yOf(lv.cumUsd, sharedYMax)}`;
    }
    return d;
  }, [enrichedBids, bestBid, sharedYMax]);

  // Filled-area paths — close back down to the X-axis baseline so the
  // curve looks like a translucent fill instead of a thin line. Visual
  // weight where the analyst eye should land.
  const askArea = useMemo(() => {
    if (!askPath || bestAsk == null) return '';
    const lastPrice = enrichedAsks.levels[enrichedAsks.levels.length - 1]?.price ?? bestAsk;
    return askPath + ` L ${xOf(lastPrice)} ${yOf(0, sharedYMax)} L ${xOf(bestAsk)} ${yOf(0, sharedYMax)} Z`;
  }, [askPath, bestAsk, enrichedAsks, sharedYMax]);

  const bidArea = useMemo(() => {
    if (!bidPath || bestBid == null) return '';
    const lastPrice = enrichedBids.levels[enrichedBids.levels.length - 1]?.price ?? bestBid;
    return bidPath + ` L ${xOf(lastPrice)} ${yOf(0, sharedYMax)} L ${xOf(bestBid)} ${yOf(0, sharedYMax)} Z`;
  }, [bidPath, bestBid, enrichedBids, sharedYMax]);

  // Bars for per-tick visual texture beneath the cumulative curves.
  // Heights are LOG-scaled so a $10M wall and a $10 tick are both visible.
  const maxTickUsd = useMemo(() => {
    let m = 0;
    for (const lv of enrichedAsks.levels) m = Math.max(m, lv.tickUsd);
    for (const lv of enrichedBids.levels) m = Math.max(m, lv.tickUsd);
    return m;
  }, [enrichedAsks, enrichedBids]);

  function barHeight(tickUsd: number): number {
    if (tickUsd <= 0 || maxTickUsd <= 0) return 0;
    const logScale = Math.log10(tickUsd + 1) / Math.log10(maxTickUsd + 1);
    return Math.max(2, logScale * 36); // 2-36 px tall
  }

  // ── Mouse interaction ──
  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    // Convert client pixel x → SVG x (viewBox space)
    const svgX = ((e.clientX - rect.left) / rect.width) * VIEW.width;
    // Inverse of xOf(price): price = (svgX - paddingLeft) / plotW
    const rawPrice = (svgX - VIEW.paddingLeft) / plotW();
    const price = Math.max(0, Math.min(1, rawPrice));
    // Find closest ask level at price >= hoverPrice
    const ask = enrichedAsks.levels.find((l) => l.price >= price) ?? null;
    // Find closest bid level at price <= hoverPrice
    let bid: EnrichedLevel | null = null;
    for (const l of enrichedBids.levels) {
      if (l.price <= price) {
        bid = l;
        break;
      }
    }
    // Popup positioning: capture cursor in CONTAINER-relative px so we can
    // absolute-position the popup next to it. Bias popup direction based on
    // which half of the chart we're in so it doesn't fall off the edge.
    const containerEl = svg.parentElement;
    const containerRect = containerEl?.getBoundingClientRect() ?? rect;
    const popupX = e.clientX - containerRect.left;
    const popupY = e.clientY - containerRect.top;
    const isAbove = mid != null ? price >= mid : price >= 0.5;
    onHover({ outcome, hoverPrice: price, ask, bid, popupX, popupY, isAbove });
  }
  function handlePointerLeave() {
    onHover(null);
  }

  const myHover = hover && hover.outcome === outcome ? hover : null;
  const crosshairX = myHover ? xOf(myHover.hoverPrice) : null;

  // Y-axis ticks: 5 evenly-spaced labels.
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 4; i++) ticks.push((sharedYMax / 4) * i);
    return ticks;
  }, [sharedYMax]);

  // X-axis ticks: 5 evenly-spaced price labels 0, 0.25, 0.5, 0.75, 1.0
  const xTicks = [0, 0.25, 0.5, 0.75, 1.0];

  if (!book || (enrichedAsks.levels.length === 0 && enrichedBids.levels.length === 0)) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">{title}</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">{labels.emptyBook}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-baseline justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
        <div className="flex items-baseline gap-3 text-[11px] font-mono tabular-nums">
          <span>
            {/* bestBid is the floor for "selling YES" → pushes price DOWN → RED */}
            <span className="text-slate-500">{labels.bestBid}: </span>
            <span className="text-red-700 dark:text-red-400">
              {bestBid != null ? formatPrice(bestBid) : '—'}
            </span>
          </span>
          <span>
            {/* bestAsk is the ceiling for "buying YES" → pushes price UP → GREEN */}
            <span className="text-slate-500">{labels.bestAsk}: </span>
            <span className="text-emerald-700 dark:text-emerald-400">
              {bestAsk != null ? formatPrice(bestAsk) : '—'}
            </span>
          </span>
          <span>
            <span className="text-slate-500">{labels.midpoint}: </span>
            <span className="text-slate-700 dark:text-slate-300">
              {mid != null ? formatPrice(mid) : '—'}
            </span>
          </span>
          <span>
            <span className="text-slate-500">{labels.spread}: </span>
            <span className="text-slate-700 dark:text-slate-300">
              {spread != null ? formatPrice(spread) : '—'}
            </span>
          </span>
        </div>
      </header>

      {/* Legend strip — Color rationale: GREEN = action that PUSHES YES UP,
          RED = action that PUSHES YES DOWN. This is the trader mental
          model (green = bullish move, red = bearish move). */}
      <div className="px-4 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex items-center gap-3 flex-wrap text-[10px]">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm bg-emerald-300 dark:bg-emerald-700/60" />
          <span className="text-slate-600 dark:text-slate-400">{labels.askLegend}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm bg-red-300 dark:bg-red-700/60" />
          <span className="text-slate-600 dark:text-slate-400">{labels.bidLegend}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-2 border-l-2 border-dashed border-slate-400" />
          <span className="text-slate-600 dark:text-slate-400">{labels.midLegend}</span>
        </span>
        <span className="ml-auto text-slate-500 dark:text-slate-500 font-mono tabular-nums">
          {labels.totalDepth}{' '}
          <span className="text-red-700 dark:text-red-400">
            {formatUsd(enrichedBids.totalUsd)} bid
          </span>{' '}
          /{' '}
          <span className="text-emerald-700 dark:text-emerald-400">
            {formatUsd(enrichedAsks.totalUsd)} ask
          </span>
        </span>
      </div>

      {/* SVG chart — `relative` so the floating popup positions against this container */}
      <div className="relative bg-slate-50 dark:bg-slate-950/30">
        {/* Floating popup on hover — positions next to the cursor with a bias
            so it never spills off the chart edge. Plain-language summary of
            what would happen if you traded YES (or equivalently NO) at this
            price level. */}
        {myHover && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg px-3 py-2.5 text-[11px] max-w-[280px]"
            style={{
              // Bias: place popup to LEFT of cursor when hover is on right half,
              // RIGHT of cursor when on left half. Vertical: offset 12px up.
              left: myHover.isAbove ? Math.max(8, myHover.popupX - 290) : Math.min(myHover.popupX + 14, VIEW.width - 290),
              top: Math.max(8, myHover.popupY - 110),
            }}
          >
            <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1 font-mono tabular-nums flex items-baseline gap-2">
              <span className="text-primary text-sm">{formatPct(myHover.hoverPrice)}</span>
              <span className="text-[10px] text-slate-500">{labels.popupYesPrice}</span>
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-2 font-mono tabular-nums">
              {labels.popupNoEquivPrefix}{' '}
              <span className="text-slate-700 dark:text-slate-300 font-semibold">
                {formatPct(1 - myHover.hoverPrice)}
              </span>
            </div>

            {/* Plain-language action box — isAbove (pushing YES UP) is GREEN,
                !isAbove (pushing YES DOWN) is RED. Matches every other color
                surface in the chart. */}
            <div
              className={`rounded-md px-2 py-1.5 mb-2 ${
                myHover.isAbove
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900'
                  : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900'
              }`}
            >
              <div
                className={`text-[10px] uppercase tracking-wider font-bold mb-1 ${
                  myHover.isAbove
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {myHover.isAbove ? labels.popupActionUp : labels.popupActionDown}
              </div>
              <div className="space-y-0.5 leading-snug">
                {myHover.isAbove && myHover.ask && (
                  <>
                    <div className="text-slate-700 dark:text-slate-300">
                      • {labels.popupBuyYes}{' '}
                      <span className="font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                        {formatUsd(myHover.ask.cumUsd)}
                      </span>
                    </div>
                    <div className="text-slate-500 dark:text-slate-500 text-[10px] pl-2 italic">
                      {labels.popupEquivalentSep}
                    </div>
                    <div className="text-slate-700 dark:text-slate-300">
                      • {labels.popupSellNo}{' '}
                      <span className="font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                        {formatUsd(myHover.ask.cumUsd)}
                      </span>
                    </div>
                  </>
                )}
                {!myHover.isAbove && myHover.bid && (
                  <>
                    <div className="text-slate-700 dark:text-slate-300">
                      • {labels.popupSellYes}{' '}
                      <span className="font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                        {formatUsd(myHover.bid.cumUsd)}
                      </span>
                    </div>
                    <div className="text-slate-500 dark:text-slate-500 text-[10px] pl-2 italic">
                      {labels.popupEquivalentSep}
                    </div>
                    <div className="text-slate-700 dark:text-slate-300">
                      • {labels.popupBuyNo}{' '}
                      <span className="font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                        {formatUsd(myHover.bid.cumUsd)}
                      </span>
                    </div>
                  </>
                )}
                {((myHover.isAbove && !myHover.ask) || (!myHover.isAbove && !myHover.bid)) && (
                  <div className="text-slate-500 italic">{labels.popupNoLiquidity}</div>
                )}
              </div>
            </div>

            {/* Tick depth at exactly this level */}
            <div className="text-[10px] text-slate-500 dark:text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-1.5">
              <div>
                <span>{labels.popupTickDepth}: </span>
                <span className="font-semibold text-slate-700 dark:text-slate-300 font-mono tabular-nums">
                  {myHover.isAbove
                    ? myHover.ask
                      ? formatUsd(myHover.ask.tickUsd)
                      : '—'
                    : myHover.bid
                      ? formatUsd(myHover.bid.tickUsd)
                      : '—'}
                </span>
              </div>
            </div>
          </div>
        )}
        <svg
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          preserveAspectRatio="none"
          className="w-full h-[280px] block touch-none"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          role="img"
          aria-label={title}
        >
          {/* Grid lines (horizontal) */}
          {yTicks.map((v, i) => (
            <line
              key={`y-${i}`}
              x1={VIEW.paddingLeft}
              x2={VIEW.width - VIEW.paddingRight}
              y1={yOf(v, sharedYMax)}
              y2={yOf(v, sharedYMax)}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeDasharray="2,3"
            />
          ))}

          {/* Per-tick mini bars (log-scaled height, anchored to x-axis baseline).
              Color rationale: GREEN on the ask side (pushing YES UP); RED on
              the bid side (pushing YES DOWN). */}
          {enrichedBids.levels.map((lv, i) => {
            const h = barHeight(lv.tickUsd);
            return (
              <rect
                key={`bbar-${i}`}
                x={xOf(lv.price) - 1}
                y={yOf(0, sharedYMax) - h}
                width={2}
                height={h}
                className="fill-red-400 dark:fill-red-500"
                fillOpacity={0.5}
              />
            );
          })}
          {enrichedAsks.levels.map((lv, i) => {
            const h = barHeight(lv.tickUsd);
            return (
              <rect
                key={`abar-${i}`}
                x={xOf(lv.price) - 1}
                y={yOf(0, sharedYMax) - h}
                width={2}
                height={h}
                className="fill-emerald-400 dark:fill-emerald-500"
                fillOpacity={0.5}
              />
            );
          })}

          {/* Cumulative area fills — ask side green (push UP), bid side red (push DOWN) */}
          {askArea && (
            <path d={askArea} className="fill-emerald-300 dark:fill-emerald-900" fillOpacity={0.25} />
          )}
          {bidArea && (
            <path d={bidArea} className="fill-red-300 dark:fill-red-900" fillOpacity={0.25} />
          )}

          {/* Cumulative step lines on top */}
          {askPath && (
            <path
              d={askPath}
              fill="none"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              strokeWidth={1.5}
            />
          )}
          {bidPath && (
            <path
              d={bidPath}
              fill="none"
              className="stroke-red-600 dark:stroke-red-400"
              strokeWidth={1.5}
            />
          )}

          {/* Midpoint vertical line */}
          {mid != null && (
            <>
              <line
                x1={xOf(mid)}
                x2={xOf(mid)}
                y1={VIEW.paddingTop}
                y2={VIEW.height - VIEW.paddingBottom}
                stroke="currentColor"
                strokeOpacity={0.5}
                strokeDasharray="3,3"
              />
              <text
                x={xOf(mid)}
                y={VIEW.paddingTop - 4}
                textAnchor="middle"
                className="fill-slate-700 dark:fill-slate-300"
                fontSize={10}
                fontWeight="bold"
                fontFamily="ui-monospace, monospace"
              >
                ↕ preço atual: {formatPct(mid)}
              </text>

              {/* Directional inline labels — left side (pushing YES DOWN) RED,
                  right side (pushing YES UP) GREEN. Matches the cumulative
                  curve + bar color semantics. */}
              <text
                x={xOf(mid) - 8}
                y={VIEW.paddingTop + 14}
                textAnchor="end"
                className="fill-red-700 dark:fill-red-400"
                fontSize={10}
                fontWeight="600"
              >
                {labels.leftLabel} ←
              </text>
              <text
                x={xOf(mid) + 8}
                y={VIEW.paddingTop + 14}
                textAnchor="start"
                className="fill-emerald-700 dark:fill-emerald-400"
                fontSize={10}
                fontWeight="600"
              >
                → {labels.rightLabel}
              </text>
            </>
          )}

          {/* Y axis labels */}
          {yTicks.map((v, i) => (
            <text
              key={`yl-${i}`}
              x={VIEW.paddingLeft - 6}
              y={yOf(v, sharedYMax) + 3}
              textAnchor="end"
              className="fill-slate-500 dark:fill-slate-500"
              fontSize={9}
              fontFamily="ui-monospace, monospace"
            >
              {v === 0 ? '0' : formatUsd(v)}
            </text>
          ))}

          {/* X axis labels */}
          {xTicks.map((p) => (
            <text
              key={`xl-${p}`}
              x={xOf(p)}
              y={VIEW.height - VIEW.paddingBottom + 14}
              textAnchor="middle"
              className="fill-slate-500 dark:fill-slate-500"
              fontSize={9}
              fontFamily="ui-monospace, monospace"
            >
              {formatPct(p)}
            </text>
          ))}

          {/* X axis line */}
          <line
            x1={VIEW.paddingLeft}
            x2={VIEW.width - VIEW.paddingRight}
            y1={yOf(0, sharedYMax)}
            y2={yOf(0, sharedYMax)}
            stroke="currentColor"
            strokeOpacity={0.2}
          />
          {/* Axis titles */}
          <text
            x={(VIEW.paddingLeft + (VIEW.width - VIEW.paddingRight)) / 2}
            y={VIEW.height - 4}
            textAnchor="middle"
            className="fill-slate-500 dark:fill-slate-500"
            fontSize={9}
          >
            {labels.priceAxis}
          </text>
          <text
            x={10}
            y={VIEW.paddingTop + plotH() / 2}
            textAnchor="middle"
            transform={`rotate(-90 10 ${VIEW.paddingTop + plotH() / 2})`}
            className="fill-slate-500 dark:fill-slate-500"
            fontSize={9}
          >
            {labels.cumAxis}
          </text>

          {/* Crosshair */}
          {crosshairX != null && (
            <line
              x1={crosshairX}
              x2={crosshairX}
              y1={VIEW.paddingTop}
              y2={VIEW.height - VIEW.paddingBottom}
              stroke="currentColor"
              strokeOpacity={0.45}
              strokeWidth={1}
            />
          )}
        </svg>
      </div>

      {/* Idle hint below chart — popup takes over on hover */}
      <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-[10px] text-slate-500 dark:text-slate-500">
        {labels.hoverHint}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────

export function OrderBookDepthChart({ yesBook, noBook, marketQuestion }: Props) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<HoverState | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Shared Y-scale: max cumulative across BOTH charts so the asymmetry
  // between YES and NO books is honest (NO bids of $12M tower over YES
  // bids of $3k — the visual should show that).
  const sharedYMax = useMemo(() => {
    let m = 0;
    if (yesBook?.bids) for (const lv of yesBook.bids) m += lv.price * lv.size;
    let yesAsks = 0;
    if (yesBook?.asks) for (const lv of yesBook.asks) yesAsks += lv.price * lv.size;
    let noBids = 0;
    if (noBook?.bids) for (const lv of noBook.bids) noBids += lv.price * lv.size;
    let noAsks = 0;
    if (noBook?.asks) for (const lv of noBook.asks) noAsks += lv.price * lv.size;
    return Math.max(m, yesAsks, noBids, noAsks, 1);
  }, [yesBook, noBook]);

  const labels = {
    midpoint: t('wiMarket.midpoint'),
    bestBid: t('wiMarket.bestBid'),
    bestAsk: t('wiMarket.bestAsk'),
    spread: t('wiMarket.spread'),
    totalDepth: t('wiMarket.obTotalDepth'),
    emptyBook: t('wiMarket.obEmpty'),
    hoverHint: t('wiMarket.obHoverHint'),
    askLegend: t('wiMarket.obAskLegend'),
    bidLegend: t('wiMarket.obBidLegend'),
    midLegend: t('wiMarket.obMidLegend'),
    priceAxis: t('wiMarket.obPriceAxis'),
    cumAxis: t('wiMarket.obCumAxis'),
    leftLabel: t('wiMarket.obLeftLabel'),
    rightLabel: t('wiMarket.obRightLabel'),
    popupYesPrice: t('wiMarket.obPopupYesPrice'),
    popupNoEquivPrefix: t('wiMarket.obPopupNoEquivPrefix'),
    popupActionUp: t('wiMarket.obPopupActionUp'),
    popupActionDown: t('wiMarket.obPopupActionDown'),
    popupBuyYes: t('wiMarket.obPopupBuyYes'),
    popupSellYes: t('wiMarket.obPopupSellYes'),
    popupBuyNo: t('wiMarket.obPopupBuyNo'),
    popupSellNo: t('wiMarket.obPopupSellNo'),
    popupEquivalentSep: t('wiMarket.obPopupEquivSep'),
    popupNoLiquidity: t('wiMarket.obPopupNoLiquidity'),
    popupTickDepth: t('wiMarket.obPopupTickDepth'),
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
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t('wiMarket.obSectionSubtitle')}
        </p>
        {marketQuestion && (
          <p className="text-xs text-slate-500 dark:text-slate-500 italic">{marketQuestion}</p>
        )}
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <OutcomeChart
          outcome="yes"
          title={t('wiMarket.obYesBook')}
          book={yesBook}
          hover={hover}
          onHover={setHover}
          sharedYMax={sharedYMax}
          labels={labels}
        />
        <OutcomeChart
          outcome="no"
          title={t('wiMarket.obNoBook')}
          book={noBook}
          hover={hover}
          onHover={setHover}
          sharedYMax={sharedYMax}
          labels={labels}
        />
      </div>

      {/* Optional: expand detailed ladder tables underneath for power users */}
      <details
        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        open={showDetails}
      >
        <summary
          className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 select-none"
          onClick={(e) => {
            e.preventDefault();
            setShowDetails((s) => !s);
          }}
        >
          {showDetails ? t('wiMarket.obHideTables') : t('wiMarket.obShowTables')}
        </summary>
        {showDetails && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 border-t border-slate-200 dark:border-slate-800">
            <TickLadderCard title={t('wiMarket.obYesBook')} book={yesBook} t={t} />
            <TickLadderCard title={t('wiMarket.obNoBook')} book={noBook} t={t} />
          </div>
        )}
      </details>
    </section>
  );
}

// ─── Detail ladder (collapsible) ───────────────────────────────────

function TickLadderCard({
  title,
  book,
  t,
}: {
  title: string;
  book: NormalizedBook | null;
  t: (key: string) => string;
}) {
  const enrichedAsks = useMemo(
    () => (book?.asks ? enrichSide(book.asks) : { totalUsd: 0, levels: [] as EnrichedLevel[] }),
    [book],
  );
  const enrichedBids = useMemo(
    () => (book?.bids ? enrichSide(book.bids) : { totalUsd: 0, levels: [] as EnrichedLevel[] }),
    [book],
  );

  if (!book) {
    return (
      <div>
        <h4 className="text-sm font-semibold mb-2">{title}</h4>
        <p className="text-xs text-slate-500">{t('wiMarket.obEmpty')}</p>
      </div>
    );
  }

  const asksDisplay = [...enrichedAsks.levels].reverse();
  const bidsDisplay = enrichedBids.levels;

  return (
    <div className="text-[11px] font-mono tabular-nums">
      <h4 className="text-sm font-semibold mb-2 font-sans">{title}</h4>
      <div className="rounded border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Asks = pushing YES UP → GREEN. Bids = pushing YES DOWN → RED. */}
        <div className="px-3 py-1 bg-emerald-50/40 dark:bg-emerald-950/20 text-[10px] uppercase font-semibold text-emerald-700 dark:text-emerald-400">
          {t('wiMarket.obAsks')} ({asksDisplay.length})
        </div>
        <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-x-2 px-3 py-1 text-[10px] uppercase tracking-wider text-slate-400">
          <span className="font-sans">{t('wiMarket.obColPrice')}</span>
          <span className="text-right font-sans">{t('wiMarket.obColSize')}</span>
          <span className="text-right font-sans">{t('wiMarket.obColTick')}</span>
          <span className="text-right font-sans">{t('wiMarket.obColCum')}</span>
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {asksDisplay.map((lv) => (
            <div
              key={`a-${lv.price}`}
              className="grid grid-cols-[60px_1fr_1fr_1fr] gap-x-2 px-3 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800/40"
            >
              <span className="text-emerald-700 dark:text-emerald-400">{formatPrice(lv.price)}</span>
              <span className="text-right text-slate-700 dark:text-slate-300">
                {formatShares(lv.size)}
              </span>
              <span className="text-right text-slate-700 dark:text-slate-300">
                {formatUsd(lv.tickUsd)}
              </span>
              <span className="text-right text-slate-500">{formatUsd(lv.cumUsd)}</span>
            </div>
          ))}
        </div>
        <div className="px-3 py-1 bg-slate-100 dark:bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-500">
          spread {book.bestBid != null && book.bestAsk != null ? formatPrice(book.bestAsk - book.bestBid) : '—'}
        </div>
        <div className="px-3 py-1 bg-red-50/40 dark:bg-red-950/20 text-[10px] uppercase font-semibold text-red-700 dark:text-red-400">
          {t('wiMarket.obBids')} ({bidsDisplay.length})
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {bidsDisplay.map((lv) => (
            <div
              key={`b-${lv.price}`}
              className="grid grid-cols-[60px_1fr_1fr_1fr] gap-x-2 px-3 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800/40"
            >
              <span className="text-red-700 dark:text-red-400">{formatPrice(lv.price)}</span>
              <span className="text-right text-slate-700 dark:text-slate-300">
                {formatShares(lv.size)}
              </span>
              <span className="text-right text-slate-700 dark:text-slate-300">
                {formatUsd(lv.tickUsd)}
              </span>
              <span className="text-right text-slate-500">{formatUsd(lv.cumUsd)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
