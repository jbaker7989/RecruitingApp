import { Router } from 'express';
import { readStore, updateStore, generateId, now, addObservabilityEntry } from '../models/store.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// NFR-093: PUT may change only these fields. id, createdAt and updatedAt are server-owned.
const UPDATABLE_COMPANY_FIELDS = ['companyName', 'description', 'location', 'companySize', 'industry'] as const;
type UpdatableCompanyField = (typeof UPDATABLE_COMPANY_FIELDS)[number];
const COMPANY_FIELD_MAX_LENGTH: Record<UpdatableCompanyField, number> = {
  companyName: 200,
  description: 5000,
  location: 200,
  companySize: 100,
  industry: 200,
};

type CompanyUpdateResult =
  | { ok: true; changes: Partial<Record<UpdatableCompanyField, string>> }
  | { ok: false; error: string };

// Own keys only (Object.keys), so `__proto__`, `constructor` and inherited names are rejected as unknown.
export function validateCompanyUpdate(body: unknown): CompanyUpdateResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const allowed = new Set<string>(UPDATABLE_COMPANY_FIELDS);
  const keys = Object.keys(body);
  const unknown = keys.filter(key => !allowed.has(key));
  if (unknown.length > 0) {
    return { ok: false, error: `Unsupported fields: ${unknown.slice(0, 10).join(', ')}` };
  }
  if (keys.length === 0) {
    return { ok: false, error: `Provide at least one of: ${UPDATABLE_COMPANY_FIELDS.join(', ')}` };
  }
  const changes: Partial<Record<UpdatableCompanyField, string>> = {};
  for (const key of keys as UpdatableCompanyField[]) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value !== 'string') return { ok: false, error: `${key} must be a string` };
    if (key === 'companyName' && value.trim().length === 0) return { ok: false, error: 'companyName must not be blank' };
    if (value.length > COMPANY_FIELD_MAX_LENGTH[key]) {
      return { ok: false, error: `${key} must be at most ${COMPANY_FIELD_MAX_LENGTH[key]} characters` };
    }
    changes[key] = value;
  }
  return { ok: true, changes };
}

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

    // Company insert and the creator's link commit together, or neither does.
    await updateStore((store) => {
      store.companies.push(company);

      // Link the creating hiring-manager to this company so their /hires filter works
      if (req.user?.role === 'hiring-manager') {
        const userIndex = store.users.findIndex((u: any) => u.id === req.user.id);
        if (userIndex !== -1) store.users[userIndex].companyId = company.id;
      }
    });

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
    const parsed = validateCompanyUpdate(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const updatedAt = now();
    const outcome = await updateStore((store) => {
      const index = store.companies.findIndex(c => c.id === req.params.id);
      if (index === -1) return { kind: 'not-found' as const };
      store.companies[index] = { ...store.companies[index], ...parsed.changes, updatedAt };
      return { kind: 'updated' as const, company: store.companies[index] };
    });
    if (outcome.kind === 'not-found') return res.status(404).json({ error: 'Company not found' });
    res.json(outcome.company);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update company' });
  }
});

// DELETE /api/companies/:id - Delete company
router.delete('/:id', requireRole(['member-services']), async (req, res) => {
  try {
    // A missing id has always answered 200 here; the mutator simply removes nothing.
    await updateStore((store) => {
      store.companies = store.companies.filter(c => c.id !== req.params.id);
    });
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
