import { Request, Response, NextFunction } from 'express';
import { verifyAnyToken } from '../services/tokenService.js';
import { readStore } from '../models/store.js';
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

// Authenticate any token — JWT or legacy opaque.
// Public paths skip authentication entirely.
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.split(' ')[1] || req.query.token as string;

  if (!token) {
    // Public paths that don't require authentication.
    // Specific public auth routes listed to avoid a separate router/middleware for just these.
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

  try {
    const result = await verifyAnyToken(token);
    let role: string;
    if (result.type === 'applicant') {
      role = 'applicant';
    } else if (result.jwtPayload && 'role' in result.jwtPayload) {
      role = (result.jwtPayload as { role: string }).role;
    } else {
      // Legacy opaque user token — look up the user's actual role from the store
      const store = await readStore();
      const user = store.users.find(u => u.id === result.id);
      role = user?.role ?? 'user';
    }

    // Check password-change bulk revocation for JWT tokens
    if (result.jwtPayload) {
      const jwtPayload = result.jwtPayload as { jti: string; iat: number };
      const revokedReason = await checkRevocation(
        jwtPayload.jti,
        result.id,
        'User',
        jwtPayload.iat,
      );
      if (revokedReason) {
        return res.status(401).json({ error: revokedReason });
      }
    }

    req.user = { id: result.id, username: result.id, role };
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
