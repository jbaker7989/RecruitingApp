import { Router } from 'express';
import { readStore, writeStore, generateId, now, addObservabilityEntry, JobPosting } from '../models/store.js';
import { validateApplicantProfile, validateApplicationBody } from '../middleware/validation.js';
import { authenticateApplicant, AuthRequest } from '../middleware/applicantAuth.js';
import { signApplicantToken, verifyApplicantToken } from '../services/tokenService.js';
import { revokeToken, revokeAllForUser } from '../services/revocationService.js';
import { createResetToken, validateAndConsumeResetToken } from '../services/passwordResetService.js';
import { createHash } from 'crypto'; // ponytail: bcrypt when prod
import { initiateGoogle, initiateLinkedIn, handleGoogleCallback, handleLinkedInCallback } from '../services/oauthService.js';

const router = Router();

// ─── Completeness score ────────────────────────────────────────────────────────

function calculateCompleteness(a: { email: string | null; firstName: string; lastName: string; phone: string; address: { state: string; zip: string }; educationHistory: unknown[]; employmentHistory: unknown[]; rightToWork: boolean }): number {
  let score = 0;
  if (a.email) score += 10;
  if (a.firstName?.trim()) score += 10;
  if (a.lastName?.trim()) score += 10;
  if (a.phone?.trim()) score += 10;
  if (a.address?.state && a.address?.zip) score += 10;
  if (a.educationHistory?.length > 0) score += 15;
  if (a.employmentHistory?.length > 0) score += 15;
  if (a.rightToWork) score += 10;
  return score;
}

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

// ─── Public: Register ─────────────────────────────────────────────────────────

// POST /api/applicants/register
router.post('/register', async (req: any, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    if (!email || !password || !firstName || !lastName || !phone) {
      return res.status(400).json({ error: 'email, password, firstName, lastName, phone are required' });
    }

    // Email regex
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const store = await readStore();

    if (store.applicants.find(a => a.email?.toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const applicant = {
      id: generateId(),
      firstName,
      lastName,
      email: email.toLowerCase(),
      passwordHash: hashPassword(password),
      phone,
      preferredContactMethod: 'email' as const,
      address: { state: '', zip: '' },
      educationHistory: [],
      employmentHistory: [],
      rightToWork: false,
      requiresSponsorship: false,
      expectedPay: 0,
      notificationToManager: false,
      hireRecords: [],
      oauthProvider: null,
      oauthProviderId: null,
      createdAt: now(),
      updatedAt: now(),
    };

    store.applicants.push(applicant);
    await writeStore(store);

    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'register',
      entityType: 'Applicant',
      entityId: applicant.id,
      userId: applicant.id,
      details: { email: applicant.email },
      outcome: 'success',
    });

    const token = await signApplicantToken(applicant.id, true);
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'token_issued',
      entityType: 'Applicant',
      entityId: applicant.id,
      userId: applicant.id,
      details: { email: applicant.email, tokenType: 'jwt' },
      outcome: 'success',
    });

    res.status(201).json({
      token,
      expiresIn: 604800,
      profile: {
        id: applicant.id,
        firstName: applicant.firstName,
        lastName: applicant.lastName,
        email: applicant.email,
        completeness: calculateCompleteness(applicant),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Registration failed' });
  }
});

// ─── Public: Login ────────────────────────────────────────────────────────────

// POST /api/applicants/login
router.post('/login', async (req: any, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const store = await readStore();
    const applicant = store.applicants.find(
      a => a.email?.toLowerCase() === email.toLowerCase()
    );

    if (!applicant || !applicant.passwordHash || applicant.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const hasCredentials = !!(applicant.passwordHash);
    const token = await signApplicantToken(applicant.id, hasCredentials);
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'token_issued',
      entityType: 'Applicant',
      entityId: applicant.id,
      userId: applicant.id,
      details: { email: applicant.email, tokenType: 'jwt' },
      outcome: 'success',
    });

    res.json({
      token,
      expiresIn: 604800,
      profile: {
        id: applicant.id,
        firstName: applicant.firstName,
        lastName: applicant.lastName,
        email: applicant.email,
        completeness: calculateCompleteness(applicant),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Login failed' });
  }
});

// ─── Authenticated: Me ────────────────────────────────────────────────────────

// GET /api/applicants/me
router.get('/me', authenticateApplicant, async (req: AuthRequest, res) => {
  try {
    const applicant = req.applicant!;
    res.json({
      ...applicant,
      completeness: calculateCompleteness(applicant),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch profile' });
  }
});

// PATCH /api/applicants/me — update applicant profile; password change triggers token revocation
router.patch('/me', async (req: AuthRequest, res) => {
  // Read the raw auth token from the Authorization header since authenticateApplicant
  // consumes it and attaches req.applicant. We need the token's jti for revocation.
  const rawToken = req.headers['authorization']?.split(' ')[1];
  if (!rawToken) return res.status(401).json({ error: 'Applicant authentication token required' });

  try {
    const payload = await verifyApplicantToken(rawToken);
    const store = await readStore();
    const index = store.applicants.findIndex(a => a.id === payload.sub);
    if (index === -1) return res.status(404).json({ error: 'Applicant not found' });

    const { password, hireRecords, createdAt, ...safeUpdates } = req.body;
    if (password) {
      // Password change — revoke all tokens for this applicant
      await revokeAllForUser(payload.sub, 'Applicant', payload.jti, 604800);
      store.applicants[index] = {
        ...store.applicants[index],
        passwordHash: hashPassword(password),
        ...safeUpdates,
        updatedAt: now(),
      };
    } else {
      store.applicants[index] = {
        ...store.applicants[index],
        ...safeUpdates,
        updatedAt: now(),
      };
    }
    await writeStore(store);

    res.json({
      ...store.applicants[index],
      completeness: calculateCompleteness(store.applicants[index]),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('revoked')) return res.status(401).json({ error: 'Token has been revoked' });
    res.status(401).json({ error: 'Invalid or expired applicant token' });
  }
});

// ─── Authenticated: My Applications ──────────────────────────────────────────

// GET /api/applicants/me/applications
router.get('/me/applications', authenticateApplicant, async (req: AuthRequest, res) => {
  try {
    const store = await readStore();
    const applications = store.applications.filter(a => a.applicantId === req.applicant!.id);

    // Enrich with job info
    const enriched = applications.map(app => {
      const job = store.jobs.find(j => j.id === app.jobPostingId);
      const company = job ? store.companies.find(c => c.id === job.companyId) : null;
      return { ...app, job, company };
    });

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch applications' });
  }
});

// ─── Authenticated: My Jobs Browse (with hasApplied) ───────────────────────────

// GET /api/applicants/me/jobs
router.get('/me/jobs', authenticateApplicant, async (req: AuthRequest, res) => {
  try {
    const store = await readStore();
    const myApplications = store.applications.filter(a => a.applicantId === req.applicant!.id);
    const appliedJobPostingIds = new Set(myApplications.map(a => a.jobPostingId));

    const jobsWithStatus: (JobPosting & { hasApplied: boolean; applicationId: string | null })[] = store.jobs
      .filter(j => j.isActive)
      .map(job => {
        const app = myApplications.find(a => a.jobPostingId === job.id);
        return {
          ...job,
          hasApplied: appliedJobPostingIds.has(job.id),
          applicationId: app?.id ?? null,
        };
      });

    res.json(jobsWithStatus);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch jobs' });
  }
});

// ─── Legacy: Create Applicant (non-auth, credential-less) ────────────────────

// POST /api/applicants — legacy non-auth creation
router.post('/', async (req: any, res) => {
  try {
    const validation = validateApplicantProfile(req.body);
    if (!validation.valid) {
      return res.status(400).json({ errors: validation.errors });
    }

    const store = await readStore();
    const applicant = {
      id: generateId(),
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email || null,
      passwordHash: req.body.passwordHash || null,
      phone: req.body.phone,
      preferredContactMethod: req.body.preferredContactMethod || 'email',
      address: req.body.address || { state: '', zip: '' },
      educationHistory: req.body.educationHistory || [],
      employmentHistory: req.body.employmentHistory || [],
      rightToWork: req.body.rightToWork || false,
      requiresSponsorship: req.body.requiresSponsorship || false,
      expectedPay: req.body.expectedPay || 0,
      notificationToManager: req.body.notificationToManager || false,
      hireRecords: [],
      oauthProvider: null,
      oauthProviderId: null,
      createdAt: now(),
      updatedAt: now(),
    };

    store.applicants.push(applicant);
    await writeStore(store);

    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'create',
      entityType: 'Applicant',
      entityId: applicant.id,
      userId: applicant.id,
      details: { name: `${applicant.firstName} ${applicant.lastName}` },
      outcome: 'success',
    });

    res.status(201).json(applicant);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create applicant' });
  }
});

// GET /api/applicants/:id — public lookup (see story: story-applicant-lookup-auth)
router.get('/:id', async (req, res) => {
  try {
    const store = await readStore();
    const applicant = store.applicants.find(a => a.id === req.params.id);
    if (!applicant) return res.status(404).json({ error: 'Applicant not found' });

    const hires = store.hires.filter(h => h.applicantId === applicant.id);
    res.json({ ...applicant, hires });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch applicant' });
  }
});

// PUT /api/applicants/:id — update (non-auth, kept for legacy)
router.put('/:id', async (req: any, res) => {
  try {
    const store = await readStore();
    const index = store.applicants.findIndex(a => a.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Applicant not found' });

    store.applicants[index] = { ...store.applicants[index], ...req.body, updatedAt: now() };
    await writeStore(store);
    res.json(store.applicants[index]);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update applicant' });
  }
});

// POST /api/applicants/:id/apply — legacy convenience endpoint
router.post('/:id/apply', async (req: any, res) => {
  try {
    const store = await readStore();
    const applicant = store.applicants.find(a => a.id === req.params.id);
    if (!applicant) return res.status(404).json({ error: 'Applicant not found' });
    if (!req.body.jobPostingId) return res.status(400).json({ error: 'jobPostingId is required' });

    // Duplicate check
    const existing = store.applications.find(
      a => a.applicantId === applicant.id && a.jobPostingId === req.body.jobPostingId
    );
    if (existing) {
      return res.status(409).json({ error: 'Already applied to this job', applicationId: existing.id });
    }

    const application = {
      id: generateId(),
      applicantId: applicant.id,
      jobPostingId: req.body.jobPostingId,
      status: 'pending' as const,
      matchScore: 0,
      keywordMatches: [],
      educationMatchScore: 0,
      experienceMatchScore: 0,
      appliedAt: now(),
      updatedAt: now(),
      emailConfirmed: false,
    };

    store.applications.push(application);
    await writeStore(store);

    res.status(201).json(application);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to apply' });
  }
});

// POST /api/applicants/logout — revoke current applicant token
router.post('/logout', async (req: any, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Applicant authentication token required' });
  try {
    const payload = await verifyApplicantToken(token);
    await revokeToken(payload.jti, 604800, payload.sub, 'Applicant');
    res.json({ message: 'Logged out successfully' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('revoked')) return res.status(401).json({ error: 'Token has been revoked' });
    res.status(401).json({ error: 'Invalid or expired applicant token' });
  }
});

// POST /api/applicants/forgot-password — generate a reset token (no auth required)
router.post('/forgot-password', async (req: any, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const store = await readStore();
    const applicant = store.applicants.find(
      a => a.email?.toLowerCase() === email.toLowerCase(),
    );

    // Always return 200 — do not reveal whether the email exists
    if (!applicant) {
      return res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    }

    await createResetToken(applicant.id, applicant.email!);
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'password_reset_requested',
      entityType: 'Applicant',
      entityId: applicant.id,
      userId: applicant.id,
      details: { email: applicant.email },
      outcome: 'success',
    });

    res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to process request' });
  }
});

// POST /api/applicants/reset-password — reset password using a valid reset token
router.post('/reset-password', async (req: any, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'token and newPassword are required' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const validation = await validateAndConsumeResetToken(token);
    if (!validation.valid) {
      return res.status(401).json({ error: validation.reason });
    }

    const store = await readStore();
    const index = store.applicants.findIndex(a => a.id === validation.applicantId);
    if (index === -1) {
      return res.status(401).json({ error: 'Invalid reset token' });
    }

    // Also revoke all existing JWTs for this applicant
    await revokeAllForUser(validation.applicantId, 'Applicant');

    store.applicants[index] = {
      ...store.applicants[index],
      passwordHash: hashPassword(newPassword),
      updatedAt: now(),
    };
    await writeStore(store);

    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'password_reset_completed',
      entityType: 'Applicant',
      entityId: validation.applicantId,
      userId: validation.applicantId,
      details: {},
      outcome: 'success',
    });

    res.json({ message: 'Password has been reset successfully. Please log in with your new password.' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to reset password' });
  }
});

// ─── OAuth / Social Login ───────────────────────────────────────────────────────

// GET /api/applicants/auth/google — redirect to Google authorization
router.get('/auth/google', async (req: any, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const { redirectTo } = initiateGoogle(baseUrl);
    res.redirect(302, redirectTo);
  } catch (error) {
    res.status(503).json({ error: 'Google login is not configured' });
  }
});

// GET /api/applicants/auth/google/callback — handle Google OAuth callback
router.get('/auth/google/callback', async (req: any, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error) {
    return res.status(400).json({ error: `Google authorization denied: ${error}` });
  }
  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter' });
  }

  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await handleGoogleCallback(code, state, baseUrl);
    return res.json({ token: result.token, expiresIn: result.expiresIn });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'OAuth callback failed';
    return res.status(401).json({ error: msg });
  }
});

// GET /api/applicants/auth/linkedin — redirect to LinkedIn authorization
router.get('/auth/linkedin', async (req: any, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const { redirectTo } = initiateLinkedIn(baseUrl);
    res.redirect(302, redirectTo);
  } catch (error) {
    res.status(503).json({ error: 'LinkedIn login is not configured' });
  }
});

// GET /api/applicants/auth/linkedin/callback — handle LinkedIn OAuth callback
router.get('/auth/linkedin/callback', async (req: any, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error) {
    return res.status(400).json({ error: `LinkedIn authorization denied: ${error}` });
  }
  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter' });
  }

  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await handleLinkedInCallback(code, state, baseUrl);
    return res.json({ token: result.token, expiresIn: result.expiresIn });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'OAuth callback failed';
    return res.status(401).json({ error: msg });
  }
});

export default router;
