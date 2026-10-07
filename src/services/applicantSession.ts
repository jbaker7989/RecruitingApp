import type { Response } from 'express';

export const APPLICANT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_COOKIE_ATTRIBUTES = 'HttpOnly; SameSite=Lax; Path=/';

export function setApplicantSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `token=${token}; ${SESSION_COOKIE_ATTRIBUTES}; Max-Age=${APPLICANT_SESSION_TTL_SECONDS}${secure}`);
}

export function clearApplicantSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `token=; ${SESSION_COOKIE_ATTRIBUTES}; Max-Age=0`);
}

export function safeApplicantDestination(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/dashboard/applications';
  try {
    const target = new URL(value, 'https://app.invalid');
    return target.origin === 'https://app.invalid' && (target.pathname === '/dashboard' || target.pathname.startsWith('/dashboard/'))
      ? `${target.pathname}${target.search}${target.hash}`
      : '/dashboard/applications';
  } catch {
    return '/dashboard/applications';
  }
}
