import { Router } from 'express';
import { readStore, writeStore, generateId, now, addObservabilityEntry } from '../models/store.js';
import { validateApplicationBody } from '../middleware/validation.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// POST /api/applicants - Create new applicant
router.post('/', async (req: any, res) => {
  try {
    const validation = validateApplicationBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({ errors: validation.errors });
    }

    const store = await readStore();
    const applicant = {
      id: generateId(),
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
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

// GET /api/applicants/:id - Get applicant profile including hireRecords
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

// PUT /api/applicants/:id - Update applicant profile
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

// POST /api/applicants/:id/apply - Submit application for a job (convenience endpoint)
router.post('/:id/apply', async (req: any, res) => {
  try {
    const store = await readStore();
    const applicant = store.applicants.find(a => a.id === req.params.id);
    if (!applicant) return res.status(404).json({ error: 'Applicant not found' });

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

export default router;
