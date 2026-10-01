import { Request, Response, NextFunction } from 'express';
import { readStore } from '../models/store.js';
import { Applicant } from '../models/store.js';
import { verifyApplicantToken } from '../services/tokenService.js';
import { checkRevocation } from '../services/revocationService.js';

// Attaches the authenticated applicant to req.applicant.
// Only accepts valid HS256 JWTs (legacy opaque tokens are removed).
export async function authenticateApplicant(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Applicant authentication token required' });
  }

  // Reject anything that is not a JWT format
  if (token.split('.').length !== 3) {
    return res.status(401).json({ error: 'Invalid or expired applicant token' });
  }

  let applicantId: string;
  try {
    const payload = await verifyApplicantToken(token);

    // Check password-change bulk revocation
    const revokedReason = await checkRevocation(
      payload.jti,
      payload.sub,
      'Applicant',
      payload.iat ?? 0,
    );
    if (revokedReason) {
      return res.status(401).json({ error: revokedReason });
    }

    applicantId = payload.sub;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('revoked')) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }
    return res.status(401).json({ error: 'Invalid or expired applicant token' });
  }

  const store = await readStore();
  const applicant = store.applicants.find((a: { id: string; email: string | null }) => a.id === applicantId && a.email !== null);

  if (!applicant) {
    return res.status(401).json({ error: 'Invalid or expired applicant token' });
  }

  req.applicant = applicant;
  next();
}

export interface AuthRequest extends Request {
  applicant?: Applicant;
}
