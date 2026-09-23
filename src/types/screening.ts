/**
 * Candidate Screening Types
 * TypeScript types mirroring the Python FastAPI service contracts.
 */

// ─── Input Types ──────────────────────────────────────────────────────────────

export interface CandidateInput {
  id: string;
  name: string;
  resume_text: string;
}

export interface ScreeningRequest {
  job_id: string;
  job_posting: JobPostingForScreening;
  candidates: CandidateInput[];
  score_threshold?: number;
}

// Minimal JobPosting subset accepted by the screening service
export interface JobPostingForScreening {
  jobTitle: string;
  requiredSkills: string[];
  requiredExperience: number;
  qualifications: string[];
  requirements: string[];
}

// ─── Output Types ─────────────────────────────────────────────────────────────

export type ScreeningJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CandidateResult {
  applicant_id: string;
  applicant_name: string;
  overall_score: number;
  skill_score: number;
  experience_score: number;
  education_score: number;
  scoring_reasoning: string;
  passed_threshold: boolean;
}

export interface RankedCandidate extends CandidateResult {
  rank?: number;
  reason?: string;
}

export interface ScreeningJobResponse {
  job_id: string;
  status: ScreeningJobStatus;
  total_candidates: number | null;
  passed_count: number | null;
  failed_count: number | null;
  ranked_candidates: RankedCandidate[] | null;
  output_report: string | null;
  error: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface ScreeningResult {
  job_id: string;
  total_candidates: number;
  passed_count: number;
  failed_count: number;
  ranked_candidates: RankedCandidate[];
  output_report: string;
  completed_at: string;
}

// ─── Service Config ───────────────────────────────────────────────────────────

export const SCREENING_SERVICE_BASE = process.env.SCREENING_SERVICE_URL || 'http://localhost:8001';
