/**
 * Candidate Communication Agent API Routes
 * Endpoints for generating candidate messages
 */

import { Router } from 'express';
import { z } from 'zod';
import { readStore, generateId, now } from '../../models/store.js';
import { generateCandidateMessage, generateMessageVariants, calculateInputConfidence } from '../../chains/candidateCommunication.js';
import { requireRole } from '../../middleware/auth.js';
import { addObservabilityEntry } from '../../models/store.js';
import type {
  CCInput,
  CCOutput,
  GenerateMessageRequest,
  GenerateMessageResponse,
  GenerateVariantsRequest,
  GenerateVariantsResponse,
  VariantSummary,
  ToneType,
} from '../../types/candidateCommunication.js';

const router = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const generateRequestSchema = z.object({
  messageType: z.enum([
    'application_received',
    'interview_invitation',
    'reschedule_request',
    'rejection',
    'offer_extended',
    'next_steps',
  ]),
  applicantName: z.string().min(1, 'Applicant name is required'),
  jobTitle: z.string().min(1, 'Job title is required'),
  companyName: z.string().optional(),
  interviewerName: z.string().optional(),
  scheduledTime: z.string().optional(),
  location: z.string().optional(),
  additionalNotes: z.string().optional(),
  tone: z.enum(['professional', 'warm', 'concise', 'inclusive']).optional().default('professional'),
  companyContext: z.string().optional(),
});

const generateVariantsRequestSchema = z.object({
  baseInput: z.object({
    messageType: z.enum([
      'application_received',
      'interview_invitation',
      'reschedule_request',
      'rejection',
      'offer_extended',
      'next_steps',
    ]),
    applicantName: z.string().min(1),
    jobTitle: z.string().min(1),
    companyName: z.string().optional(),
    interviewerName: z.string().optional(),
    scheduledTime: z.string().optional(),
    location: z.string().optional(),
    additionalNotes: z.string().optional(),
    tone: z.enum(['professional', 'warm', 'concise', 'inclusive']).optional().default('professional'),
    companyContext: z.string().optional(),
  }),
  count: z.number().min(1).max(3).optional().default(2),
  tones: z.array(z.enum(['professional', 'warm', 'concise', 'inclusive'])).optional(),
});

// ============================================================================
// POST /api/agents/communication/generate
// ============================================================================

router.post('/generate', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    // Validate request
    const validation = generateRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const input: CCInput = validation.data;
    const userId = req.user?.id || 'unknown';

    // Generate message
    let output: CCOutput;
    try {
      output = await generateCandidateMessage(input);
    } catch (error) {
      console.error('LLM generation failed:', error);
      return res.status(503).json({
        error: 'Message generation failed',
        message: 'The AI service is temporarily unavailable. Please try again.',
        setupHint: 'Ensure OPENAI_API_KEY is configured in environment variables.',
      });
    }

    // Log observability
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'cc-generate',
      entityType: 'CandidateMessage',
      entityId: generateId(),
      userId,
      details: {
        messageType: input.messageType,
        applicantName: input.applicantName,
        jobTitle: input.jobTitle,
        tone: input.tone,
        confidence: output.confidence,
      },
      outcome: 'success',
    });

    const response: GenerateMessageResponse = {
      success: true,
      data: output,
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Generate message error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate message',
    });
  }
});

// ============================================================================
// POST /api/agents/communication/generate-variants
// ============================================================================

router.post('/generate-variants', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    // Validate request
    const validation = generateVariantsRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { baseInput, count = 2, tones } = validation.data;
    const userId = req.user?.id || 'unknown';

    // Determine tones to generate
    const defaultTones: ToneType[] = ['professional', 'warm'];
    const tonesToGenerate = tones?.slice(0, count) || defaultTones.slice(0, count);

    // Generate base message
    let baseMessage: CCOutput;
    try {
      baseMessage = await generateCandidateMessage(baseInput as CCInput);
    } catch (error) {
      console.error('LLM generation failed:', error);
      return res.status(503).json({
        error: 'Message generation failed',
        message: 'The AI service is temporarily unavailable.',
      });
    }

    // Generate variants
    const variants: VariantSummary[] = [];

    for (const tone of tonesToGenerate) {
      if (tone === baseInput.tone) continue; // Skip base tone

      try {
        const variantInput: CCInput = {
          ...baseInput,
          tone,
        };
        const variant = await generateCandidateMessage(variantInput);
        variants.push({
          tone: variant.tone,
          confidence: variant.confidence,
          preview: variant.body.substring(0, 100) + (variant.body.length > 100 ? '...' : ''),
        });
      } catch (error) {
        console.error(`Failed to generate variant for tone ${tone}:`, error);
        // Continue with other variants
      }
    }

    const response: GenerateVariantsResponse = {
      baseMessage,
      variants,
    };

    // Log observability
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'cc-generate-variants',
      entityType: 'CandidateMessage',
      entityId: generateId(),
      userId,
      details: {
        messageType: baseInput.messageType,
        applicantName: baseInput.applicantName,
        tone: baseInput.tone,
        variantCount: variants.length,
      },
      outcome: 'success',
    });

    res.status(201).json(response);
  } catch (error) {
    console.error('Generate variants error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate variants',
    });
  }
});

// ============================================================================
// GET /api/agents/communication/templates
// ============================================================================

router.get('/templates', requireRole(['recruiter', 'hiring-manager', 'member-services']), async (_req: any, res) => {
  const templates = [
    {
      messageType: 'application_received',
      name: 'Application Received',
      description: 'Acknowledge receipt of a job application',
      recommendedTone: 'warm',
    },
    {
      messageType: 'interview_invitation',
      name: 'Interview Invitation',
      description: 'Invite a candidate to schedule an interview',
      recommendedTone: 'professional',
    },
    {
      messageType: 'reschedule_request',
      name: 'Reschedule Request',
      description: 'Request or acknowledge a rescheduling',
      recommendedTone: 'concise',
    },
    {
      messageType: 'rejection',
      name: 'Rejection',
      description: 'Inform a candidate they were not selected',
      recommendedTone: 'warm',
    },
    {
      messageType: 'offer_extended',
      name: 'Offer Extended',
      description: 'Communicate a job offer to a candidate',
      recommendedTone: 'professional',
    },
    {
      messageType: 'next_steps',
      name: 'Next Steps',
      description: 'Provide follow-up instructions to a candidate',
      recommendedTone: 'concise',
    },
  ];

  res.json({ templates });
});

export default router;
