import { createSigner, createVerifier } from 'fast-jwt';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`missing required env var ${name}`);
  return value;
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw === undefined ? fallback : Number.parseInt(raw, 10);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface SessionClaims {
  readonly sub: string;
  readonly name: string;
  readonly guest: boolean;
}

const JWT_TTL_SECONDS = 60 * 60 * 24 * 7;

export function makeSigner(secret: string) {
  const sign = createSigner({ key: secret, expiresIn: JWT_TTL_SECONDS * 1000 });
  return (claims: SessionClaims): string => sign(claims);
}

export function makeVerifier(secret: string) {
  const verify = createVerifier({ key: secret });
  return (token: string): SessionClaims => {
    const payload = verify(token) as SessionClaims;
    if (!payload.sub) throw new Error('token has no subject');
    return payload;
  };
}

/** Cookie name used consistently across every service. */
export const SESSION_COOKIE = 'ludo_session';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: JWT_TTL_SECONDS,
} as const;

/**
 * Pulls the session token from either the cookie or an Authorization header.
 * The browser uses the cookie; the Socket.io handshake uses the header.
 */
export function extractToken(headers: Record<string, unknown>): string | null {
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  const cookie = headers['cookie'];
  if (typeof cookie === 'string') {
    for (const part of cookie.split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === SESSION_COOKIE) return rest.join('=');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

/**
 * Every request carries an x-correlation-id across service hops. This is what
 * makes a single dice roll traceable from browser to gateway to engine.
 */
export const CORRELATION_HEADER = 'x-correlation-id';

export function correlationId(headers: Record<string, unknown>): string {
  const existing = headers[CORRELATION_HEADER];
  return typeof existing === 'string' && existing.length > 0
    ? existing
    : crypto.randomUUID();
}
