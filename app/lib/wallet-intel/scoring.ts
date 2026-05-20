/**
 * Wallet scoring — aggregates RedFlag rows into a single 0-100 trust score.
 *
 * Formula:
 *   contribution(flag) = base(severity) * decay(age)
 *     base:    critical=30, high=15, medium=7, low=3
 *     decay:   1.0 if age <= 30 days, else 0.5
 *   totalScore = min(100, sum(contributions))
 *
 * Score is persisted via upsert into WalletScore. Breakdown is the per-ruleKey
 * sum of contributions, useful for "why this score" tooltips in the UI.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/db';
import type { Severity } from './rules/types';

const SEVERITY_BASE: Record<Severity, number> = {
  critical: 30,
  high: 15,
  medium: 7,
  low: 3,
};

const DECAY_AGE_MS = 30 * 86_400_000;
const DECAY_FACTOR = 0.5;
const MAX_SCORE = 100;

export interface WalletScoreSummary {
  totalScore: number;
  flagCount: number;
  highSeverityCount: number;
  breakdown: Record<string, number>;
}

function isSeverity(v: string): v is Severity {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'critical';
}

export async function computeWalletScore(
  walletId: string,
): Promise<WalletScoreSummary> {
  const empty: WalletScoreSummary = {
    totalScore: 0,
    flagCount: 0,
    highSeverityCount: 0,
    breakdown: {},
  };
  if (!prisma) {
    console.warn('[wallet-intel/scoring] prisma unavailable — returning empty score');
    return empty;
  }
  const db = prisma;

  const flags = await db.redFlag.findMany({
    where: { walletId },
    select: { ruleKey: true, severity: true, triggeredAt: true },
  });

  const breakdown: Record<string, number> = {};
  let rawScore = 0;
  let highSeverityCount = 0;
  const now = Date.now();

  for (const f of flags) {
    if (!isSeverity(f.severity)) continue;
    const base = SEVERITY_BASE[f.severity];
    const ageMs = now - f.triggeredAt.getTime();
    const decay = ageMs > DECAY_AGE_MS ? DECAY_FACTOR : 1;
    const contribution = base * decay;
    rawScore += contribution;
    breakdown[f.ruleKey] = (breakdown[f.ruleKey] ?? 0) + contribution;
    if (f.severity === 'high' || f.severity === 'critical') {
      highSeverityCount += 1;
    }
  }

  // Round breakdown values for stable persistence + tidy display.
  for (const k of Object.keys(breakdown)) {
    breakdown[k] = Number(breakdown[k].toFixed(2));
  }
  const totalScore = Number(Math.min(MAX_SCORE, rawScore).toFixed(2));

  const summary: WalletScoreSummary = {
    totalScore,
    flagCount: flags.length,
    highSeverityCount,
    breakdown,
  };

  await db.walletScore.upsert({
    where: { walletId },
    create: {
      walletId,
      totalScore: summary.totalScore,
      flagCount: summary.flagCount,
      highSeverityCount: summary.highSeverityCount,
      breakdownJson: summary.breakdown as Prisma.InputJsonValue,
      lastComputedAt: new Date(),
    },
    update: {
      totalScore: summary.totalScore,
      flagCount: summary.flagCount,
      highSeverityCount: summary.highSeverityCount,
      breakdownJson: summary.breakdown as Prisma.InputJsonValue,
      lastComputedAt: new Date(),
    },
  });

  return summary;
}

export async function recomputeAllScores(): Promise<{ updated: number }> {
  if (!prisma) {
    console.warn('[wallet-intel/scoring] prisma unavailable — recompute skipped');
    return { updated: 0 };
  }
  const db = prisma;

  const walletIds = await db.redFlag.findMany({
    select: { walletId: true },
    distinct: ['walletId'],
  });

  let updated = 0;
  for (const row of walletIds) {
    try {
      await computeWalletScore(row.walletId);
      updated += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[wallet-intel/scoring] failed to recompute wallet ${row.walletId}: ${msg}`,
      );
    }
  }
  return { updated };
}
