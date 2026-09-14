/**
 * Semantic Matching Chain
 * Computes semantic similarity between jobs and candidates using embeddings
 */

import { getLLMClient } from '../services/llm/index.js';
import {
  indexJob,
  indexApplicant,
  calculateSemanticSimilarity,
  findSimilarJobsForApplicant,
  findSimilarApplicantsForJob,
} from '../services/vectorStore/index.js';
import { readStore, writeStore, addObservabilityEntry, generateId, now } from '../models/store.js';
import type { Applicant, JobPosting, Application } from '../models/store';

export interface MatchingResult {
  applicationId: string;
  jobId: string;
  applicantId: string;
  keywordScore: number;
  educationScore: number;
  experienceScore: number;
  semanticScore: number;
  finalScore: number;
  breakdown: {
    keywordWeight: number;
    educationWeight: number;
    experienceWeight: number;
    semanticWeight: number;
  };
}

/**
 * Match score calculation (existing logic from matching.ts)
 */
function calculateKeywordScore(
  applicant: Pick<Applicant, 'employmentHistory' | 'educationHistory'>,
  job: Pick<JobPosting, 'requirements' | 'requiredSkills'>
): number {
  const keywords = job.requirements.map(r => r.toLowerCase());
  const requiredSkills = job.requiredSkills.map(s => s.toLowerCase());
  const allKeywords = [...keywords, ...requiredSkills];

  if (allKeywords.length === 0) return 5;

  const applicantText = [
    ...applicant.employmentHistory.map(e => `${e.position} ${e.responsibilities?.join(' ') || ''}`),
    ...applicant.educationHistory.map(e => `${e.fieldOfStudy} ${e.degree}`),
  ].join(' ').toLowerCase();

  let matchedKeywords = 0;
  for (const keyword of allKeywords) {
    if (applicantText.includes(keyword.toLowerCase())) {
      matchedKeywords++;
    }
  }

  return Math.round((matchedKeywords / allKeywords.length) * 10);
}

function calculateEducationScore(
  applicant: Pick<Applicant, 'educationHistory'>,
  job: Pick<JobPosting, 'qualifications'>
): number {
  if (applicant.educationHistory.length === 0) return 3;
  
  const hasDegree = job.qualifications.some(q => 
    q.toLowerCase().includes('degree') || q.toLowerCase().includes('bachelor') || 
    q.toLowerCase().includes('master') || q.toLowerCase().includes('phd')
  );
  
  if (hasDegree && applicant.educationHistory.length > 0) return 8;
  if (applicant.educationHistory.length > 0) return 6;
  return 3;
}

function calculateExperienceScore(
  applicant: Pick<Applicant, 'employmentHistory'>,
  job: Pick<JobPosting, 'requiredExperience'>
): number {
  const totalYears = applicant.employmentHistory.reduce((sum, emp) => {
    const start = new Date(emp.startDate);
    const end = emp.endDate ? new Date(emp.endDate) : new Date();
    return sum + (end.getFullYear() - start.getFullYear());
  }, 0);

  if (totalYears >= job.requiredExperience) return 10;
  if (totalYears >= job.requiredExperience * 0.75) return 8;
  if (totalYears >= job.requiredExperience * 0.5) return 6;
  if (totalYears >= job.requiredExperience * 0.25) return 4;
  return 2;
}

/**
 * Calculate combined match score with semantic similarity
 * Weights: 30% keyword, 30% education, 30% experience, 10% semantic
 */
export async function calculateMatchScore(
  applicantId: string,
  jobId: string
): Promise<MatchingResult> {
  const store = await readStore();
  const applicant = store.applicants.find((a: Applicant) => a.id === applicantId);
  const job = store.jobs.find((j: JobPosting) => j.id === jobId);

  if (!applicant || !job) {
    throw new Error('Applicant or job not found');
  }

  // Calculate traditional scores
  const keywordScore = calculateKeywordScore(applicant, job);
  const educationScore = calculateEducationScore(applicant, job);
  const experienceScore = calculateExperienceScore(applicant, job);

  // Calculate semantic similarity
  let semanticScore = 0;
  try {
    semanticScore = await calculateSemanticSimilarity(jobId, applicantId);
    // Convert 0-1 to 0-10 scale
    semanticScore = Math.round(semanticScore * 10);
  } catch (error) {
    console.warn('Semantic similarity calculation failed, using 0:', error);
  }

  // Weighted final score
  const weights = {
    keywordWeight: 0.30,
    educationWeight: 0.30,
    experienceWeight: 0.30,
    semanticWeight: 0.10,
  };

  const finalScore = Math.round(
    keywordScore * weights.keywordWeight +
    educationScore * weights.educationWeight +
    experienceScore * weights.experienceWeight +
    semanticScore * weights.semanticWeight
  );

  const clampedFinal = Math.min(10, Math.max(1, finalScore));

  return {
    applicationId: '', // Will be set by caller
    jobId,
    applicantId,
    keywordScore,
    educationScore,
    experienceScore,
    semanticScore,
    finalScore: clampedFinal,
    breakdown: weights,
  };
}

/**
 * Re-score all applications for a job
 */
export async function rescoreApplicationsForJob(jobId: string): Promise<{
  updated: number;
  errors: number;
}> {
  const store = await readStore();
  const job = store.jobs.find((j: JobPosting) => j.id === jobId);
  
  if (!job) {
    throw new Error('Job not found');
  }

  // Re-index the job
  await indexJob(jobId, job);

  let updated = 0;
  let errors = 0;

  for (const app of store.applications.filter((a: Application) => a.jobPostingId === jobId)) {
    try {
      const result = await calculateMatchScore(app.applicantId, jobId);
      const semanticScoreNormalized = result.semanticScore / 10; // Convert back to 0-1 for storage
      
      (app as any).semanticScore = semanticScoreNormalized;
      (app as any).matchScore = result.finalScore;
      app.updatedAt = now();
      updated++;
    } catch (error) {
      console.error(`Failed to rescore application ${app.id}:`, error);
      errors++;
    }
  }

  await writeStore(store);
  return { updated, errors };
}

/**
 * Get job suggestions for an applicant
 */
export async function getJobSuggestionsForApplicant(
  applicantId: string,
  appliedJobIds: string[] = [],
  topK: number = 5
): Promise<Array<{ jobId: string; similarityScore: number; jobTitle?: string }>> {
  const store = await readStore();
  
  // Ensure applicant is indexed
  const applicant = store.applicants.find((a: Applicant) => a.id === applicantId);
  if (!applicant) {
    throw new Error('Applicant not found');
  }

  await indexApplicant(applicantId, applicant);

  const similarJobs = await findSimilarJobsForApplicant(applicantId, appliedJobIds, topK);

  // Enrich with job details
  return similarJobs.map((sj: { jobId: string; similarityScore: number }) => {
    const job = store.jobs.find((j: JobPosting) => j.id === sj.jobId);
    return {
      jobId: sj.jobId,
      similarityScore: sj.similarityScore,
      jobTitle: job?.jobTitle,
    };
  });
}

/**
 * Get similar candidates for a job (passive sourcing)
 */
export async function getSimilarCandidatesForJob(
  jobId: string,
  topK: number = 10
): Promise<Array<{ applicantId: string; similarityScore: number; candidateName?: string }>> {
  const store = await readStore();
  
  // Ensure job is indexed
  const job = store.jobs.find((j: JobPosting) => j.id === jobId);
  if (!job) {
    throw new Error('Job not found');
  }

  await indexJob(jobId, job);

  // Get existing applicants for this job
  const existingApplicantIds = store.applications
    .filter((a: Application) => a.jobPostingId === jobId)
    .map((a: Application) => a.applicantId);

  const similarApplicants = await findSimilarApplicantsForJob(
    jobId,
    existingApplicantIds,
    topK
  );

  // Enrich with applicant details
  return similarApplicants.map((sa: { applicantId: string; similarityScore: number }) => {
    const applicant = store.applicants.find((a: Applicant) => a.id === sa.applicantId);
    return {
      applicantId: sa.applicantId,
      similarityScore: sa.similarityScore,
      candidateName: applicant ? `${applicant.firstName} ${applicant.lastName}` : undefined,
    };
  });
}

/**
 * Batch reindex and rescore all active jobs and applications
 */
export async function rebuildSemanticIndex(): Promise<{
  jobsIndexed: number;
  applicantsIndexed: number;
  applicationsRescored: number;
  errors: number;
}> {
  const store = await readStore();
  let jobsIndexed = 0;
  let applicantsIndexed = 0;
  let applicationsRescored = 0;
  let errors = 0;

  // Index all active jobs
  for (const job of store.jobs.filter((j: JobPosting) => j.isActive)) {
    try {
      await indexJob(job.id, job);
      jobsIndexed++;
    } catch (error) {
      console.error(`Failed to index job ${job.id}:`, error);
      errors++;
    }
  }

  // Index all applicants
  for (const applicant of store.applicants) {
    try {
      await indexApplicant(applicant.id, applicant);
      applicantsIndexed++;
    } catch (error) {
      console.error(`Failed to index applicant ${applicant.id}:`, error);
      errors++;
    }
  }

  // Rescore all applications
  for (const app of store.applications) {
    try {
      const semanticScore = await calculateSemanticSimilarity(app.jobPostingId, app.applicantId);
      (app as any).semanticScore = semanticScore;
      
      const result = await calculateMatchScore(app.applicantId, app.jobPostingId);
      (app as any).matchScore = result.finalScore;
      app.updatedAt = now();
      applicationsRescored++;
    } catch (error) {
      console.error(`Failed to rescore application ${app.id}:`, error);
      errors++;
    }
  }

  await writeStore(store);

  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action: 'semantic_index_rebuilt',
    entityType: 'System',
    entityId: 'bulk_operation',
    userId: 'system',
    details: { jobsIndexed, applicantsIndexed, applicationsRescored, errors },
    outcome: errors > 0 ? 'failure' : 'success',
  });

  return { jobsIndexed, applicantsIndexed, applicationsRescored, errors };
}
