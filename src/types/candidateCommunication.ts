/**
 * Candidate Communication Agent Types
 * Input/output type definitions for CC-001 feature
 */

import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

export const MessageType = z.enum([
  'application_received',
  'interview_invitation',
  'reschedule_request',
  'rejection',
  'offer_extended',
  'next_steps',
]);
export type MessageType = z.infer<typeof MessageType>;

export const ToneType = z.enum(['professional', 'warm', 'concise', 'inclusive']);
export type ToneType = z.infer<typeof ToneType>;

// ============================================================================
// Input Types
// ============================================================================

export const CCInputSchema = z.object({
  messageType: MessageType,
  applicantName: z.string().min(1, 'Applicant name is required'),
  jobTitle: z.string().min(1, 'Job title is required'),
  companyName: z.string().optional(),
  interviewerName: z.string().optional(),
  scheduledTime: z.string().optional(),
  location: z.string().optional(),
  additionalNotes: z.string().optional(),
  tone: ToneType.optional().default('professional'),
  companyContext: z.string().optional(),
});
export type CCInput = z.infer<typeof CCInputSchema>;

// ============================================================================
// Output Types
// ============================================================================

export const CCOutputSchema = z.object({
  subject: z.string().describe('Email subject line'),
  body: z.string().describe('Email body content'),
  tone: ToneType,
  messageType: MessageType,
  confidence: z.number().min(0).max(1).describe('Quality score 0-1'),
  requiresHumanReview: z.boolean().describe('Whether human review is needed before sending'),
});
export type CCOutput = z.infer<typeof CCOutputSchema>;

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface GenerateMessageRequest {
  messageType: MessageType;
  applicantName: string;
  jobTitle: string;
  companyName?: string;
  interviewerName?: string;
  scheduledTime?: string;
  location?: string;
  additionalNotes?: string;
  tone?: ToneType;
  companyContext?: string;
}

export interface GenerateMessageResponse {
  success: boolean;
  data?: CCOutput;
  error?: string;
}

export interface GenerateVariantsRequest {
  baseInput: GenerateMessageRequest;
  count?: number;  // Default 2, max 3
  tones?: ToneType[];
}

export interface VariantSummary {
  tone: ToneType;
  confidence: number;
  preview: string;  // First 100 chars of body
}

export interface GenerateVariantsResponse {
  baseMessage: CCOutput;
  variants: VariantSummary[];
}
