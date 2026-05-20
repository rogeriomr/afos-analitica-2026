/**
 * Internal shared helpers for /api/wallet-intel/* routes.
 *
 * Underscore prefix on the folder name is conventional in Next.js App Router
 * to mark non-routable files (Next does not turn _shared.ts into a route).
 *
 * NOTE: This file lives under app/api/wallet-intel/ (owned by the read-side API
 * agent), NOT under app/lib/wallet-intel/ (owned by ingest/scoring agents).
 */

export const ADDRESS_RE = /^0x[a-f0-9]{40}$/;
export const CONDITION_ID_RE = /^0x[a-f0-9]{64}$/;

export const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = typeof VALID_SEVERITIES[number];

export function isValidAddress(addr: string): boolean {
  return ADDRESS_RE.test(addr);
}

export function isValidConditionId(id: string): boolean {
  return CONDITION_ID_RE.test(id);
}

/**
 * Parse a comma-separated severity filter. Returns null for "no filter"
 * (param absent / empty), array on success, or 'invalid' if any token
 * is not a valid severity (callers should return 400).
 */
export function parseSeverityFilter(raw: string | null): Severity[] | null | 'invalid' {
  if (!raw) return null;
  const tokens = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) return null;
  const out: Severity[] = [];
  for (const t of tokens) {
    if (!(VALID_SEVERITIES as readonly string[]).includes(t)) return 'invalid';
    out.push(t as Severity);
  }
  return out;
}

export function parseIntParam(
  raw: string | null,
  defaultValue: number,
  min: number,
  max: number,
): number | 'invalid' {
  if (raw == null || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 'invalid';
  if (n < min || n > max) return 'invalid';
  return n;
}
