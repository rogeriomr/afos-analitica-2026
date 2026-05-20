'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/context';

interface Props {
  /** ISO 8601 string. Null/undefined → empty fallback label. */
  iso: string | null | undefined;
  fallback?: string;
  /** Append the absolute date/time as a title attribute for hover. */
  withAbsoluteTitle?: boolean;
  className?: string;
}

function format(t: (k: string, f?: string) => string, iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  const diff = Math.max(0, Date.now() - ts) / 1000;
  if (diff < 5) return t('wiTime.now');
  if (diff < 60) return t('wiTime.secondsAgo').replace('{n}', String(Math.floor(diff)));
  if (diff < 3600) return t('wiTime.minutesAgo').replace('{n}', String(Math.floor(diff / 60)));
  if (diff < 86400) return t('wiTime.hoursAgo').replace('{n}', String(Math.floor(diff / 3600)));
  if (diff < 7 * 86400) return t('wiTime.daysAgo').replace('{n}', String(Math.floor(diff / 86400)));
  if (diff < 30 * 86400) return t('wiTime.weeksAgo').replace('{n}', String(Math.floor(diff / (7 * 86400))));
  if (diff < 365 * 86400) return t('wiTime.monthsAgo').replace('{n}', String(Math.floor(diff / (30 * 86400))));
  return t('wiTime.yearsAgo').replace('{n}', String(Math.floor(diff / (365 * 86400))));
}

/**
 * Renders a "x minutes ago" label. SSR-safe: renders the ISO string on the
 * server pass (so HTML matches between server and client) then upgrades to a
 * relative label after hydration.
 */
export function RelativeTime({ iso, fallback = '—', withAbsoluteTitle = true, className }: Props) {
  const { t, locale } = useTranslation();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!iso) return <span className={className}>{fallback}</span>;

  const absLocale = locale === 'es' ? 'es-ES' : locale === 'en' ? 'en-US' : 'pt-BR';
  const absolute = (() => {
    try {
      return new Date(iso).toLocaleString(absLocale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  })();

  if (!mounted) {
    // SSR pass: render the same ISO so hydration is consistent.
    return (
      <span className={className} title={withAbsoluteTitle ? absolute : undefined} suppressHydrationWarning>
        {absolute}
      </span>
    );
  }
  return (
    <span className={className} title={withAbsoluteTitle ? absolute : undefined}>
      {format(t, iso)}
    </span>
  );
}
