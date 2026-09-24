import { Router } from 'express';
import { readStore, writeStore, generateId, now, addObservabilityEntry } from '../models/store.js';
import { validateApplicationBody } from '../middleware/validation.js';
import { calculateMatchScore } from '../services/matching.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// ponytail: in-process lock per pair; per-store mutex or DB row-lock when persistence moves to a real DB.
// Prevents TOCTOU race between duplicate-check read and write in POST /api/applications.
const activeApplicationLocks = new Set<string>();

// ─── Shared submit logic — wrapped by auth + lock in the POST handler ──────────

async function submitApplication(req: any, res: any, applicantId: string) {
  const store = await readStore();
  const job = store.jobs.find((j: any) => j.id === req.body.jobPostingId);

  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.isActive) return res.status(400).json({ error: 'Job is no longer accepting applications' });

  const applicant = store.applicants.find((a: any) => a.id === applicantId);
  if (!applicant) return res.status(404).json({ error: 'Applicant not found' });

  // Duplicate check
  const existing = store.applications.find(
    (a: any) => a.applicantId === applicantId && a.jobPostingId === req.body.jobPostingId,
  );
  if (existing) {
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'apply',
      entityType: 'Application',
      entityId: existing.id,
      userId: applicantId,
      details: { jobPostingId: req.body.jobPostingId, duplicate: true },
      outcome: 'failure',
    });
    return res.status(409).json({ error: 'Already applied to this job', applicationId: existing.id });
  }

  // Calculate match score
  const { matchScore, keywordMatches, educationMatchScore, experienceMatchScore } =
    calculateMatchScore(applicant, job);

  const emailConfirmed = req.body.email === req.body.emailConfirmation;

  const application: any = {
    id: generateId(),
    applicantId: applicant.id,
    jobPostingId: job.id,
    status: 'pending',
    matchScore,
    keywordMatches,
    educationMatchScore,
    experienceMatchScore,
    appliedAt: now(),
    updatedAt: now(),
    emailConfirmed,
  };

  store.applications.push(application);
  job.currentApplications += 1;
  if (job.currentApplications >= job.totalOpenings) job.isActive = false;
  applicant.updatedAt = now();

  await writeStore(store);
  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action: 'apply',
    entityType: 'Application',
    entityId: application.id,
    userId: applicant.id,
    details: { jobId: job.id, matchScore },
    outcome: 'success',
  });

  res.status(201).json(application);
}

// ─── POST /api/applications ──────────────────────────────────────────────────

router.post('/', async (req: any, res: any) => {
  try {
    // NFR-048: reject unauthenticated calls — req.body.applicantId must not be trusted blindly
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Inject applicantId from the authenticated token — validateApplicationBody still requires it
    req.body.applicantId = req.user.id;

    const validation = validateApplicationBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({ errors: validation.errors });
    }

    // NFR-048: lock prevents two concurrent POSTs for the same applicant+job from both passing the duplicate check
    const lockKey = `${req.user.id}:${req.body.jobPostingId}`;
    if (activeApplicationLocks.has(lockKey)) {
      return res.status(409).json({ error: 'Application already in progress' });
    }
    activeApplicationLocks.add(lockKey);
    try {
      return await submitApplication(req, res, req.user.id);
    } finally {
      activeApplicationLocks.delete(lockKey);
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to apply' });
  }
});

// ─── GET /api/applications ──────────────────────────────────────────────────

router.get(
  '/',
  requireRole(['applicant', 'recruiter', 'hiring-manager', 'member-services']),
  async (req: any, res: any) => {
    try {
      const store = await readStore();
      if (req.user.role === 'applicant') {
        res.json(store.applications.filter((a: any) => a.applicantId === req.user.id));
      } else {
        res.json(store.applications);
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch applications' });
    }
  },
);

// ─── GET /api/applications/:id ──────────────────────────────────────────────

router.get('/:id', async (req: any, res: any) => {
  try {
    const store = await readStore();
    const app = store.applications.find((a: any) => a.id === req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    res.json(app);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch application' });
  }
});

// ─── PUT /api/applications/:id/status ────────────────────────────────────────

router.put(
  '/:id/status',
  requireRole(['recruiter', 'hiring-manager', 'member-services']),
  async (req: any, res: any) => {
    try {
      const { status } = req.body;
      const validStatuses = ['pending', 'reviewed', 'accepted', 'rejected', 'interview scheduled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const store = await readStore();
      const appIndex = store.applications.findIndex((a: any) => a.id === req.params.id);
      if (appIndex === -1) return res.status(404).json({ error: 'Application not found' });

      const oldStatus = store.applications[appIndex].status;
      store.applications[appIndex].status = status;
      store.applications[appIndex].updatedAt = now();

      if (status === 'accepted') {
        const app = store.applications[appIndex];
        const applicant = store.applicants.find((a: any) => a.id === app.applicantId);
        const job = store.jobs.find((j: any) => j.id === app.jobPostingId);
        if (applicant && job) {
          const hireRecord: any = {
            id: generateId(),
            applicantId: applicant.id,
            companyId: job.companyId,
            jobPostingId: job.id,
            hireDate: now(),
            positionTitle: job.jobTitle,
            status: 'active',
            notifiedEmployer: false,
            createdAt: now(),
            updatedAt: now(),
          };
          store.hires.push(hireRecord);
          applicant.hireRecords.push(hireRecord.id);
          applicant.updatedAt = now();
        }
      }

      await writeStore(store);
      await addObservabilityEntry({
        id: generateId(),
        timestamp: now(),
        action: 'status_change',
        entityType: 'Application',
        entityId: req.params.id,
        userId: req.user.id,
        details: { oldStatus, newStatus: status },
        outcome: 'success',
      });

      res.json(store.applications[appIndex]);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update status' });
    }
  },
);

// ─── GET /api/applications/hires ────────────────────────────────────────────

router.get(
  '/hires',
  requireRole(['recruiter', 'hiring-manager', 'member-services']),
  async (req: any, res: any) => {
    try {
      const store = await readStore();
      if (req.user.role === 'hiring-manager') {
        const companyJobs = store.jobs.filter((j: any) => j.companyId === req.user.companyId);
        const hires = store.hires.filter((h: any) =>
          companyJobs.some((j: any) => j.id === h.jobPostingId),
        );
        return res.json(hires);
      }
      res.json(store.hires);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch hires' });
    }
  },
);

// ─── GET /api/applications/companies/:id/hires ────────────────────────────────

router.get(
  '/companies/:id/hires',
  requireRole(['hiring-manager', 'member-services']),
  async (req: any, res: any) => {
    try {
      const store = await readStore();
      const hires = store.hires.filter((h: any) => h.companyId === req.params.id);
      res.json(hires);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch hires' });
    }
  },
);

export default router;
