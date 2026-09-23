import { Router } from 'express';
import { readStore, writeStore, generateId, now, addObservabilityEntry } from '../models/store.js';
import { validateApplicationBody } from '../middleware/validation.js';
import { createApplication, calculateMatchScore } from '../services/matching.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// POST /api/applications - Submit a new application
router.post('/', async (req: any, res) => {
  try {
    // story-slop-cleanup-screening-vectorstore: `false` is already
    // validateApplicationBody's default for requireProfile.
    // const validation = validateApplicationBody(req.body, false);
    const validation = validateApplicationBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({ errors: validation.errors });
    }

    const store = await readStore();
    const job = store.jobs.find(j => j.id === req.body.jobPostingId);

    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.isActive) return res.status(400).json({ error: 'Job is no longer accepting applications' });

    // Resolve applicant: authenticated applicant takes priority, else body.applicantId
    const applicantId = (req.user?.role === 'applicant' ? req.user.id : req.body.applicantId);
    const applicant = store.applicants.find(a => a.id === applicantId);
    if (!applicant) return res.status(404).json({ error: 'Applicant not found' });

    // Duplicate application check
    const existing = store.applications.find(
      a => a.applicantId === applicantId && a.jobPostingId === req.body.jobPostingId
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
    const { matchScore, keywordMatches, educationMatchScore, experienceMatchScore } = calculateMatchScore(applicant, job);

    // Check email confirmation
    const emailConfirmed = req.body.email === req.body.emailConfirmation;

    const application = {
      id: generateId(),
      applicantId: applicant.id,
      jobPostingId: job.id,
      status: 'pending' as const,
      matchScore,
      keywordMatches,
      educationMatchScore,
      experienceMatchScore,
      appliedAt: now(),
      updatedAt: now(),
      emailConfirmed,
    };

    store.applications.push(application);
    
    // Increment current applications count
    job.currentApplications += 1;
    
    // Check auto-close
    if (job.currentApplications >= job.totalOpenings) {
      job.isActive = false;
    }

    // Update applicant
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
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to submit application' });
  }
});

// GET /api/applications - List all applications (role-based)
router.get('/', requireRole(['applicant', 'recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const store = await readStore();
    if (req.user.role === 'applicant') {
      const apps = store.applications.filter(a => a.applicantId === req.user.id);
      res.json(apps);
    } else {
      res.json(store.applications);
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch applications' });
  }
});

// GET /api/applications/:id - Get application details
router.get('/:id', async (req, res) => {
  try {
    const store = await readStore();
    const app = store.applications.find(a => a.id === req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    res.json(app);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch application' });
  }
});

// PUT /api/applications/:id/status - Update application status
router.put('/:id/status', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'reviewed', 'accepted', 'rejected', 'interview scheduled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const store = await readStore();
    const appIndex = store.applications.findIndex(a => a.id === req.params.id);
    if (appIndex === -1) return res.status(404).json({ error: 'Application not found' });

    const oldStatus = store.applications[appIndex].status;
    store.applications[appIndex].status = status;
    store.applications[appIndex].updatedAt = now();

    // If accepted, create hire record
    if (status === 'accepted') {
      const app = store.applications[appIndex];
      const applicant = store.applicants.find(a => a.id === app.applicantId);
      const job = store.jobs.find(j => j.id === app.jobPostingId);

      if (applicant && job) {
        const hireRecord = {
          id: generateId(),
          applicantId: applicant.id,
          companyId: job.companyId,
          jobPostingId: job.id,
          hireDate: now(),
          positionTitle: job.jobTitle,
          status: 'active' as const,
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
});

// GET /api/hires - List all hires
router.get('/hires', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const store = await readStore();
    if (req.user.role === 'hiring-manager') {
      const companyJobs = store.jobs.filter(j => j.companyId === req.user.companyId);
      const hireIds = new Set(companyJobs.flatMap(j => store.applications.filter(a => a.jobPostingId === j.id && a.status === 'accepted').map(a => a.id)));
      const hires = store.hires.filter(h => companyJobs.some(j => j.id === h.jobPostingId));
      res.json(hires);
    } else {
      res.json(store.hires);
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch hires' });
  }
});

// GET /api/companies/:id/hires - Get all new hires for a company
router.get('/companies/:id/hires', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const store = await readStore();
    const hires = store.hires.filter(h => h.companyId === req.params.id);
    res.json(hires);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch hires' });
  }
});

export default router;
