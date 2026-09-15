/**
 * Agent Routes
 * API endpoints for invoking agentic workflows
 */

import { Router } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { readStore, generateId, now, addObservabilityEntry } from '../../models/store.js';
import { parseResumeFromBuffer, parseResume } from '../../chains/resumeParsing.js';
import {
  calculateMatchScore,
  getJobSuggestionsForApplicant,
  getSimilarCandidatesForJob,
  rescoreApplicationsForJob,
  rebuildSemanticIndex,
} from '../../chains/matching.js';
import {
  startInterviewScheduling,
  requestReschedule,
  cancelInterview,
  completeInterview,
  InterviewSchedulingState,
} from '../../agents/scheduling/agent.js';
import jdGeneratorRouter from './jdGenerator.js';

const router = Router();

// Mount Job Description Generator routes
router.use('/jd', jdGeneratorRouter);

// ============================================
// Resume Parsing Endpoints
// ============================================

// POST /api/agents/resume/parse - Parse a resume file
router.post('/resume/parse', requireRole(['applicant', 'recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const file = req.files?.resume;
    
    if (!file) {
      return res.status(400).json({ error: 'No resume file provided' });
    }
    
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type. Supported: PDF, DOCX' });
    }
    
    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    
    // Parse the resume
    const parsedResume = await parseResumeFromBuffer(file.data, file.mimetype);
    
    // Log the action
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'resume_parsed',
      entityType: 'Applicant',
      entityId: req.user.id,
      userId: req.user.id,
      details: {
        fileName: file.name,
        mimeType: file.mimetype,
        confidenceScores: parsedResume.confidenceScores,
      },
      outcome: 'success',
    });
    
    res.json({
      success: true,
      data: parsedResume,
    });
  } catch (error) {
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'resume_parsed',
      entityType: 'Applicant',
      entityId: req.user.id,
      userId: req.user.id,
      details: { error: error instanceof Error ? error.message : String(error) },
      outcome: 'failure',
    });
    
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to parse resume' });
  }
});

// POST /api/agents/resume/parse-text - Parse resume from text input
router.post('/resume/parse-text', requireRole(['applicant', 'recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { resumeText } = req.body;
    
    if (!resumeText || resumeText.trim().length === 0) {
      return res.status(400).json({ error: 'Resume text is required' });
    }
    
    const parsedResume = await parseResume(resumeText);
    
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'resume_parsed',
      entityType: 'Applicant',
      entityId: req.user.id,
      userId: req.user.id,
      details: { source: 'text_input', confidenceScores: parsedResume.confidenceScores },
      outcome: 'success',
    });
    
    res.json({
      success: true,
      data: parsedResume,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to parse resume' });
  }
});

// ============================================
// Semantic Matching Endpoints
// ============================================

// POST /api/agents/matching/score - Calculate match score for applicant-job pair
router.post('/matching/score', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { applicantId, jobId } = req.body;
    
    if (!applicantId || !jobId) {
      return res.status(400).json({ error: 'applicantId and jobId are required' });
    }
    
    const result = await calculateMatchScore(applicantId, jobId);
    
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'matching_computed',
      entityType: 'Application',
      entityId: `${applicantId}_${jobId}`,
      userId: req.user.id,
      details: { applicantId, jobId, finalScore: result.finalScore },
      outcome: 'success',
    });
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to calculate match score' });
  }
});

// GET /api/agents/matching/job-suggestions/:applicantId - Get job suggestions for applicant
router.get('/matching/job-suggestions/:applicantId', requireRole(['applicant', 'recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { applicantId } = req.params;
    const { excludeApplied, limit } = req.query;
    
    // Get applicant's existing applications
    const store = await readStore();
    const appliedJobIds = excludeApplied !== 'false'
      ? store.applications.filter(a => a.applicantId === applicantId).map(a => a.jobPostingId)
      : [];
    
    const suggestions = await getJobSuggestionsForApplicant(
      applicantId,
      appliedJobIds,
      parseInt(limit as string) || 5
    );
    
    res.json({
      success: true,
      data: suggestions,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get job suggestions' });
  }
});

// GET /api/agents/matching/similar-candidates/:jobId - Find similar candidates for a job
router.get('/matching/similar-candidates/:jobId', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { jobId } = req.params;
    const { limit } = req.query;
    
    const candidates = await getSimilarCandidatesForJob(
      jobId,
      parseInt(limit as string) || 10
    );
    
    res.json({
      success: true,
      data: candidates,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to find similar candidates' });
  }
});

// POST /api/agents/matching/rescore/:jobId - Rescore all applications for a job
router.post('/matching/rescore/:jobId', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { jobId } = req.params;
    
    const result = await rescoreApplicationsForJob(jobId);
    
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'applications_rescored',
      entityType: 'Job',
      entityId: jobId,
      userId: req.user.id,
      details: result,
      outcome: result.errors > 0 ? 'failure' : 'success',
    });
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to rescore applications' });
  }
});

// POST /api/agents/matching/rebuild-index - Rebuild entire semantic index
router.post('/matching/rebuild-index', requireRole(['member-services']), async (req: any, res) => {
  try {
    const result = await rebuildSemanticIndex();
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to rebuild index' });
  }
});

// ============================================
// Interview Scheduling Endpoints
// ============================================

// POST /api/agents/scheduling/interview - Start interview scheduling workflow
router.post('/scheduling/interview', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { applicationId, interviewerIds, proposedTimes, durationMinutes } = req.body;
    
    if (!applicationId || !interviewerIds?.length) {
      return res.status(400).json({ error: 'applicationId and interviewerIds are required' });
    }
    
    const store = await readStore();
    const application = store.applications.find(a => a.id === applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    const job = store.jobs.find(j => j.id === application.jobPostingId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const applicant = store.applicants.find(a => a.id === application.applicantId);
    if (!applicant) {
      return res.status(404).json({ error: 'Applicant not found' });
    }
    
    const finalState = await startInterviewScheduling(
      applicationId,
      applicant.id,
      job.id,
      job.companyId,
      interviewerIds,
      proposedTimes
    );
    
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'agent_invoked',
      entityType: 'Interview',
      entityId: applicationId,
      userId: req.user.id,
      details: { agent: 'scheduling', finalState: finalState.currentState },
      outcome: 'success',
    });
    
    res.json({
      success: true,
      data: finalState,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to start scheduling' });
  }
});

// POST /api/agents/scheduling/reschedule - Request interview reschedule
router.post('/scheduling/reschedule', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { currentState } = req.body;
    
    if (!currentState) {
      return res.status(400).json({ error: 'currentState is required' });
    }
    
    const finalState = await requestReschedule(currentState);
    
    res.json({
      success: true,
      data: finalState,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to request reschedule' });
  }
});

// POST /api/agents/scheduling/cancel - Cancel an interview
router.post('/scheduling/cancel', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { currentState, reason } = req.body;
    
    if (!currentState) {
      return res.status(400).json({ error: 'currentState is required' });
    }
    
    const finalState = await cancelInterview(currentState, reason);
    
    res.json({
      success: true,
      data: finalState,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to cancel interview' });
  }
});

// POST /api/agents/scheduling/complete - Mark interview as completed
router.post('/scheduling/complete', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { currentState } = req.body;
    
    if (!currentState) {
      return res.status(400).json({ error: 'currentState is required' });
    }
    
    const finalState = await completeInterview(currentState);
    
    res.json({
      success: true,
      data: finalState,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to complete interview' });
  }
});

export default router;
