/**
 * Job Description Generator Types
 * Input/output type definitions for JDG feature
 */

import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

export const SeniorityLevel = z.enum(['entry', 'mid', 'senior', 'lead', 'director']);
export type SeniorityLevel = z.infer<typeof SeniorityLevel>;

export const RemotePolicy = z.enum(['onsite', 'hybrid', 'remote']);
export type RemotePolicy = z.infer<typeof RemotePolicy>;

export const ToneType = z.enum(['professional', 'casual', 'inclusive', 'startup']);
export type ToneType = z.infer<typeof ToneType>;

export const DraftStatus = z.enum(['draft', 'published', 'archived']);
export type DraftStatus = z.infer<typeof DraftStatus>;

// ============================================================================
// Input Types (for generation request)
// ============================================================================

export const JDGInputSchema = z.object({
  companyId: z.string().uuid().optional(),
  jobTitle: z.string().min(1, 'Job title is required'),
  department: z.string().optional(),
  seniority: z.string().optional(),
  requirements: z.array(z.string()).optional().default([]),
  responsibilities: z.array(z.string()).optional().default([]),
  qualifications: z.array(z.string()).optional().default([]),
  requiredSkills: z.array(z.string()).optional().default([]),
  location: z.string().optional(),
  remotePolicy: z.string().optional(),
  compensation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    currency: z.string().optional(),
  }).optional(),
  tone: z.string().optional().default('professional'),
  requiredExperience: z.number().optional(),
});

export type JDGInput = z.infer<typeof JDGInputSchema>;

// ============================================================================
// Output Types (generated content)
// ============================================================================

export const JDGOutputSchema = z.object({
  summary: z.string().describe('2-3 sentence role overview'),
  positionDescription: z.string().describe('Full description (300-500 words)'),
  responsibilities: z.array(z.string()).describe('6-10 bullet points'),
  qualifications: z.array(z.string()).describe('5-8 bullet points'),
  requirements: z.array(z.string()).describe('4-6 bullet points'),
  requiredSkills: z.array(z.string()).describe('Extracted skills'),
  requiredExperience: z.number().describe('Inferred years of experience'),
  keywords: z.array(z.string()).describe('For job board optimization'),
  confidence: z.number().min(0).max(1).describe('Quality score 0-1'),
});

export type JDGOutput = z.infer<typeof JDGOutputSchema>;

// ============================================================================
// Job Draft (stored entity)
// ============================================================================

export interface JobDraft {
  id: string;
  companyId: string;
  userId: string;
  status: DraftStatus;
  
  // Generation inputs
  input: JDGInput;
  
  // Generated content
  output: JDGOutput;
  
  // Variant tracking
  variantOf?: string;  // Parent draft ID if this is a variant
  variantsGenerated: number;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface GenerateRequest {
  companyId?: string;
  jobTitle: string;
  department?: string;
  seniority?: SeniorityLevel;
  requirements?: string[];
  responsibilities?: string[];
  qualifications?: string[];
  requiredSkills?: string[];
  location?: string;
  remotePolicy?: RemotePolicy;
  compensation?: {
    min?: number;
    max?: number;
    currency?: string;
  };
  tone?: ToneType;
}

export interface GenerateResponse {
  draftId: string;
  jobTitle: string;
  summary: string;
  positionDescription: string;
  responsibilities: string[];
  qualifications: string[];
  requirements: string[];
  requiredSkills: string[];
  requiredExperience: number;
  keywords: string[];
  tone: string;
  confidence: number;
  status: DraftStatus;
}

export interface GenerateVariantsRequest {
  baseDraftId: string;
  count?: number;  // Default 2, max 3
  tones?: ToneType[];
}

export interface VariantSummary {
  draftId: string;
  tone: string;
  confidence: number;
}

export interface GenerateVariantsResponse {
  baseDraftId: string;
  variants: VariantSummary[];
}

export interface DraftListItem {
  id: string;
  jobTitle: string;
  status: DraftStatus;
  tone: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  isVariant: boolean;
}

export interface DraftDetail extends DraftListItem {
  companyId?: string;
  input: JDGInput;
  output: JDGOutput;
  variantOf?: string;
  variants?: VariantSummary[];
  publishedAt?: string;
}

export interface UpdateDraftRequest {
  jobTitle?: string;
  summary?: string;
  positionDescription?: string;
  responsibilities?: string[];
  qualifications?: string[];
  requirements?: string[];
  requiredSkills?: string[];
  requiredExperience?: number;
  keywords?: string[];
  tone?: ToneType;
  status?: DraftStatus;
}

export interface PublishResponse {
  success: boolean;
  jobId: string;
  jobPosting: {
    id: string;
    jobTitle: string;
    companyId: string;
    createdAt: string;
  };
}
