/**
 * Seed function for FlagRule rows.
 *
 * Idempotency contract: this function is safe to call repeatedly. For every
 * rule in the registry, it upserts a FlagRule row keyed by `ruleKey`. The
 * `update` branch propagates ONLY code-owned fields (displayName, description)
 * so that copy edits in source files flow through to running deployments,
 * while admin-tuned fields (severity, enabled, paramsJson) remain untouched
 * once a row exists in production.
 *
 * Deferred rules (funding_source_cluster, wash_trading_internal,
 * price_impact_unexplained) are inserted with `enabled: false` so they appear
 * in the admin UI but never run until manually enabled.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/db';
import { allRules, deferredRuleKeys } from './rules/registry';

export interface SeedResult {
  created: number;
  updated: number;
}

export async function seedFlagRules(): Promise<SeedResult> {
  if (!prisma) {
    console.warn('[wallet-intel/seed-rules] prisma unavailable — skipping seed');
    return { created: 0, updated: 0 };
  }
  const db = prisma;

  let created = 0;
  let updated = 0;

  for (const rule of allRules) {
    const existing = await db.flagRule.findUnique({
      where: { ruleKey: rule.key },
      select: { id: true },
    });

    const enabledOnInsert = !deferredRuleKeys.has(rule.key);
    await db.flagRule.upsert({
      where: { ruleKey: rule.key },
      create: {
        ruleKey: rule.key,
        displayName: rule.displayName,
        description: rule.description,
        severity: rule.defaultSeverity,
        enabled: enabledOnInsert,
        paramsJson: rule.defaultParams as Prisma.InputJsonValue,
      },
      // Only propagate code-owned fields. severity/enabled/paramsJson are
      // admin-tunable and must NOT be reset by re-running the seed.
      update: {
        displayName: rule.displayName,
        description: rule.description,
      },
    });

    if (existing) updated += 1;
    else created += 1;
  }

  console.info(
    `[wallet-intel/seed-rules] seed complete created=${created} updated=${updated}`,
  );
  return { created, updated };
}
