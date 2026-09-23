/**
 * Agent Routes
 * API endpoints for invoking agentic workflows
 */

import { Router } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { readStore, writeStore, generateId, now, addObservabilityEntry } from '../../models/store.js';
import type { ScreeningRequest, ScreeningJobResponse, ScreeningResult, CandidateInput } from '../../types/screening.js';
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
import candidateCommunicationRouter from './candidateCommunication.js';

const router = Router();

// Mount Job Description Generator routes
router.use('/jd', jdGeneratorRouter);

// Mount Candidate Communication routes
router.use('/communication', candidateCommunicationRouter);

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

// ============================================
// Candidate Screening Workflow Endpoints
// ============================================

const SCREENING_SERVICE_URL =
  process.env.SCREENING_SERVICE_URL || 'http://localhost:8001';

/**
 * POST /api/agents/screening/screen
 * Submit a batch screening job for a job posting.
 * Runs the LangGraph parallel candidate processing workflow.
 */
router.post(
  '/screening/screen',
  requireRole(['recruiter', 'hiring-manager', 'member-services']),
  async (req: any, res) => {
    try {
      const { jobId, applications, scoreThreshold } = req.body as {
        jobId: string;
        applications: Array<{
          applicationId: string;
          applicantId: string;
          applicantName: string;
          resumeText: string;
        }>;
        scoreThreshold?: number;
      };

      if (!jobId || !applications?.length) {
        return res.status(400).json({
          error: 'jobId and at least one application are required',
        });
      }

      const store = await readStore();
      const job = store.jobs.find((j: any) => j.id === jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const candidates: CandidateInput[] = applications.map(
        (app: any) => ({
          id: app.applicationId,
          name: app.applicantName,
          resume_text: app.resumeText,
        }),
      );

      const requestBody: ScreeningRequest = {
        job_id: jobId,
        job_posting: {
          jobTitle: job.jobTitle,
          requiredSkills: job.requiredSkills,
          requiredExperience: job.requiredExperience,
          qualifications: job.qualifications,
          requirements: job.requirements,
        },
        candidates,
        score_threshold: scoreThreshold ?? 70,
      };

      const pythonRes = await fetch(
        `${SCREENING_SERVICE_URL}/screening/screen`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!pythonRes.ok) {
        const errText = await pythonRes.text();
        throw new Error(`Screening service error ${pythonRes.status}: ${errText}`);
      }

      const jobResponse: ScreeningJobResponse =
        await pythonRes.json() as ScreeningJobResponse;

      await addObservabilityEntry({
        id: generateId(),
        timestamp: now(),
        action: 'screening_job_submitted',
        entityType: 'Job',
        entityId: jobId,
        userId: req.user.id,
        details: {
          pythonJobId: jobResponse.job_id,
          totalCandidates: jobResponse.total_candidates,
          scoreThreshold: scoreThreshold ?? 70,
        },
        outcome: 'success',
      });

      res.status(202).json({
        success: true,
        data: jobResponse,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await addObservabilityEntry({
        id: generateId(),
        timestamp: now(),
        action: 'screening_job_submitted',
        entityType: 'Job',
        entityId: req.body?.jobId ?? 'unknown',
        userId: req.user.id,
        details: { error: message },
        outcome: 'failure',
      });

      res.status(500).json({ error: `Failed to submit screening job: ${message}` });
    }
  },
);

/**
 * GET /api/agents/screening/jobs/:pythonJobId
 * Poll the status of a submitted screening job.
 */
router.get(
  '/screening/jobs/:pythonJobId',
  requireRole(['recruiter', 'hiring-manager', 'member-services']),
  async (req: any, res) => {
    try {
      const { pythonJobId } = req.params;

      const pythonRes = await fetch(
        `${SCREENING_SERVICE_URL}/screening/jobs/${pythonJobId}`,
        { signal: AbortSignal.timeout(10_000) },
      );

      if (!pythonRes.ok) {
        if (pythonRes.status === 404) {
          return res.status(404).json({ error: 'Screening job not found' });
        }
        throw new Error(`Screening service error ${pythonRes.status}`);
      }

      const jobResponse: ScreeningJobResponse =
        await pythonRes.json() as ScreeningJobResponse;

      res.json({ success: true, data: jobResponse });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to poll screening job',
      });
    }
  },
);

/**
 * GET /api/agents/screening/:jobId/result
 * Get completed screening results for a job posting.
 * Returns 202 if the job is still running.
 */
router.get(
  '/screening/:jobId/result',
  requireRole(['recruiter', 'hiring-manager', 'member-services']),
  async (req: any, res) => {
    try {
      // jobId here is the original app job posting id; we look up the
      // most recent python job id from observability or accept pythonJobId param
      const { jobId } = req.params;
      const { pythonJobId } = req.query as { pythonJobId?: string };

      if (!pythonJobId) {
        return res.status(400).json({
          error: 'pythonJobId query parameter is required',
        });
      }

      const pythonRes = await fetch(
        `${SCREENING_SERVICE_URL}/screening/jobs/${pythonJobId}/result`,
        { signal: AbortSignal.timeout(10_000) },
      );

      if (pythonRes.status === 202) {
        const body = await pythonRes.json() as { status: string };
        return res.status(202).json({
          success: false,
          status: body.status,
          message: 'Screening job not yet complete',
        });
      }

      if (!pythonRes.ok) {
        throw new Error(`Screening service error ${pythonRes.status}`);
      }

      const result: ScreeningResult =
        await pythonRes.json() as ScreeningResult;

      // story-slop-cleanup-screening-vectorstore: `updated` was computed
      // then discarded via `void updated; // suppress lint` instead of
      // being used. Replaced below with an updatedCount that feeds the
      // observability log.
      // if (result.ranked_candidates?.length) {
      //   const store = await readStore();
      //   let updated = 0;
      //   for (const ranked of result.ranked_candidates) {
      //     const app = store.applications.find(
      //       (a: any) => a.id === ranked.applicant_id,
      //     );
      //     if (app) {
      //       app.matchScore = Math.round(ranked.overall_score / 10); // 0-100 → 0-10
      //       (app as any).llmSkillScore = ranked.skill_score;
      //       (app as any).llmExperienceScore = ranked.experience_score;
      //       (app as any).llmEducationScore = ranked.education_score;
      //       (app as any).llmScoringReasoning = ranked.scoring_reasoning;
      //       app.updatedAt = now();
      //       updated++;
      //     }
      //   }
      //   await writeStore(store);
      //   void updated; // suppress lint
      // }
      let updatedCount = 0;
      if (result.ranked_candidates?.length) {
        const store = await readStore();
        for (const ranked of result.ranked_candidates) {
          const app = store.applications.find(
            (a: any) => a.id === ranked.applicant_id,
          );
          if (app) {
            app.matchScore = Math.round(ranked.overall_score / 10); // 0-100 → 0-10
            (app as any).llmSkillScore = ranked.skill_score;
            (app as any).llmExperienceScore = ranked.experience_score;
            (app as any).llmEducationScore = ranked.education_score;
            (app as any).llmScoringReasoning = ranked.scoring_reasoning;
            app.updatedAt = now();
            updatedCount++;
          }
        }
        await writeStore(store);
      }

      await addObservabilityEntry({
        id: generateId(),
        timestamp: now(),
        action: 'screening_result_retrieved',
        entityType: 'Job',
        entityId: jobId,
        userId: req.user.id,
        details: {
          pythonJobId,
          passedCount: result.passed_count,
          totalCandidates: result.total_candidates,
          applicationsUpdated: updatedCount,
        },
        outcome: 'success',
      });

      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to retrieve screening result',
      });
    }
  },
);

// story-slop-cleanup-screening-vectorstore: removed process-narration
// comment "── Keep existing routes above, add new screening section
// below ──" — it documented how the diff was authored, not the code.

export default router;
