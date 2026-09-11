import { Router } from 'express';
import { readStore, writeStore, generateId, now, addObservabilityEntry } from '../models/store.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// GET /api/mcp/jobs - MCP-compatible endpoint: List active jobs
router.get('/jobs', async (_req, res) => {
  try {
    const store = await readStore();
    const activeJobs = store.jobs.filter(j => j.isActive);
    res.json({ data: activeJobs, count: activeJobs.length, type: 'job_listing' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'MCP query failed' });
  }
});

// GET /api/mcp/applications - MCP-compatible endpoint: List applications
router.get('/applications', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const store = await readStore();
    const apps = req.user.role === 'applicant'
      ? store.applications.filter(a => a.applicantId === req.user.id)
      : store.applications;
    res.json({ data: apps, count: apps.length, type: 'application_listing' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'MCP query failed' });
  }
});

// POST /api/mcp/apply - MCP-compatible endpoint: Submit application
router.post('/apply', async (req: any, res) => {
  try {
    const store = await readStore();
    const { applicantId, jobPostingId } = req.body;

    const applicant = store.applicants.find(a => a.id === applicantId);
    const job = store.jobs.find(j => j.id === jobPostingId);
    if (!applicant || !job) return res.status(404).json({ error: 'Applicant or job not found' });
    if (!job.isActive) return res.status(400).json({ error: 'Job is no longer active' });

    const application = {
      id: generateId(),
      applicantId,
      jobPostingId,
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
    job.currentApplications += 1;
    if (job.currentApplications >= job.totalOpenings) job.isActive = false;

    await writeStore(store);

    res.json({ success: true, application, type: 'application_submitted' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'MCP apply failed' });
  }
});

// GET /api/mcp/hires - MCP-compatible endpoint: List hires
router.get('/hires', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const store = await readStore();
    res.json({ data: store.hires, count: store.hires.length, type: 'hire_listing' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'MCP query failed' });
  }
});

// GET /api/mcp/health - MCP health check
router.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'New Fronteir Recruiting MCP', timestamp: now() });
});

export default router;
