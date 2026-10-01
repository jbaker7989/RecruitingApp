import { Request, Response, NextFunction } from 'express';
import { verifyUserToken, verifyApplicantToken, UserTokenPayload, ApplicantTokenPayload } from '../services/tokenService.js';
import { checkRevocation } from '../services/revocationService.js';

export interface AuthRequest extends Request {
  user?: { id: string; username: string; role: string };
}

// Simple role-based access control
export function requireRole(allowedRoles: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Extract the bearer token from the Authorization header only.
 * Query string tokens are explicitly NOT supported (log leakage prevention).
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

// Authenticate via JWT only �� legacy opaque tokens are removed.
// Public paths skip authentication entirely.
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);

  if (!token) {
    // Public paths that don't require authentication.
    const publicPaths = [
      '/health', '/',
      '/api/auth/login', '/api/auth/register',
      '/api/applicants/register', '/api/applicants/login',
      '/api/mcp/health',
      '/dashboard/login', '/dashboard/register', '/dashboard/logout',
    ];
    if (publicPaths.includes(req.path)) {
      return next();
    }
    return res.status(401).json({ error: 'No authentication token provided' });
  }

  // Reject anything that is not a JWT — raw UUIDs, opaque tokens are not credentials.
  if (token.split('.').length !== 3) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    // Try User JWT first, then Applicant JWT
    let id: string;
    let role: string;
    let jti: string;
    let iat: number;
    let userType: 'User' | 'Applicant';

    try {
      const payload = await verifyUserToken(token);
      id = payload.sub;
      role = payload.role;
      jti = payload.jti;
      iat = payload.iat!;
      userType = 'User';
    } catch {
      // Not a User JWT — try Applicant
      const payload = await verifyApplicantToken(token);
      id = payload.sub;
      role = 'applicant';
      jti = payload.jti;
      iat = payload.iat!;
      userType = 'Applicant';
    }

    // Check password-change bulk revocation
    const revokedReason = await checkRevocation(jti, id, userType, iat);
    if (revokedReason) {
      return res.status(401).json({ error: revokedReason });
    }

    req.user = { id, username: id, role };
    next();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('revoked')) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Logging middleware
export async function logAction(req: AuthRequest, action: string, entityType: string, entityId: string, details: object) {
  const { generateId, now, addObservabilityEntry } = await import('../models/store.js');
  const userId = req.user?.id || 'anonymous';
  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action,
    entityType,
    entityId,
    userId,
    details,
    outcome: 'success',
  });
}

// Error handler
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
}
