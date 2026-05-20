'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n/context';
import { locales, localeLabels, COOKIE_NAME, type Locale } from '../../../lib/i18n/config';

const FLAGS: Record<Locale, string> = {
  'pt-BR': '🇧🇷',
  en: '🇺🇸',
  es: '🇪🇸',
};

function LocaleSwitcher() {
  const { locale } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function switchLocale(newLocale: Locale) {
    try {
      document.cookie = `${COOKIE_NAME}=${newLocale};path=/;max-age=${365 * 24 * 60 * 60};SameSite=Lax;Secure`;
    } catch {
      /* cookie blocked — proceed with the navigation anyway */
    }
    const segments = (pathname || '').split('/').filter(Boolean);
    if (segments.length > 0) segments[0] = newLocale;
    else segments.push(newLocale);
    setOpen(false);
    router.push('/' + segments.join('/'));
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono text-slate-300 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/50"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span aria-hidden="true">{FLAGS[locale]}</span>
        <span>{localeLabels[locale].short}</span>
        <svg viewBox="0 0 12 12" className="h-3 w-3 opacity-60" aria-hidden="true" fill="currentColor">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1 bg-slate-900 ring-1 ring-slate-700 rounded-md shadow-xl overflow-hidden min-w-[160px] z-50"
        >
          {locales.map((loc) => (
            <button
              key={loc}
              type="button"
              role="option"
              aria-selected={locale === loc}
              onClick={() => switchLocale(loc)}
              className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
                locale === loc ? 'bg-primary/20 text-primary' : 'text-slate-200 hover:bg-slate-800'
              }`}
            >
              <span>{FLAGS[loc]}</span>
              <span className="font-mono">{localeLabels[loc].short}</span>
              <span className="opacity-60">—</span>
              <span>{localeLabels[loc].full}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminHeader() {
  const { t, locale } = useTranslation();
  return (
    <header
      className="bg-slate-900 text-slate-100 border-b border-slate-800"
      role="banner"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/${locale}/wallet-intel`}
            className="flex items-center gap-2 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
          >
            <span
              className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-primary text-white font-bold text-xs"
              aria-hidden="true"
            >
              W
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight truncate">{t('wi.appTitle')}</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 leading-tight">
                {t('wi.adminBadge')}
              </p>
            </div>
          </Link>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 text-[11px] text-slate-400 flex-wrap justify-end">
          <span className="hidden sm:inline italic max-w-[260px] truncate" title={t('wi.signOutHint')}>
            {t('wi.signOutHint')}
          </span>
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}
