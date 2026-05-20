'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from '../../i18n/context';

interface Props {
  address: string;
  /** When provided, the visible label is rendered as a Link to the given href. */
  href?: string;
  /** Show a copy button. Defaults to true. */
  copy?: boolean;
  /** Total chars to keep on each side of the ellipsis (default 6/4 → 0x123456...abcd). */
  prefix?: number;
  suffix?: number;
  /** Optional CSS class for the address label. */
  className?: string;
  /** Render with no truncation. */
  full?: boolean;
}

function truncate(addr: string, prefix: number, suffix: number): string {
  if (!addr.startsWith('0x') || addr.length <= prefix + suffix + 4) return addr;
  return `${addr.slice(0, 2 + prefix)}...${addr.slice(-suffix)}`;
}

export function WalletAddress({
  address,
  href,
  copy = true,
  prefix = 6,
  suffix = 4,
  className = '',
  full = false,
}: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const label = full ? address : truncate(address, prefix, suffix);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }
    } catch {
      /* clipboard blocked — silent fail */
    }
  }

  const labelEl = href ? (
    <Link
      href={href}
      className={`font-mono text-xs sm:text-sm text-primary hover:underline ${className}`}
      title={address}
    >
      {label}
    </Link>
  ) : (
    <span className={`font-mono text-xs sm:text-sm ${className}`} title={address}>
      {label}
    </span>
  );

  if (!copy) return labelEl;

  return (
    <span className="inline-flex items-center gap-1.5">
      {labelEl}
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center text-xs text-slate-500 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 rounded px-1"
        aria-label={t('wi.copy')}
        title={copied ? t('wi.copied') : t('wi.copy')}
      >
        {copied ? (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M16.704 5.29a1 1 0 010 1.42l-7.997 8a1 1 0 01-1.414 0l-3.997-4a1 1 0 011.415-1.414l3.29 3.293 7.29-7.299a1 1 0 011.413 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M8 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0015.414 5L13 2.586A2 2 0 0011.586 2H8z" />
            <path d="M2 6a2 2 0 012-2h2v2H4v10h6v-2h2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
        )}
      </button>
    </span>
  );
}
