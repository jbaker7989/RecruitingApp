/**
 * Candidate Communication Agent Chain
 * LLM-powered generation of personalized candidate messages
 */

import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { getLLMClient } from '../services/llm/index.js';
import { CCInput, CCOutput, CCOutputSchema, MessageType, ToneType } from '../types/candidateCommunication.js';

// ============================================================================
// Message Templates
// ============================================================================

const BASE_PROMPT = `You are an expert recruiter communications specialist with years of experience crafting clear, professional, and candidate-friendly messages.

Generate a personalized message for a recruiting candidate.

**Message Context:**
- Message Type: {messageType}
- Applicant Name: {applicantName}
- Job Title: {jobTitle}
- Company Name: {companyName}
- Interviewer Name: {interviewerName}
- Scheduled Time: {scheduledTime}
- Location/Link: {location}
- Additional Notes: {additionalNotes}
- Tone: {tone}
- Company Context: {companyContext}

**Your Task:**
Generate a professional recruiting message with:
1. A clear, concise subject line appropriate for the message type
2. A warm, professional body that personalizes the communication
3. All relevant details filled in from the context provided

**Message Type Guidelines:**
- application_received: Acknowledge receipt, set expectations for timeline
- interview_invitation: Provide clear date/time/location, any prep instructions
- reschedule_request: Acknowledge request, provide new options
- rejection: Be respectful, encouraging, keep door open
- offer_extended: Clear offer details, timeline for response
- next_steps: Clear action items with deadlines

**Output Format:**
Return ONLY valid JSON matching this exact schema. No markdown, no explanation:

\`\`\`json
{
  "subject": "string - clear email subject line",
  "body": "string - complete email body",
  "tone": "professional|warm|concise|inclusive",
  "messageType": "same as input",
  "confidence": number between 0 and 1,
  "requiresHumanReview": boolean
}
\`\`\`

Important:
- subject should be 10-80 characters
- body should be 100-500 words
- confidence reflects completeness and appropriateness
- requiresHumanReview: true only if salary, legal terms, or sensitive content is involved
- Never include placeholder text like [INSERT NAME] or [DATE]`;

const TONE_MODIFIERS: Record<string, string> = {
  professional: 'Use a formal, business-appropriate tone. Be direct and respectful.',
  warm: 'Use a friendly, approachable tone. Show genuine interest in the candidate.',
  concise: 'Keep the message brief and to the point. Respect the reader\'s time.',
  inclusive: 'Use gender-neutral language. Avoid assumptions about the candidate.',
};

// ============================================================================
// Chain Implementation
// ============================================================================

/**
 * Generate a candidate communication message
 */
export async function generateCandidateMessage(
  input: CCInput
): Promise<CCOutput> {
  const model = getLLMClient('candidate-communication') as ChatOpenAI;

  // Get tone modifier
  const tone = input.tone || 'professional';
  const toneModifier = TONE_MODIFIERS[tone] || TONE_MODIFIERS.professional;

  // Build prompt
  const prompt = PromptTemplate.fromTemplate(BASE_PROMPT);

  const formattedPrompt = await prompt.format({
    messageType: input.messageType,
    applicantName: input.applicantName,
    jobTitle: input.jobTitle,
    companyName: input.companyName || 'The Company',
    interviewerName: input.interviewerName || 'the hiring team',
    scheduledTime: input.scheduledTime || 'to be determined',
    location: input.location || 'TBD',
    additionalNotes: input.additionalNotes || 'None provided',
    tone: toneModifier,
    companyContext: input.companyContext || 'A professional organization committed to hiring top talent.',
  });

  // Invoke model
  const response = await model.invoke(formattedPrompt);

  const rawContent = response.content as string;

  // Parse JSON from response
  const parsed = parseJsonResponse(rawContent);

  // Validate against schema
  return CCOutputSchema.parse(parsed);
}

/**
 * Generate multiple tone variants of a message
 */
export async function generateMessageVariants(
  baseInput: CCInput,
  tones: ToneType[]
): Promise<CCOutput[]> {
  const variants: CCOutput[] = [];

  for (const tone of tones) {
    const variantInput: CCInput = {
      ...baseInput,
      tone,
    };

    try {
      const variant = await generateCandidateMessage(variantInput);
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

function parseJsonResponse(content: string): unknown {
  let jsonStr = content;

  // Handle markdown code blocks
  if (content.includes('```json')) {
    jsonStr = content.split('```json')[1].split('```')[0].trim();
  } else if (content.includes('```')) {
    jsonStr = content.split('```')[1].split('```')[0].trim();
  }

  // Try to find JSON object
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
 * Calculate confidence based on input completeness
 */
export function calculateInputConfidence(input: CCInput): number {
  let score = 0.5;

  if (input.applicantName) score += 0.1;
  if (input.jobTitle) score += 0.1;
  if (input.companyName) score += 0.05;
  if (input.interviewerName) score += 0.05;
  if (input.scheduledTime) score += 0.05;
  if (input.location) score += 0.05;
  if (input.additionalNotes) score += 0.05;
  if (input.messageType) score += 0.05;

  return Math.min(score, 1);
}
