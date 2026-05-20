'use client';

import { useState } from 'react';
import { useTranslation } from '../../i18n/context';
import { RelativeTime } from './RelativeTime';

interface RunResult {
  walletsEvaluated: number;
  flagsRaised: number;
  durationMs: number;
}

interface SeedResult {
  created: number;
  updated: number;
}

interface Props {
  lastIngestedAt: string | null;
}

export function DetectionActions({ lastIngestedAt }: Props) {
  const { t } = useTranslation();
  const [runState, setRunState] = useState<
    { loading: false; result: RunResult | null; error: string | null }
    | { loading: true; result: null; error: null }
  >({ loading: false, result: null, error: null });
  const [seedState, setSeedState] = useState<
    { loading: false; result: SeedResult | null; error: string | null }
    | { loading: true; result: null; error: null }
  >({ loading: false, result: null, error: null });

  async function runDetection() {
    setRunState({ loading: true, result: null, error: null });
    try {
      const res = await fetch('/api/wallet-intel/admin/run-detection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
      setRunState({ loading: false, result: json as RunResult, error: null });
    } catch (e) {
      setRunState({ loading: false, result: null, error: e instanceof Error ? e.message : 'unknown' });
    }
  }

  async function seedRules() {
    setSeedState({ loading: true, result: null, error: null });
    try {
      const res = await fetch('/api/wallet-intel/admin/seed-rules', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
      setSeedState({ loading: false, result: json as SeedResult, error: null });
    } catch (e) {
      setSeedState({ loading: false, result: null, error: e instanceof Error ? e.message : 'unknown' });
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('wiDetection.lastRun')}:{' '}
          {lastIngestedAt ? <RelativeTime iso={lastIngestedAt} /> : <span className="italic">{t('wiSummary.neverIngested')}</span>}
        </p>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t('wiDetection.runDetection')}</h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{t('wiDetection.runDetectionDesc')}</p>
          <button
            type="button"
            onClick={runDetection}
            disabled={runState.loading}
            className="mt-4 inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {runState.loading ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 animate-spin" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                {t('wiDetection.runDetectionRunning')}
              </>
            ) : (
              <>▶ {t('wiDetection.runDetection')}</>
            )}
          </button>

          {runState.error && (
            <p className="mt-3 text-xs text-red-700 dark:text-red-300">
              <span className="font-semibold">{t('wiDetection.errorPrefix')}:</span> {runState.error}
            </p>
          )}
          {runState.result && (
            <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">{t('wiDetection.resultWalletsEvaluated')}</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-primary">{runState.result.walletsEvaluated}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">{t('wiDetection.resultFlagsRaised')}</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-orange-600 dark:text-orange-300">{runState.result.flagsRaised}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">{t('wiDetection.resultDuration')}</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-slate-700 dark:text-slate-300">{runState.result.durationMs.toLocaleString()}</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t('wiDetection.seedRules')}</h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{t('wiDetection.seedRulesDesc')}</p>
          <button
            type="button"
            onClick={seedRules}
            disabled={seedState.loading}
            className="mt-4 inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {seedState.loading ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 animate-spin" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                {t('wiDetection.seedRulesRunning')}
              </>
            ) : (
              <>⚙ {t('wiDetection.seedRules')}</>
            )}
          </button>

          {seedState.error && (
            <p className="mt-3 text-xs text-red-700 dark:text-red-300">
              <span className="font-semibold">{t('wiDetection.errorPrefix')}:</span> {seedState.error}
            </p>
          )}
          {seedState.result && (
            <dl className="mt-4 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">{t('wiDetection.resultCreated')}</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-300">{seedState.result.created}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">{t('wiDetection.resultUpdated')}</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-blue-600 dark:text-blue-300">{seedState.result.updated}</dd>
              </div>
            </dl>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('wiDetection.explainerTitle')}</h2>
        <ul className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          <li>• {t('wiDetection.explainerRun')}</li>
          <li>• {t('wiDetection.explainerSeed')}</li>
        </ul>
      </section>
    </div>
  );
}
