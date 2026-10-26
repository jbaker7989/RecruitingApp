import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto'; // ponytail: bcrypt when prod
import { readStore, updateStore, generateId, now, addObservabilityEntry, JobPosting, Applicant } from '../models/store.js';
import { validateApplicantProfile, validateApplicationBody, validateEmail } from '../middleware/validation.js';
import { authenticateApplicant, AuthRequest } from '../middleware/applicantAuth.js';
import { authenticate, type AuthRequest as UserAuthRequest } from '../middleware/auth.js';
import { signApplicantToken, verifyApplicantToken } from '../services/tokenService.js';
import { revokeToken, revokeAllForUser } from '../services/revocationService.js';
import { createResetToken, resetPasswordWithToken } from '../services/passwordResetService.js';
import { initiateGoogle, initiateLinkedIn, initiateFacebook, handleGoogleCallback, handleLinkedInCallback, handleFacebookCallback, resolveOAuthBaseUrl } from '../services/oauthService.js';
import { safeApplicantDestination, setApplicantSessionCookie } from '../services/applicantSession.js';
import { recordOAuthUserDenied, recordOAuthValidationFailure } from '../telemetry/providerOps.js';

const BCRYPT_ROUNDS = 10;
const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, BCRYPT_ROUNDS);
const verifyPassword = (password: string, hash: string): Promise<boolean> => bcrypt.compare(password, hash);

const router = Router();

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// Build a response from approved fields, not a spread of stored data. Legacy
// records may contain extra credential fields from older write paths.
function sanitizeApplicant(applicant: Applicant) {
  return {
    id: safeString(applicant.id),
    firstName: safeString(applicant.firstName),
    lastName: safeString(applicant.lastName),
    email: typeof applicant.email === 'string' ? applicant.email : null,
    phone: safeString(applicant.phone),
    preferredContactMethod: applicant.preferredContactMethod === 'sms' ? 'sms' : 'email',
    address: {
      state: isRecord(applicant.address) ? safeString(applicant.address.state) : '',
      zip: isRecord(applicant.address) ? safeString(applicant.address.zip) : '',
    },
    educationHistory: Array.isArray(applicant.educationHistory)
      ? applicant.educationHistory.filter(isRecord).map(entry => ({
        institution: safeString(entry.institution), degree: safeString(entry.degree),
        fieldOfStudy: safeString(entry.fieldOfStudy), startDate: safeString(entry.startDate),
        endDate: safeString(entry.endDate),
        ...(typeof entry.gpa === 'string' ? { gpa: entry.gpa } : {}),
      })) : [],
    employmentHistory: Array.isArray(applicant.employmentHistory)
      ? applicant.employmentHistory.filter(isRecord).map(entry => ({
        company: safeString(entry.company), position: safeString(entry.position),
        startDate: safeString(entry.startDate), endDate: safeString(entry.endDate),
        ...(Array.isArray(entry.responsibilities) ? {
          responsibilities: entry.responsibilities.filter(item => typeof item === 'string'),
        } : {}),
      })) : [],
    rightToWork: applicant.rightToWork === true,
    requiresSponsorship: applicant.requiresSponsorship === true,
    expectedPay: typeof applicant.expectedPay === 'number' && Number.isFinite(applicant.expectedPay) ? applicant.expectedPay : 0,
    notificationToManager: applicant.notificationToManager === true,
    hireRecords: Array.isArray(applicant.hireRecords)
      ? applicant.hireRecords.filter(item => typeof item === 'string') : [],
    createdAt: safeString(applicant.createdAt),
    updatedAt: safeString(applicant.updatedAt),
  };
}

// Profile fields accepted on both applicant update routes. Credential,
// immutable ID, OAuth identity, ownership, and audit fields are absent.
// Email remains a profile field for compatibility with existing update flows.
const PROFILE_WRITE_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'preferredContactMethod',
  'address', 'educationHistory', 'employmentHistory', 'rightToWork',
  'requiresSponsorship', 'expectedPay', 'notificationToManager',
] as const satisfies readonly (keyof Applicant)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function profileUpdates(body: unknown): Partial<Applicant> | null {
  if (!isRecord(body)) return null;
  const input = body;
  const updates: Record<string, unknown> = {};
  for (const field of PROFILE_WRITE_FIELDS) {
    if (!Object.hasOwn(input, field)) continue;
    const value = input[field];
    if (field === 'address') {
      if (!isRecord(value) || typeof value.state !== 'string' || typeof value.zip !== 'string') return null;
      updates.address = { state: value.state, zip: value.zip };
    } else if (field === 'educationHistory') {
      if (!Array.isArray(value)) return null;
      const entries: Applicant['educationHistory'] = [];
      for (const entry of value) {
        if (!isRecord(entry) || typeof entry.institution !== 'string' || typeof entry.degree !== 'string' ||
            typeof entry.fieldOfStudy !== 'string' || typeof entry.startDate !== 'string' ||
            typeof entry.endDate !== 'string' || (entry.gpa !== undefined && typeof entry.gpa !== 'string')) return null;
        entries.push({ institution: entry.institution, degree: entry.degree, fieldOfStudy: entry.fieldOfStudy,
          startDate: entry.startDate, endDate: entry.endDate,
          ...(entry.gpa !== undefined ? { gpa: entry.gpa as string } : {}) });
      }
      updates.educationHistory = entries;
    } else if (field === 'employmentHistory') {
      if (!Array.isArray(value)) return null;
      const entries: Applicant['employmentHistory'] = [];
      for (const entry of value) {
        if (!isRecord(entry) || typeof entry.company !== 'string' || typeof entry.position !== 'string' ||
            typeof entry.startDate !== 'string' ||
            (entry.endDate !== undefined && typeof entry.endDate !== 'string') ||
            (entry.responsibilities !== undefined &&
             (!Array.isArray(entry.responsibilities) ||
              !entry.responsibilities.every(item => typeof item === 'string')))) return null;
        entries.push({ company: entry.company, position: entry.position, startDate: entry.startDate,
          endDate: typeof entry.endDate === 'string' ? entry.endDate : '',
          ...(entry.responsibilities !== undefined ? { responsibilities: entry.responsibilities as string[] } : {}) });
      }
      updates.employmentHistory = entries;
    } else {
      if (['firstName', 'lastName', 'phone'].includes(field) && typeof value !== 'string') return null;
      if (field === 'email' && (typeof value !== 'string' || !validateEmail(value))) return null;
      if (field === 'preferredContactMethod' && value !== 'email' && value !== 'sms') return null;
      if (['rightToWork', 'requiresSponsorship', 'notificationToManager'].includes(field) && typeof value !== 'boolean') return null;
      if (field === 'expectedPay' && (typeof value !== 'number' || !Number.isFinite(value))) return null;
      updates[field] = value;
    }
  }
  return updates as Partial<Applicant>;
}

function canAccessApplicant(req: UserAuthRequest): boolean {
  return req.user?.role === 'member-services' ||
    (req.user?.role === 'applicant' && req.user.id === req.params.id);
}

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

// hashPassword/verifyPassword are defined at top of file using bcrypt.

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

    const applicant = {
      id: generateId(),
      firstName,
      lastName,
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
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

    // Duplicate-email check and insert are one transaction so concurrent registrations cannot both succeed.
    const registered = await updateStore((store) => {
      if (store.applicants.some(a => a.email?.toLowerCase() === email.toLowerCase())) return false;
      store.applicants.push(applicant);
      return true;
    });
    if (!registered) return res.status(409).json({ error: 'An account with this email already exists' });

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

    if (!applicant || !applicant.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    // Migrate legacy sha256 hashes on first successful login
    if (/^[a-f0-9]{64}$/.test(applicant.passwordHash)) {
      const legacySha = createHash('sha256').update(password).digest('hex');
      if (applicant.passwordHash !== legacySha) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      // Compare-and-set: only upgrade if the legacy hash is still the stored value.
      const legacyHash = applicant.passwordHash;
      const upgraded = await hashPassword(password);
      const swapped = await updateStore((fresh) => {
        const current = fresh.applicants.find(a => a.id === applicant.id);
        if (current && current.passwordHash === legacyHash) {
          current.passwordHash = upgraded;
          return true;
        }
        return false;
      });
      // Credentials changed while hashing: no session for the stale password.
      if (!swapped) return res.status(401).json({ error: 'Invalid email or password' });
    } else if (!(await verifyPassword(password, applicant.passwordHash))) {
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
      ...sanitizeApplicant(applicant),
      completeness: calculateCompleteness(applicant),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch profile' });
  }
});

// PATCH /api/applicants/me — update applicant profile; password change triggers token revocation
router.patch('/me', authenticateApplicant, async (req: AuthRequest, res) => {
  // Read the raw auth token from the Authorization header since authenticateApplicant
  // consumes it and attaches req.applicant. We need the token's jti for revocation.
  const rawToken = req.headers['authorization']?.split(' ')[1];
  if (!rawToken) return res.status(401).json({ error: 'Applicant authentication token required' });

  try {
    const payload = await verifyApplicantToken(rawToken);
    const password = req.body?.password;
    const safeUpdates = profileUpdates(req.body);
    if (!safeUpdates) return res.status(400).json({ error: 'Invalid applicant update' });
    let newPasswordHash: string | undefined;
    if (password) {
      const store = await readStore();
      if (!store.applicants.some(a => a.id === payload.sub)) return res.status(404).json({ error: 'Applicant not found' });
      // Password change — revoke all tokens for this applicant
      await revokeAllForUser(payload.sub, 'Applicant', payload.jti, 604800);
      newPasswordHash = await hashPassword(password);
    }

    const updated = await updateStore((store) => {
      const index = store.applicants.findIndex(a => a.id === payload.sub);
      if (index === -1) return null;
      store.applicants[index] = {
        ...store.applicants[index],
        ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}),
        ...safeUpdates,
        updatedAt: now(),
      };
      return store.applicants[index];
    });
    if (!updated) return res.status(404).json({ error: 'Applicant not found' });

    res.json({
      ...sanitizeApplicant(updated),
      completeness: calculateCompleteness(updated),
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
    const safeUpdates = profileUpdates(req.body);
    if (!safeUpdates) return res.status(400).json({ error: 'Invalid applicant profile' });

    const applicant = {
      id: generateId(),
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email || null,
      passwordHash: null,
      phone: req.body.phone,
      preferredContactMethod: req.body.preferredContactMethod || 'email',
      address: safeUpdates.address || { state: '', zip: '' },
      educationHistory: safeUpdates.educationHistory || [],
      employmentHistory: safeUpdates.employmentHistory || [],
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

    await updateStore((store) => {
      store.applicants.push(applicant);
    });

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

    res.status(201).json(sanitizeApplicant(applicant));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create applicant' });
  }
});

// GET /api/applicants/:id — owner or member-services only.
router.get('/:id', authenticate, async (req: UserAuthRequest, res) => {
  if (!canAccessApplicant(req)) return res.status(403).json({ error: 'Insufficient permissions' });
  try {
    const store = await readStore();
    const applicant = store.applicants.find(a => a.id === req.params.id);
    if (!applicant) return res.status(404).json({ error: 'Applicant not found' });

    const hires = store.hires.filter(h => h.applicantId === applicant.id);
    res.json({ ...sanitizeApplicant(applicant), hires });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch applicant' });
  }
});

// PUT /api/applicants/:id — authenticated, allow-listed profile update.
router.put('/:id', authenticate, async (req: UserAuthRequest, res) => {
  if (!canAccessApplicant(req)) return res.status(403).json({ error: 'Insufficient permissions' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Invalid applicant update' });
  }
  if (Object.hasOwn(req.body, 'passwordHash')) {
    return res.status(400).json({ error: 'passwordHash cannot be set via this endpoint' });
  }
  const safeUpdates = profileUpdates(req.body);
  if (!safeUpdates) return res.status(400).json({ error: 'Invalid applicant update' });
  try {
    const updated = await updateStore((store) => {
      const index = store.applicants.findIndex(a => a.id === req.params.id);
      if (index === -1) return { kind: 'not-found' as const };

      store.applicants[index] = { ...store.applicants[index], ...safeUpdates, updatedAt: now() };
      return { kind: 'updated' as const, applicant: store.applicants[index] };
    });
    if (updated.kind === 'not-found') return res.status(404).json({ error: 'Applicant not found' });
    res.json(sanitizeApplicant(updated.applicant));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update applicant' });
  }
});

// POST /api/applicants/:id/apply — legacy convenience endpoint
router.post('/:id/apply', async (req: any, res) => {
  try {
    const outcome = await updateStore((store) => {
      const applicant = store.applicants.find(a => a.id === req.params.id);
      if (!applicant) return { kind: 'applicant-not-found' as const };
      if (!req.body.jobPostingId) return { kind: 'missing-job' as const };

      // Duplicate check
      const existing = store.applications.find(
        a => a.applicantId === applicant.id && a.jobPostingId === req.body.jobPostingId
      );
      if (existing) return { kind: 'duplicate' as const, applicationId: existing.id };

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
      return { kind: 'created' as const, application };
    });
    if (outcome.kind === 'applicant-not-found') return res.status(404).json({ error: 'Applicant not found' });
    if (outcome.kind === 'missing-job') return res.status(400).json({ error: 'jobPostingId is required' });
    if (outcome.kind === 'duplicate') return res.status(409).json({ error: 'Already applied to this job', applicationId: outcome.applicationId });
    const application = outcome.application;

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

    // bcrypt first; the helper consumes the token and writes the hash in one transaction.
    const reset = await resetPasswordWithToken(token, await hashPassword(newPassword));
    if (!reset.ok) {
      const messages = {
        invalid: 'Invalid reset token',
        used: 'Reset token has already been used',
        expired: 'Reset token has expired',
        no_applicant: 'Invalid reset token',
      } as const;
      return res.status(401).json({ error: messages[reset.reason] });
    }
    const resetApplicantId = reset.applicantId;

    // Revoke all existing JWTs only after the password change has committed
    await revokeAllForUser(resetApplicantId, 'Applicant');

    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'password_reset_completed',
      entityType: 'Applicant',
      entityId: resetApplicantId,
      userId: resetApplicantId,
      details: {},
      outcome: 'success',
    });

    res.json({ message: 'Password has been reset successfully. Please log in with your new password.' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to reset password' });
  }
});

// ─── OAuth / Social Login ───────────────────────────────────────────────────────

function redirectToLoginError(res: any, message: string) {
  return res.redirect(`/dashboard/login?error=${encodeURIComponent(message)}`);
}

function wantsJson(req: any): boolean {
  return req.get('accept')?.includes('application/json') ?? false;
}

function oauthFailure(req: any, res: any, status: number, message: string) {
  return wantsJson(req) ? res.status(status).json({ error: message }) : redirectToLoginError(res, message);
}

// GET /api/applicants/auth/google — redirect to Google authorization
router.get('/auth/google', async (req: any, res) => {
  try {
    const { redirectTo } = await initiateGoogle(resolveOAuthBaseUrl(req), safeApplicantDestination(req.query.next));
    res.redirect(302, redirectTo);
  } catch (error) {
    return oauthFailure(req, res, 503, 'Google login is not configured');
  }
});

// GET /api/applicants/auth/google/callback — handle Google OAuth callback
router.get('/auth/google/callback', async (req: any, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error) {
    recordOAuthUserDenied('google');
    return oauthFailure(req, res, 400, `Google authorization denied: ${error}`);
  }
  if (!code || !state) {
    recordOAuthValidationFailure('google');
    return oauthFailure(req, res, 400, 'Missing code or state parameter');
  }

  try {
    const result = await handleGoogleCallback(code, state, resolveOAuthBaseUrl(req));
    if (wantsJson(req)) return res.json({ token: result.token, expiresIn: result.expiresIn });
    setApplicantSessionCookie(res, result.token);
    return res.redirect(result.next);
  } catch (err) {
    return oauthFailure(req, res, 401, err instanceof Error ? err.message : 'OAuth callback failed');
  }
});

// GET /api/applicants/auth/linkedin — redirect to LinkedIn authorization
router.get('/auth/linkedin', async (req: any, res) => {
  try {
    const { redirectTo } = await initiateLinkedIn(resolveOAuthBaseUrl(req), safeApplicantDestination(req.query.next));
    res.redirect(302, redirectTo);
  } catch (error) {
    return oauthFailure(req, res, 503, 'LinkedIn login is not configured');
  }
});

// GET /api/applicants/auth/linkedin/callback — handle LinkedIn OAuth callback
router.get('/auth/linkedin/callback', async (req: any, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error) {
    recordOAuthUserDenied('linkedin');
    return oauthFailure(req, res, 400, `LinkedIn authorization denied: ${error}`);
  }
  if (!code || !state) {
    recordOAuthValidationFailure('linkedin');
    return oauthFailure(req, res, 400, 'Missing code or state parameter');
  }

  try {
    const result = await handleLinkedInCallback(code, state, resolveOAuthBaseUrl(req));
    if (wantsJson(req)) return res.json({ token: result.token, expiresIn: result.expiresIn });
    setApplicantSessionCookie(res, result.token);
    return res.redirect(result.next);
  } catch (err) {
    return oauthFailure(req, res, 401, err instanceof Error ? err.message : 'OAuth callback failed');
  }
});

// GET /api/applicants/auth/facebook — redirect to Facebook authorization
router.get('/auth/facebook', async (req: any, res) => {
  try {
    const { redirectTo } = await initiateFacebook(resolveOAuthBaseUrl(req), safeApplicantDestination(req.query.next));
    res.redirect(302, redirectTo);
  } catch (error) {
    return oauthFailure(req, res, 503, 'Facebook login is not configured');
  }
});

// GET /api/applicants/auth/facebook/callback — handle Facebook OAuth callback
router.get('/auth/facebook/callback', async (req: any, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error) {
    recordOAuthUserDenied('facebook');
    return oauthFailure(req, res, 400, `Facebook authorization denied: ${error}`);
  }
  if (!code || !state) {
    recordOAuthValidationFailure('facebook');
    return oauthFailure(req, res, 400, 'Missing code or state parameter');
  }

  try {
    const result = await handleFacebookCallback(code, state, resolveOAuthBaseUrl(req));
    if (wantsJson(req)) return res.json({ token: result.token, expiresIn: result.expiresIn });
    setApplicantSessionCookie(res, result.token);
    return res.redirect(result.next);
  } catch (err) {
    return oauthFailure(req, res, 401, err instanceof Error ? err.message : 'OAuth callback failed');
  }
});

export default router;
