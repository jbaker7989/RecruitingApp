/**
 * Job Description Generator API Routes
 * Endpoints for generating and managing job description drafts
 */

import { Router } from 'express';
import { z } from 'zod';
import { readStore, writeStore, generateId, now } from '../../models/store.js';
import { generateJobDescription, generateJobDescriptionVariants } from '../../chains/jobDescription.js';
import { requireRole } from '../../middleware/auth.js';
import { addObservabilityEntry } from '../../models/store.js';
import type { 
  JDGInput, 
  JDGOutput, 
  DraftStatus,
  GenerateRequest,
  GenerateResponse,
  GenerateVariantsRequest,
  GenerateVariantsResponse,
  DraftListItem,
  DraftDetail,
  UpdateDraftRequest,
  PublishResponse,
  ToneType
} from '../../types/jdGenerator.js';

const router = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const generateRequestSchema = z.object({
  companyId: z.string().uuid().optional(),
  jobTitle: z.string().min(1, 'Job title is required'),
  department: z.string().optional(),
  seniority: z.enum(['entry', 'mid', 'senior', 'lead', 'director']).optional(),
  requirements: z.array(z.string()).optional().default([]),
  responsibilities: z.array(z.string()).optional().default([]),
  qualifications: z.array(z.string()).optional().default([]),
  requiredSkills: z.array(z.string()).optional().default([]),
  location: z.string().optional(),
  remotePolicy: z.enum(['onsite', 'hybrid', 'remote']).optional(),
  compensation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    currency: z.string().optional(),
  }).optional(),
  tone: z.enum(['professional', 'casual', 'inclusive', 'startup']).optional().default('professional'),
});

const generateVariantsRequestSchema = z.object({
  baseDraftId: z.string().uuid(),
  count: z.number().min(1).max(3).optional().default(2),
  tones: z.array(z.enum(['professional', 'casual', 'inclusive', 'startup'])).optional(),
});

const updateDraftRequestSchema = z.object({
  jobTitle: z.string().min(1).optional(),
  summary: z.string().optional(),
  positionDescription: z.string().optional(),
  responsibilities: z.array(z.string()).optional(),
  qualifications: z.array(z.string()).optional(),
  requirements: z.array(z.string()).optional(),
  requiredSkills: z.array(z.string()).optional(),
  requiredExperience: z.number().min(0).optional(),
  keywords: z.array(z.string()).optional(),
  tone: z.enum(['professional', 'casual', 'inclusive', 'startup']).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

// ============================================================================
// POST /api/agents/jd/generate - Generate a job description draft
// ============================================================================

router.post('/generate', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    // Validate request
    const validation = generateRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validation.error.errors 
      });
    }

    const input: JDGInput = validation.data;
    const userId = req.user?.id || 'unknown';
    const companyId = input.companyId || '';

    // Fetch company context if companyId provided
    const store = await readStore();
    let companyContext: { name?: string; description?: string; industry?: string } | undefined;
    
    if (input.companyId) {
      const company = store.companies.find(c => c.id === input.companyId);
      if (company) {
        companyContext = {
          name: company.companyName,
          description: company.description,
          industry: company.industry,
        };
      }
    }

    // Generate job description
    let output: JDGOutput;
    try {
      output = await generateJobDescription(input, companyContext);
    } catch (error) {
      console.error('LLM generation failed:', error);
      return res.status(503).json({ 
        error: 'Job description generation failed',
        message: 'The AI service is temporarily unavailable. Please try again.',
        setupHint: 'Ensure OPENAI_API_KEY is configured in environment variables.'
      });
    }

    // Create draft
    const draftId = generateId();
    const draft = {
      id: draftId,
      companyId,
      userId,
      status: 'draft' as DraftStatus,
      input,
      output,
      variantsGenerated: 0,
      createdAt: now(),
      updatedAt: now(),
    };

    // Save to store
    const updatedStore = await readStore();
    updatedStore.drafts.push(draft);
    await writeStore(updatedStore);

    // Log observability
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'jd-generate',
      entityType: 'JobDraft',
      entityId: draftId,
      userId,
      details: { jobTitle: input.jobTitle, tone: input.tone },
      outcome: 'success',
    });

    // Return response
    const response: GenerateResponse = {
      draftId,
      jobTitle: input.jobTitle,
      summary: output.summary,
      positionDescription: output.positionDescription,
      responsibilities: output.responsibilities,
      qualifications: output.qualifications,
      requirements: output.requirements,
      requiredSkills: output.requiredSkills,
      requiredExperience: output.requiredExperience,
      keywords: output.keywords,
      tone: input.tone || 'professional',
      confidence: output.confidence,
      status: 'draft',
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to generate job description' 
    });
  }
});

// ============================================================================
// POST /api/agents/jd/generate-variants - Generate A/B variants
// ============================================================================

router.post('/generate-variants', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    // Validate request
    const validation = generateVariantsRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validation.error.errors 
      });
    }

    const { baseDraftId, count = 2, tones } = validation.data;
    const userId = req.user?.id || 'unknown';

    // Fetch base draft
    const store = await readStore();
    const baseDraft = store.drafts.find(d => d.id === baseDraftId);
    
    if (!baseDraft) {
      return res.status(404).json({ error: 'Base draft not found' });
    }

    // Check ownership
    if (baseDraft.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to generate variants for this draft' });
    }

    // Determine tones to generate
    const defaultTones: ToneType[] = ['professional', 'casual', 'inclusive'];
    const tonesToGenerate = tones?.slice(0, count) || defaultTones.slice(0, count);

    // Fetch company context if available
    let companyContext: { name?: string; description?: string; industry?: string } | undefined;
    if (baseDraft.input.companyId) {
      const company = store.companies.find(c => c.id === baseDraft.input.companyId);
      if (company) {
        companyContext = {
          name: company.companyName,
          description: company.description,
          industry: company.industry,
        };
      }
    }

    // Generate variants sequentially
    const variants: { draftId: string; tone: string; confidence: number }[] = [];
    
    for (const tone of tonesToGenerate) {
      try {
        const variantInput: JDGInput = {
          ...baseDraft.input,
          tone,
          requirements: baseDraft.input.requirements || [],
          responsibilities: baseDraft.input.responsibilities || [],
          qualifications: baseDraft.input.qualifications || [],
          requiredSkills: baseDraft.input.requiredSkills || [],
        };

        const variantOutput = await generateJobDescription(variantInput, companyContext);

        // Create variant draft
        const variantId = generateId();
        const variantDraft = {
          id: variantId,
          companyId: baseDraft.companyId,
          userId,
          status: 'draft' as DraftStatus,
          input: variantInput,
          output: variantOutput,
          variantOf: baseDraftId,
          variantsGenerated: 0,
          createdAt: now(),
          updatedAt: now(),
        };

        store.drafts.push(variantDraft);
        variants.push({
          draftId: variantId,
          tone: tone,
          confidence: variantOutput.confidence,
        });
      } catch (error) {
        console.error(`Failed to generate variant for tone ${tone}:`, error);
        // Continue with other variants
      }
    }

    // Update base draft variant count
    const baseDraftIndex = store.drafts.findIndex(d => d.id === baseDraftId);
    if (baseDraftIndex !== -1) {
      store.drafts[baseDraftIndex].variantsGenerated = variants.length;
      store.drafts[baseDraftIndex].updatedAt = now();
    }

    await writeStore(store);

    const response: GenerateVariantsResponse = {
      baseDraftId,
      variants,
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Generate variants error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to generate variants' 
    });
  }
});

// ============================================================================
// GET /api/agents/jd/drafts - List user's drafts
// ============================================================================

router.get('/drafts', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const userId = req.user?.id || 'unknown';
    const store = await readStore();

    const drafts = store.drafts
      .filter(d => d.userId === userId && d.status !== 'archived')
      .map(d => ({
        id: d.id,
        jobTitle: d.input.jobTitle,
        status: d.status,
        tone: d.input.tone || 'professional',
        confidence: d.output.confidence,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        isVariant: !!d.variantOf,
      } as DraftListItem));

    res.json(drafts);
  } catch (error) {
    console.error('List drafts error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to list drafts' 
    });
  }
});

// ============================================================================
// GET /api/agents/jd/drafts/:id - Get draft details
// ============================================================================

router.get('/drafts/:id', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || 'unknown';
    const store = await readStore();

    const draft = store.drafts.find(d => d.id === id);
    
    if (!draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    // Check ownership
    if (draft.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to view this draft' });
    }

    // Get variants if this is a base draft
    let variants = undefined;
    if (!draft.variantOf) {
      const variantDrafts = store.drafts.filter(d => d.variantOf === draft.id);
      variants = variantDrafts.map(v => ({
        draftId: v.id,
        tone: v.input.tone || 'professional',
        confidence: v.output.confidence,
      }));
    }

    const response: DraftDetail = {
      id: draft.id,
      jobTitle: draft.input.jobTitle,
      status: draft.status,
      tone: draft.input.tone || 'professional',
      confidence: draft.output.confidence,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      isVariant: !!draft.variantOf,
      companyId: draft.companyId || undefined,
      input: {
        ...draft.input,
        requirements: draft.input.requirements || [],
        responsibilities: draft.input.responsibilities || [],
        qualifications: draft.input.qualifications || [],
        requiredSkills: draft.input.requiredSkills || [],
        tone: draft.input.tone || 'professional',
      },
      output: draft.output,
      variantOf: draft.variantOf,
      variants,
      publishedAt: draft.publishedAt,
    };

    res.json(response);
  } catch (error) {
    console.error('Get draft error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get draft' 
    });
  }
});

// ============================================================================
// PUT /api/agents/jd/drafts/:id - Update draft
// ============================================================================

router.put('/drafts/:id', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || 'unknown';

    // Validate request
    const validation = updateDraftRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validation.error.errors 
      });
    }

    const store = await readStore();
    const draftIndex = store.drafts.findIndex(d => d.id === id);
    
    if (draftIndex === -1) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    const draft = store.drafts[draftIndex];

    // Check ownership
    if (draft.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to update this draft' });
    }

    // Cannot edit published drafts
    if (draft.status === 'published') {
      return res.status(400).json({ error: 'Cannot edit published drafts' });
    }

    const updates = validation.data;

    // Apply updates
    if (updates.jobTitle) {
      draft.input.jobTitle = updates.jobTitle;
    }
    if (updates.summary !== undefined) {
      draft.output.summary = updates.summary;
    }
    if (updates.positionDescription !== undefined) {
      draft.output.positionDescription = updates.positionDescription;
    }
    if (updates.responsibilities !== undefined) {
      draft.output.responsibilities = updates.responsibilities;
    }
    if (updates.qualifications !== undefined) {
      draft.output.qualifications = updates.qualifications;
    }
    if (updates.requirements !== undefined) {
      draft.output.requirements = updates.requirements;
    }
    if (updates.requiredSkills !== undefined) {
      draft.output.requiredSkills = updates.requiredSkills;
    }
    if (updates.requiredExperience !== undefined) {
      draft.output.requiredExperience = updates.requiredExperience;
    }
    if (updates.keywords !== undefined) {
      draft.output.keywords = updates.keywords;
    }
    if (updates.tone) {
      draft.input.tone = updates.tone;
    }
    if (updates.status) {
      draft.status = updates.status;
    }

    draft.updatedAt = now();

    await writeStore(store);

    res.json({
      id: draft.id,
      jobTitle: draft.input.jobTitle,
      status: draft.status,
      message: 'Draft updated successfully',
    });
  } catch (error) {
    console.error('Update draft error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to update draft' 
    });
  }
});

// ============================================================================
// POST /api/agents/jd/drafts/:id/publish - Publish draft as job posting
// ============================================================================

router.post('/drafts/:id/publish', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || 'unknown';
    const store = await readStore();

    const draftIndex = store.drafts.findIndex(d => d.id === id);
    
    if (draftIndex === -1) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    const draft = store.drafts[draftIndex];

    // Check ownership
    if (draft.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to publish this draft' });
    }

    // Check if already published
    if (draft.status === 'published') {
      return res.status(400).json({ error: 'Draft already published' });
    }

    // Require companyId for publishing
    if (!draft.companyId) {
      return res.status(400).json({ 
        error: 'Cannot publish draft without company. Please recreate with a companyId.' 
      });
    }

    // Create job posting from draft
    const jobId = generateId();
    const jobPosting = {
      id: jobId,
      companyId: draft.companyId,
      jobTitle: draft.input.jobTitle,
      positionDescription: draft.output.positionDescription,
      requirements: draft.output.requirements,
      positionLocation: draft.input.location || '',
      payRange: {
        min: draft.input.compensation?.min || 0,
        max: draft.input.compensation?.max || 0,
        currency: draft.input.compensation?.currency || 'USD',
      },
      responsibilities: draft.output.responsibilities,
      qualifications: draft.output.qualifications,
      requiredSkills: draft.output.requiredSkills,
      requiredExperience: draft.output.requiredExperience,
      reportsTo: 'N/A',
      isActive: true,
      totalOpenings: 1,
      currentApplications: 0,
      createdAt: now(),
      updatedAt: now(),
    };

    // Add to store
    store.jobs.push(jobPosting);

    // Update draft status
    draft.status = 'published';
    draft.publishedAt = now();
    draft.updatedAt = now();

    await writeStore(store);

    // Log observability
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'jd-publish',
      entityType: 'JobPosting',
      entityId: jobId,
      userId,
      details: { 
        jobTitle: jobPosting.jobTitle, 
        draftId: draft.id,
        confidence: draft.output.confidence,
      },
      outcome: 'success',
    });

    const response: PublishResponse = {
      success: true,
      jobId,
      jobPosting: {
        id: jobId,
        jobTitle: jobPosting.jobTitle,
        companyId: jobPosting.companyId,
        createdAt: jobPosting.createdAt,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Publish draft error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to publish draft' 
    });
  }
});

// ============================================================================
// DELETE /api/agents/jd/drafts/:id - Delete draft
// ============================================================================

router.delete('/drafts/:id', requireRole(['hiring-manager', 'member-services']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || 'unknown';
    const store = await readStore();

    const draft = store.drafts.find(d => d.id === id);
    
    if (!draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    // Check ownership
    if (draft.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this draft' });
    }

    // Soft delete - mark as archived
    draft.status = 'archived';
    draft.updatedAt = now();

    // Also archive any variants
    const variants = store.drafts.filter(d => d.variantOf === id);
    for (const variant of variants) {
      variant.status = 'archived';
      variant.updatedAt = now();
    }

    await writeStore(store);

    res.json({ message: 'Draft deleted successfully' });
  } catch (error) {
    console.error('Delete draft error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to delete draft' 
    });
  }
});

export default router;
