import { Request, Response, NextFunction } from 'express';
import { readStore } from '../models/store.js';
import { generateId, now, addObservabilityEntry } from '../models/store.js';

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

// Simple auth middleware (for now, reads from header or query)
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.split(' ')[1] || req.query.token as string;
  
  if (!token) {
    // Allow unauthenticated access for health/root
    if (req.path === '/health' || req.path === '/') {
      return next();
    }
    return res.status(401).json({ error: 'No authentication token provided' });
  }

  try {
    const store = await readStore();
    const user = store.users.find(u => u.id === token || u.username === token);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = { id: user.id, username: user.username, role: user.role };
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Logging middleware
export async function logAction(req: AuthRequest, action: string, entityType: string, entityId: string, details: object) {
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
