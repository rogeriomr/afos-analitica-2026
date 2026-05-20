import Link from 'next/link';
import { getFlagPath } from '../../lib/polymarket/country-market-map';

interface Props {
  href?: string;
  flagIso3?: string;
  flagIso2?: string;
  countryName?: string;
  electionType?: string;
  marketSlug?: string;
  /** Right-side label, e.g. "5 flags". */
  trailing?: string;
}

export function MarketChip({
  href,
  flagIso3,
  flagIso2,
  countryName,
  electionType,
  marketSlug,
  trailing,
}: Props) {
  const flagSrc = flagIso3
    ? getFlagPath(flagIso3)
    : flagIso2
      ? `/flags/${flagIso2.toLowerCase()}.svg`
      : null;
  const title = electionType
    ? `${countryName ?? ''} — ${electionType}`
    : countryName ?? marketSlug ?? '';

  const inner = (
    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-primary hover:text-primary transition-colors text-xs">
      {flagSrc && (
        <img
          src={flagSrc}
          alt=""
          width={18}
          height={12}
          className="rounded-sm object-cover"
          style={{ width: 18, height: 12 }}
        />
      )}
      <span className="font-medium text-slate-800 dark:text-slate-200">{title || marketSlug}</span>
      {trailing && <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{trailing}</span>}
    </span>
  );

  return href ? (
    <Link href={href} className="inline-block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
