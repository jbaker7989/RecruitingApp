import { Router } from 'express';
import { readStore, writeStore, generateId, now, addObservabilityEntry } from '../models/store.js';
import { validateJobBody } from '../middleware/validation.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// POST /api/companies - Create new company
router.post('/', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const company = {
      id: generateId(),
      companyName: req.body.companyName,
      description: req.body.description || '',
      location: req.body.location || '',
      companySize: req.body.companySize || '',
      industry: req.body.industry || '',
      createdAt: now(),
      updatedAt: now(),
    };

    const store = await readStore();
    store.companies.push(company);
    await writeStore(store);

    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'create',
      entityType: 'Company',
      entityId: company.id,
      userId: req.user?.id || 'unknown',
      details: { companyName: company.companyName },
      outcome: 'success',
    });

    res.status(201).json(company);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create company' });
  }
});

// GET /api/companies - List all companies
router.get('/', async (_req, res) => {
  try {
    const store = await readStore();
    res.json(store.companies);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch companies' });
  }
});

// GET /api/companies/:id - Get company with its job postings
router.get('/:id', async (req, res) => {
  try {
    const store = await readStore();
    const company = store.companies.find(c => c.id === req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const companyJobs = store.jobs.filter(j => j.companyId === company.id);
    res.json({
      ...company,
      jobPostings: companyJobs,
      activeJobCount: companyJobs.filter(j => j.isActive).length,
      totalJobCount: companyJobs.length,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch company' });
  }
});

// PUT /api/companies/:id - Update company
router.put('/:id', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const store = await readStore();
    const index = store.companies.findIndex(c => c.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Company not found' });

    store.companies[index] = { ...store.companies[index], ...req.body, updatedAt: now() };
    await writeStore(store);
    res.json(store.companies[index]);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update company' });
  }
});

// DELETE /api/companies/:id - Delete company
router.delete('/:id', requireRole(['member-services']), async (req, res) => {
  try {
    const store = await readStore();
    store.companies = store.companies.filter(c => c.id !== req.params.id);
    await writeStore(store);
    res.json({ message: 'Company deleted' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete company' });
  }
});

// GET /api/companies/:id/active-jobs - Get only active jobs for a company
router.get('/:id/active-jobs', async (req, res) => {
  try {
    const store = await readStore();
    const activeJobs = store.jobs.filter(j => j.companyId === req.params.id && j.isActive);
    res.json(activeJobs);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch active jobs' });
  }
});

export default router;
