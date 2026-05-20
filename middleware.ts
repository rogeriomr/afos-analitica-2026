import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { defaultLocale, COOKIE_NAME, isValidLocale, normalizeLocale, locales } from './lib/i18n/config';

const VISITOR_COOKIE_NAME = 'afos_visitor_id';
const VISITOR_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

function timingSafeStringEqual(a: string, b: string): boolean {
  // Note: length difference is technically observable here (early return),
  // but length is also observable from the base64 header anyway. The byte-loop
  // ensures the per-character compare is constant-time.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function ensureVisitorCookie(request: NextRequest, response: NextResponse): NextResponse {
  if (!request.cookies.get(VISITOR_COOKIE_NAME)) {
    response.cookies.set(VISITOR_COOKIE_NAME, crypto.randomUUID(), {
      maxAge: VISITOR_COOKIE_MAX_AGE,
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });
  }
  return response;
}

const STRATEGIC_DOCS = new Set([
  '/pipeline-launch-opensource.html',
  '/posicionamento-estrategico-afos.html',
]);

function basicAuthChallenge(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="AFOS Analytics - Documento interno"',
      'Cache-Control': 'no-store',
    },
  });
}

function checkStrategicDocAuth(request: NextRequest): NextResponse | null {
  const password = process.env.STRATEGIC_DOCS_PASSWORD;
  if (!password) {
    // Fail closed — sem env var, ninguém entra (mais seguro que liberar geral).
    return new NextResponse('Service unavailable', { status: 503 });
  }
  const auth = request.headers.get('authorization');
  if (!auth || !auth.startsWith('Basic ')) return basicAuthChallenge();
  let provided = '';
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    provided = idx >= 0 ? decoded.slice(idx + 1) : decoded;
  } catch {
    return basicAuthChallenge();
  }
  if (!timingSafeStringEqual(provided, password)) return basicAuthChallenge();
  return null;
}

function isWalletIntelPath(pathname: string): boolean {
  return pathname.startsWith('/api/wallet-intel/') ||
    /^\/(?:pt-BR|en|es)\/wallet-intel(?:\/|$)/.test(pathname);
}

function walletIntelAuthChallenge(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="AFOS Wallet Intelligence - Admin Only"',
      'Cache-Control': 'no-store',
    },
  });
}

function checkWalletIntelAuth(request: NextRequest): NextResponse | null {
  // Dev bypass: localhost is single-user — skip the Basic-auth gate for DX.
  // `next dev` sets NODE_ENV=development; `next build && next start` and any
  // Vercel deploy set NODE_ENV=production, so the gate stays armed in prod.
  if (process.env.NODE_ENV !== 'production') return null;

  const password = process.env.WALLET_INTEL_PASSWORD;
  if (!password) {
    // Fail closed — sem env var, ninguém entra (admin-only dashboard).
    return new NextResponse('Service unavailable', { status: 503 });
  }
  const auth = request.headers.get('authorization');
  if (!auth || !auth.startsWith('Basic ')) return walletIntelAuthChallenge();
  let provided = '';
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    provided = idx >= 0 ? decoded.slice(idx + 1) : decoded;
  } catch {
    return walletIntelAuthChallenge();
  }
  if (!timingSafeStringEqual(provided, password)) return walletIntelAuthChallenge();
  return null;
}

const memoryRL = new Map<string, { count: number; resetAt: number }>();

type RateLimitResult = 'ok' | 'limited' | 'unavailable';

async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    // Upstash configurado: falha = 'unavailable' (nunca cair em memory, evita bypass
    // entre workers serverless — cada instância contaria sozinha, permitindo N× o limite).
    try {
      const key = `rl:${ip}`;
      const res = await fetch(`${url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify([['INCR', key], ['EXPIRE', key, 60]]),
      });
      if (!res.ok) return 'unavailable';
      const data = await res.json();
      const count = data?.[0]?.result || 0;
      return count > 100 ? 'limited' : 'ok';
    } catch {
      return 'unavailable';
    }
  }

  // Sem Upstash (dev local): memory fallback é aceitável — uma única instância.
  const now = Date.now();
  const entry = memoryRL.get(ip);
  if (!entry || now > entry.resetAt) {
    memoryRL.set(ip, { count: 1, resetAt: now + 60000 });
    return 'ok';
  }
  if (entry.count >= 100) return 'limited';
  entry.count++;
  return 'ok';
}

function shouldSkip(pathname: string): boolean {
  return pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/geo/') ||
    pathname === '/opengraph-image' ||
    pathname.includes('.');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isWalletIntelPath(pathname)) {
    const denied = checkWalletIntelAuth(request);
    if (denied) return denied;
    // Auth ok — fall through to existing flow so /api/wallet-intel/* gets
    // rate-limit + security headers, and HTML pages get locale routing + visitor cookie.
  }

  if (STRATEGIC_DOCS.has(pathname)) {
    const denied = checkStrategicDocAuth(request);
    if (denied) return denied;
    return NextResponse.next();
  }

  // Bare root `/` falls through to app/page.tsx, which renders OG metadata
  // (EN copy) and dispatches a JS smart-redirect based on navigator.language.
  // Without this, middleware would 307 to /pt-BR before any HTML body renders,
  // leaving LLM crawlers and IM clients that don't follow redirects with empty
  // OG. See app/page.tsx for the redirect logic.
  if (pathname === '/') {
    return ensureVisitorCookie(request, NextResponse.next());
  }

  if (shouldSkip(pathname)) {
    if (pathname.startsWith('/api/')) {
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                 request.headers.get('x-real-ip') || 'unknown';
      const rl = await checkRateLimit(ip);
      if (rl === 'limited') {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } });
      }
      if (rl === 'unavailable') {
        return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: { 'Retry-After': '30' } });
      }
      const response = NextResponse.next();
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('X-Frame-Options', 'DENY');
      return response;
    }
    return NextResponse.next();
  }

  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0] || '';

  if (!isValidLocale(firstSegment)) {
    const normalized = normalizeLocale(firstSegment);
    if (normalized) {
      segments[0] = normalized;
      return NextResponse.redirect(new URL('/' + segments.join('/'), request.url));
    }
  } else {
    // Set Content-Language header based on locale + propagate locale via x-pathname-locale
    // for the root layout to read and emit <html lang="...">.
    const response = NextResponse.next();
    response.headers.set('Content-Language', firstSegment);
    response.headers.set('x-pathname-locale', firstSegment);
    return ensureVisitorCookie(request, response);
  }

  const cookieLocale = request.cookies.get(COOKIE_NAME)?.value;
  if (cookieLocale && isValidLocale(cookieLocale)) {
    return NextResponse.redirect(new URL(`/${cookieLocale}${pathname}`, request.url));
  }

  const acceptLang = request.headers.get('accept-language') || '';
  let detectedLocale = defaultLocale;
  for (const locale of locales) {
    if (acceptLang.toLowerCase().includes(locale.split('-')[0].toLowerCase())) {
      detectedLocale = locale;
      break;
    }
  }

  return NextResponse.redirect(new URL(`/${detectedLocale}${pathname}`, request.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
