/**
 * Job Description Generator Chain
 * LLM-powered generation of professional job descriptions
 */

import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { getLLMClient } from '../services/llm/index.js';
import { JDGInput, JDGOutput, JDGOutputSchema, ToneType } from '../types/jdGenerator.js';

// ============================================================================
// Prompt Templates
// ============================================================================

const BASE_PROMPT = `You are an expert job description writer with years of experience creating compelling, inclusive job postings that attract top talent.

Generate a professional job description based on the following inputs:

**Job Details:**
- Title: {jobTitle}
- Department: {department}
- Seniority Level: {seniority}
- Requirements: {requirements}
- Responsibilities: {responsibilities}
- Qualifications: {qualifications}
- Required Skills: {requiredSkills}
- Location: {location}
- Remote Policy: {remotePolicy}
- Compensation: {compensation}
- Tone: {tone}

**Company Context (if available):**
{companyContext}

**Your Task:**
Generate a complete job description with:
1. A compelling 2-3 sentence summary that sells the role
2. A detailed position description (300-500 words) that describes day-to-day work
3. 6-10 specific responsibilities as bullet points
4. 5-8 required qualifications as bullet points  
5. 4-6 hard requirements as bullet points
6. Extracted required skills list
7. Inferred years of experience required
8. 5-10 keywords for job board optimization (SEO)

**Output Format:**
Return ONLY valid JSON matching this exact schema. No markdown, no explanation, just the JSON:

\`\`\`json
{
  "summary": "string - compelling 2-3 sentence overview",
  "positionDescription": "string - 300-500 word detailed description",
  "responsibilities": ["string", "string", ...],
  "qualifications": ["string", "string", ...],
  "requirements": ["string", "string", ...],
  "requiredSkills": ["string", "string", ...],
  "requiredExperience": number,
  "keywords": ["string", "string", ...],
  "confidence": number between 0 and 1
}
\`\`\`

Important:
- Make responsibilities specific and actionable
- Qualifications should be realistic and not overly restrictive
- Requirements are must-haves (years experience, certifications, etc.)
- Keywords should be common search terms for this role
- confidence reflects how complete/professional the description is`;

const TONE_MODIFIERS: Record<string, string> = {
  professional: 'Use a formal, corporate tone. Be direct and business-focused.',
  casual: 'Use a friendly, conversational tone. Feel free to use contractions and informal phrases.',
  inclusive: 'Use gender-neutral language. Avoid buzzwords. Focus on inclusive hiring practices.',
  startup: 'Use an energetic, fast-paced tone. Emphasize growth, learning, and impact.',
};

const SENIORITY_DEFAULTS: Record<string, { experience: number; qualifications: string[] }> = {
  entry: { experience: 0, qualifications: ['0-2 years of relevant experience', 'Bachelor\'s degree or equivalent', 'Strong communication skills', 'Eagerness to learn'] },
  mid: { experience: 3, qualifications: ['3-5 years of relevant experience', 'Demonstrated expertise in key areas', 'Ability to work independently', 'Bachelor\'s degree preferred'] },
  senior: { experience: 6, qualifications: ['6-8 years of relevant experience', 'Track record of delivering results', 'Mentoring and leadership experience', 'Bachelor\'s or Master\'s degree'] },
  lead: { experience: 8, qualifications: ['8+ years of relevant experience', 'Demonstrated leadership ability', 'Strategic thinking skills', 'Experience managing teams'] },
  director: { experience: 12, qualifications: ['12+ years of relevant experience', 'Executive leadership experience', 'P&L management experience', 'MBA or advanced degree preferred'] },
};

// ============================================================================
// Chain Implementation
// ============================================================================

/**
 * Generate a job description from structured inputs
 */
export async function generateJobDescription(
  input: JDGInput,
  companyContext?: { name?: string; description?: string; industry?: string }
): Promise<JDGOutput> {
  const model = getLLMClient('job-description') as ChatOpenAI;
  
  // Enrich input with defaults
  const enriched = enrichInput(input);
  
  // Build company context string
  const companyCtx = buildCompanyContext(companyContext);
  
  // Get tone modifier
  const tone = input.tone || 'professional';
  const toneModifier = TONE_MODIFIERS[tone] || TONE_MODIFIERS.professional;
  
  // Build prompt
  const prompt = PromptTemplate.fromTemplate(BASE_PROMPT);
  
  const formattedPrompt = await prompt.format({
    jobTitle: enriched.jobTitle,
    department: enriched.department || 'General',
    seniority: enriched.seniority || 'Not specified',
    requirements: enriched.requirements.length > 0 ? enriched.requirements.join('\n- ') : 'Not specified',
    responsibilities: enriched.responsibilities.length > 0 ? enriched.responsibilities.join('\n- ') : 'To be determined based on role',
    qualifications: enriched.qualifications.length > 0 ? enriched.qualifications.join('\n- ') : 'See requirements',
    requiredSkills: enriched.requiredSkills.length > 0 ? enriched.requiredSkills.join(', ') : 'See requirements',
    location: enriched.location || 'To be discussed',
    remotePolicy: enriched.remotePolicy || 'To be discussed',
    compensation: enriched.compensation 
      ? `$${enriched.compensation.min || 'TBD'} - $${enriched.compensation.max || 'TBD'} ${enriched.compensation.currency || 'USD'}`
      : 'Competitive compensation package',
    tone: toneModifier,
    companyContext: companyCtx,
  });
  
  // Invoke model
  const response = await model.invoke(formattedPrompt);
  
  const rawContent = response.content as string;
  
  // Parse JSON from response
  const parsed = parseJsonResponse(rawContent);
  
  // Validate against schema
  return JDGOutputSchema.parse(parsed);
}

/**
 * Generate multiple variants of a job description
 */
export async function generateJobDescriptionVariants(
  baseOutput: JDGOutput,
  tones: ToneType[],
  input: JDGInput
): Promise<JDGOutput[]> {
  const variants: JDGOutput[] = [];
  
  for (const tone of tones) {
    // Generate variant with different tone
    const variantInput: JDGInput = {
      ...input,
      tone,
    };
    
    try {
      const variant = await generateJobDescription(variantInput);
      variants.push(variant);
    } catch (error) {
      console.error(`Failed to generate variant for tone ${tone}:`, error);
      // Continue with other variants
    }
  }
  
  return variants;
}

// ============================================================================
// Helper Functions
// ============================================================================

function enrichInput(input: JDGInput): JDGInput {
  const enriched = { ...input };
  
  // Add seniority defaults if not provided
  if (!enriched.seniority && !enriched.requiredExperience) {
    // Try to infer from title keywords
    const title = enriched.jobTitle.toLowerCase();
    if (title.includes('junior') || title.includes('entry') || title.includes('associate')) {
      enriched.seniority = 'entry';
    } else if (title.includes('lead') || title.includes('principal')) {
      enriched.seniority = 'lead';
    } else if (title.includes('director') || title.includes('head')) {
      enriched.seniority = 'director';
    } else if (title.includes('senior') || title.includes('sr.')) {
      enriched.seniority = 'senior';
    } else {
      enriched.seniority = 'mid';
    }
  }
  
  // Add required experience from seniority if not specified
  if (!enriched.requiredExperience && enriched.seniority && SENIORITY_DEFAULTS[enriched.seniority]) {
    enriched.requiredExperience = SENIORITY_DEFAULTS[enriched.seniority].experience;
    enriched.requirements = enriched.requirements?.length 
      ? enriched.requirements 
      : SENIORITY_DEFAULTS[enriched.seniority].qualifications;
  }
  
  // Default arrays
  enriched.requirements = enriched.requirements || [];
  enriched.responsibilities = enriched.responsibilities || [];
  enriched.qualifications = enriched.qualifications || [];
  enriched.requiredSkills = enriched.requiredSkills || [];
  
  return enriched;
}

function buildCompanyContext(company?: { name?: string; description?: string; industry?: string }): string {
  if (!company) {
    return 'No specific company information provided. Use a general corporate tone.';
  }
  
  const parts: string[] = [];
  
  if (company.name) {
    parts.push(`Company: ${company.name}`);
  }
  if (company.industry) {
    parts.push(`Industry: ${company.industry}`);
  }
  if (company.description) {
    parts.push(`About: ${company.description}`);
  }
  
  return parts.length > 0 ? parts.join('\n') : 'No specific company information provided.';
}

function parseJsonResponse(content: string): unknown {
  // Handle markdown code blocks
  let jsonStr = content;
  
  if (content.includes('```json')) {
    jsonStr = content.split('```json')[1].split('```')[0].trim();
  } else if (content.includes('```')) {
    jsonStr = content.split('```')[1].split('```')[0].trim();
  }
  
  // Try to find JSON object in the content
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }
  
  try {
    return JSON.parse(jsonStr);
  } catch (error) {
    // Try to fix common JSON issues
    const fixed = fixJsonString(jsonStr);
    if (fixed) {
      return JSON.parse(fixed);
    }
    throw new Error(`Failed to parse JSON from LLM response: ${error}\nContent: ${content.substring(0, 500)}`);
  }
}

function fixJsonString(jsonStr: string): string | null {
  try {
    // Remove trailing commas
    let fixed = jsonStr.replace(/,(\s*[}\]])/g, '$1');
    
    // Ensure proper quote escaping
    fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    
    // Try parsing
    JSON.parse(fixed);
    return fixed;
  } catch {
    return null;
  }
}

/**
 * Calculate confidence score based on input completeness
 */
export function calculateInputConfidence(input: JDGInput): number {
  let score = 0.5; // Base score
  
  if (input.jobTitle) score += 0.1;
  if (input.department) score += 0.05;
  if (input.seniority) score += 0.05;
  if (input.requirements && input.requirements.length > 0) score += 0.1;
  if (input.responsibilities && input.responsibilities.length > 0) score += 0.05;
  if (input.qualifications && input.qualifications.length > 0) score += 0.05;
  if (input.requiredSkills && input.requiredSkills.length > 0) score += 0.05;
  if (input.location) score += 0.02;
  if (input.remotePolicy) score += 0.02;
  if (input.compensation) score += 0.02;
  
  return Math.min(score, 1);
}
