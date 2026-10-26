import { Router } from 'express';
import { readStore, updateStore, generateId, now, addObservabilityEntry } from '../models/store.js';
import type { JobPosting } from '../models/store.js';
import { validateJobBody, validateApplicationBody } from '../middleware/validation.js';
import { requireRole } from '../middleware/auth.js';
import { createApplication, calculateMatchScore } from '../services/matching.js';

const router = Router();

// POST /api/jobs - Create new job posting
router.post('/', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const validation = validateJobBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({ errors: validation.errors });
    }

    const job = {
      id: generateId(),
      companyId: req.body.companyId,
      jobTitle: req.body.jobTitle,
      positionDescription: req.body.positionDescription,
      requirements: req.body.requirements || [],
      positionLocation: req.body.positionLocation,
      payRange: req.body.payRange || { min: 0, max: 0, currency: 'USD' },
      responsibilities: req.body.responsibilities || [],
      qualifications: req.body.qualifications || [],
      requiredSkills: req.body.requiredSkills || [],
      requiredExperience: req.body.requiredExperience || 0,
      reportsTo: req.body.reportsTo || 'N/A',
      isActive: true,
      totalOpenings: req.body.totalOpenings || 1,
      currentApplications: 0,
      createdAt: now(),
      updatedAt: now(),
    };

    const created = await updateStore(store => {
      if (!store.companies.some(c => c.id === job.companyId)) return false;
      store.jobs.push(job);
      return true;
    });
    if (!created) {
      return res.status(404).json({ error: 'Company not found' });
    }

    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'create',
      entityType: 'Job',
      entityId: job.id,
      userId: req.user?.id || 'unknown',
      details: { jobTitle: job.jobTitle },
      outcome: 'success',
    });

    res.status(201).json(job);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create job' });
  }
});

// POST /api/jobs/import - Mass import jobs from CSV or JSON
router.post('/import', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { companyId, format, data } = req.body;
    
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    // Early check keeps the existing 404-before-format ordering; the mutator rechecks before commit.
    const snapshot = await readStore();
    if (!snapshot.companies.some(c => c.id === companyId)) {
      return res.status(404).json({ error: 'Company not found' });
    }

    let rows: any[] = [];
    
    if (format === 'csv') {
      const Papa = await import('papaparse');
      const result = Papa.default.parse(data, { header: true, skipEmptyLines: true });
      rows = result.data;
    } else if (format === 'json') {
      const parsed = JSON.parse(data);
      rows = Array.isArray(parsed) ? parsed : parsed.jobs || [];
    } else {
      return res.status(400).json({ error: 'format must be csv or json' });
    }

    const nowStr = now();
    const importResult = { totalRows: rows.length, successes: 0, failures: 0, errors: [] as string[], jobsCreated: [] as string[] };
    const candidates: JobPosting[] = [];

    for (const row of rows) {
      try {
        const reqStr = String(row.requirements ?? '');
        const respStr = String(row.responsibilities || '');
        const qualStr = String(row.qualifications || '');
        const skillStr = String(row.requiredSkills || row.skills || '');
        
        const job = {
          id: generateId(),
          companyId,
          jobTitle: String(row.jobTitle || row.title || 'Untitled'),
          positionDescription: String(row.positionDescription || row.description || ''),
          requirements: reqStr ? reqStr.split(';').map((s: string) => s.trim()).filter(Boolean) : [],
          positionLocation: String(row.positionLocation || row.location || ''),
          payRange: { min: Number(row.payMin) || 0, max: Number(row.payMax) || 0, currency: String(row.payCurrency || 'USD') },
          responsibilities: respStr ? respStr.split(';').map((s: string) => s.trim()).filter(Boolean) : [],
          qualifications: qualStr ? qualStr.split(';').map((s: string) => s.trim()).filter(Boolean) : [],
          requiredSkills: skillStr ? skillStr.split(';').map((s: string) => s.trim()).filter(Boolean) : [],
          requiredExperience: Number(row.requiredExperience) || 0,
          reportsTo: String(row.reportsTo || 'N/A'),
          isActive: true,
          totalOpenings: Number(row.totalOpenings || row.openings || 1),
          currentApplications: 0,
          createdAt: nowStr,
          updatedAt: nowStr,
        };

        candidates.push(job);
        importResult.successes++;
        importResult.jobsCreated.push(job.id);
      } catch (err) {
        importResult.failures++;
        importResult.errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    // All successfully parsed rows commit together; counts are only reported after commit.
    const committed = await updateStore(store => {
      if (!store.companies.some(c => c.id === companyId)) return false;
      store.jobs.push(...candidates);
      return true;
    });
    if (!committed) {
      return res.status(404).json({ error: 'Company not found' });
    }

    await addObservabilityEntry({
      id: generateId(),
      timestamp: nowStr,
      action: 'import',
      entityType: 'Job',
      entityId: companyId,
      userId: req.user?.id || 'unknown',
      details: importResult,
      outcome: 'success',
    });

    res.json(importResult);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Import failed' });
  }
});

// GET /api/jobs - List all active job postings with company info
router.get('/', async (_req, res) => {
  try {
    const store = await readStore();
    const activeJobs = store.jobs.filter(j => j.isActive);
    const jobsWithCompany = await Promise.all(
      activeJobs.map(async (job) => {
        const company = store.companies.find(c => c.id === job.companyId);
        return {
          ...job,
          companyInfo: company ? {
            companyName: company.companyName,
            description: company.description,
            location: company.location,
            companySize: company.companySize,
            industry: company.industry,
          } : null,
        };
      })
    );
    res.json(jobsWithCompany);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch jobs' });
  }
});

// GET /api/jobs/:id - Get single job with full company details
router.get('/:id', async (req, res) => {
  try {
    const store = await readStore();
    const job = store.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const company = store.companies.find(c => c.id === job.companyId);
    res.json({
      ...job,
      companyInfo: company ? {
        companyName: company.companyName,
        description: company.description,
        location: company.location,
        companySize: company.companySize,
        industry: company.industry,
      } : null,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch job' });
  }
});

// PUT /api/jobs/:id - Update job posting
router.put('/:id', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const updatedAt = now();
    const updated = await updateStore(store => {
      const jobIndex = store.jobs.findIndex(j => j.id === req.params.id);
      if (jobIndex === -1) return null;
      store.jobs[jobIndex] = { ...store.jobs[jobIndex], ...req.body, updatedAt };
      return store.jobs[jobIndex];
    });
    if (!updated) return res.status(404).json({ error: 'Job not found' });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update job' });
  }
});

// DELETE /api/jobs/:id - Delete job posting
router.delete('/:id', requireRole(['hiring-manager', 'member-services']), async (req, res) => {
  try {
    await updateStore(store => {
      store.jobs = store.jobs.filter(j => j.id !== req.params.id);
    });
    res.json({ message: 'Job deleted' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete job' });
  }
});

export default router;
