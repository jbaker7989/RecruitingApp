import { Router } from 'express';
import { readStore } from '../models/store.js';
import { verifyApplicantToken } from '../services/tokenService.js';

const router = Router();

const COOKIE_OPTS = 'HttpOnly; SameSite=Lax; Path=/';

// ─── Auth middleware ─────────────────────────────────────────────────────────

/** Verify applicant JWT from cookie. Redirects to login if absent or invalid. */
async function requireApplicant(req: any, res: any, next: any) {
  const token = req.cookies?.token;
  if (!token) {
    return res.redirect(`/dashboard/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  try {
    const payload = await verifyApplicantToken(token);
    req.applicantId = payload.sub;
    next();
  } catch {
    res.clearCookie('token');
    return res.redirect(`/dashboard/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
}

// ─── Login (GET) ──────────────────────────────────────────────────────────────

router.get('/login', (req: any, res: any) => {
  const token = req.cookies?.token;
  if (token) {
    try {
      verifyApplicantToken(token);
      const next = req.query.next || '/dashboard/applications';
      return res.redirect(next);
    } catch {
      res.clearCookie('token');
    }
  }
  res.render('dashboard/login', {
    error: null,
    email: '',
    next: req.query.next || '',
  });
});

// ─── Login (POST) ─────────────────────────────────────────────────────────────

router.post('/login', async (req: any, res: any) => {
  const { email, password, next } = req.body;
  const destination = (next && typeof next === 'string') ? next : '/dashboard/applications';

  if (!email || !password) {
    return res.status(200).render('dashboard/login', {
      error: 'Email and password are required.',
      email,
      next,
    });
  }

  try {
    const store = await readStore();
    const applicant = store.applicants.find(
      (a: any) => a.email?.toLowerCase() === email.toLowerCase(),
    );
    if (!applicant) {
      return res.status(200).render('dashboard/login', {
        error: 'No account found with that email address.',
        email,
        next,
      });
    }

    // ponytail: SHA-256 check — matches applicants.ts; swap for bcrypt at scale
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(password).digest('hex');
    if (applicant.passwordHash !== hash) {
      return res.status(200).render('dashboard/login', {
        error: 'Incorrect password. Please try again.',
        email,
        next,
      });
    }

    const { signApplicantToken } = await import('../services/tokenService.js');
    const token = await signApplicantToken(applicant.id, false);

    res.setHeader('Set-Cookie', `token=${token}; ${COOKIE_OPTS}`);
    res.redirect(destination);
  } catch (err) {
    console.error('[dashboard] Login error:', err);
    res.status(200).render('dashboard/login', {
      error: 'Something went wrong. Please try again.',
      email,
      next,
    });
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────────

router.get('/logout', (req: any, res: any) => {
  res.setHeader('Set-Cookie', `token=; ${COOKIE_OPTS} Max-Age=0`);
  res.redirect('/dashboard/login');
});

// ─── Applications (GET) ──────────────────────────────────────────────────────

router.get('/applications', requireApplicant, async (req: any, res: any) => {
  try {
    const store = await readStore();
    const applications = store.applications
      .filter((a: any) => a.applicantId === req.applicantId)
      .map((a: any) => {
        const job = store.jobs.find((j: any) => j.id === a.jobPostingId);
        const company = job ? store.companies.find((c: any) => c.id === job.companyId) : null;
        const date = new Date(a.appliedAt);
        const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
        return {
          id: a.id,
          jobTitle: job?.jobTitle ?? 'Unknown Position',
          companyName: company?.companyName ?? 'Unknown Company',
          companyInitials: getInitials(company?.companyName ?? '?'),
          companyColor: getAvatarColor(company?.id ?? a.id),
          status: a.status,
          appliedDate: fmt.format(date),
          appliedAt: date,
        };
      })
      .sort((a: any, b: any) => b.appliedAt - a.appliedAt);

    const applicant = store.applicants.find((a: any) => a.id === req.applicantId);
    res.render('dashboard/layout', {
      page: 'applications',
      currentPage: 'applications',
      applications,
      applicant,
    });
  } catch (err) {
    console.error('[dashboard/applications]', err);
    res.redirect('/dashboard/login');
  }
});

// ─── Jobs Browse (GET) ───────────────────────────────────────────────────────

router.get('/jobs', requireApplicant, async (req: any, res: any) => {
  try {
    const store = await readStore();
    const myAppJobIds = new Set(
      store.applications
        .filter((a: any) => a.applicantId === req.applicantId)
        .map((a: any) => a.jobPostingId),
    );

    const jobs = store.jobs
      .filter((j: any) => j.isActive)
      .map((j: any) => {
        const company = store.companies.find((c: any) => c.id === j.companyId);
        const applied = myAppJobIds.has(j.id);
        const created = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(j.createdAt));
        return {
          id: j.id,
          title: j.jobTitle,
          companyName: company?.companyName ?? 'Unknown Company',
          companyInitials: getInitials(company?.companyName ?? '?'),
          companyColor: getAvatarColor(company?.id ?? j.id),
          location: j.positionLocation ?? 'Remote',
          type: j.type ?? 'Full-time',
          remote: j.remote ?? false,
          applied,
          postedAt: created,
        };
      });

    const applicant = store.applicants.find((a: any) => a.id === req.applicantId);
    res.render('dashboard/layout', {
      page: 'jobs',
      currentPage: 'jobs',
      jobs,
      applicant,
    });
  } catch (err) {
    console.error('[dashboard/jobs]', err);
    res.redirect('/dashboard/login');
  }
});

// ─── Apply to job (POST) ─────────────────────────────────────────────────────

router.post('/jobs/:jobId/apply', requireApplicant, async (req: any, res: any) => {
  try {
    const { jobId } = req.params;
    const store = await readStore();
    const { generateId, now } = await import('../models/store.js');

    const existing = store.applications.find(
      (a: any) => a.applicantId === req.applicantId && a.jobPostingId === jobId,
    );
    if (existing) return res.redirect('/dashboard/jobs');

    store.applications.push({
      id: generateId(),
      applicantId: req.applicantId,
      jobPostingId: jobId,
      status: 'pending',
      matchScore: 0,
      keywordMatches: [],
      educationMatchScore: 0,
      experienceMatchScore: 0,
      appliedAt: now(),
      updatedAt: now(),
      emailConfirmed: false,
    });

    const { writeStore } = await import('../models/store.js');
    await writeStore(store);
    res.redirect('/dashboard/applications');
  } catch (err) {
    console.error('[dashboard/apply]', err);
    res.redirect('/dashboard/jobs');
  }
});

// ─── Profile (GET) ────────────────────────────────────────────────────────────

router.get('/profile', requireApplicant, async (req: any, res: any) => {
  try {
    const store = await readStore();
    const applicant: any = store.applicants.find((a: any) => a.id === req.applicantId);
    if (!applicant) return res.redirect('/dashboard/login');

    const completeness = calculateCompleteness(applicant);
    const updated = req.query.updated === '1';

    res.render('dashboard/layout', {
      page: 'profile',
      currentPage: 'profile',
      applicant: {
        id: applicant.id,
        email: applicant.email,
        firstName: applicant.firstName,
        lastName: applicant.lastName,
        phone: applicant.phone,
        address: applicant.address,
        educationHistory: applicant.educationHistory ?? [],
        employmentHistory: applicant.employmentHistory ?? [],
        resumeUrl: applicant.resumeUrl ?? null,
        hasCredentials: !!(applicant.oauthProvider),
      },
      completeness,
      updated,
    });
  } catch (err) {
    console.error('[dashboard/profile]', err);
    res.redirect('/dashboard/login');
  }
});

// ─── Profile (PATCH via POST) ───────────────────────────────────────────────

router.post('/profile', requireApplicant, async (req: any, res: any) => {
  try {
    const { firstName, lastName, phone, state, zip } = req.body;
    const store = await readStore();
    const idx = store.applicants.findIndex((a: any) => a.id === req.applicantId);
    if (idx === -1) return res.redirect('/dashboard/login');

    if (firstName !== undefined) store.applicants[idx].firstName = firstName;
    if (lastName !== undefined) store.applicants[idx].lastName = lastName;
    if (phone !== undefined) store.applicants[idx].phone = phone;
    if (!store.applicants[idx].address) store.applicants[idx].address = { state: '', zip: '' };
    if (state !== undefined) store.applicants[idx].address.state = state;
    if (zip !== undefined) store.applicants[idx].address.zip = zip;

    const { writeStore } = await import('../models/store.js');
    await writeStore(store);

    res.redirect('/dashboard/profile?updated=1');
  } catch (err) {
    console.error('[dashboard/profile post]', err);
    res.redirect('/dashboard/profile');
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(id: string): string {
  const PALETTE = [
    '#4A76D4', '#2E9E4B', '#D4875A', '#7B5EA7', '#C96B3A',
    '#3A8AC2', '#8A6B4A', '#5A9A6B', '#C4A84B', '#6B5A8A',
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function calculateCompleteness(a: any): number {
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

export default router;
