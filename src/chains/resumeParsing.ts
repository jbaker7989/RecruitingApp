/**
 * Resume Parsing Chain
 * Parses PDF/DOCX resumes and extracts structured data using LLM
 */

import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { getLLMClient } from '../services/llm/index.js';

// Zod schema for structured output matching Applicant model
export const EducationEntrySchema = z.object({
  institution: z.string().describe('Name of the educational institution'),
  degree: z.string().describe('Degree obtained (e.g., Bachelor of Science)'),
  fieldOfStudy: z.string().describe('Field of study or major'),
  startDate: z.string().describe('Start date in YYYY-MM format'),
  endDate: z.string().describe('End date in YYYY-MM format or Present'),
  gpa: z.string().optional().describe('GPA if provided'),
});

export const EmploymentEntrySchema = z.object({
  company: z.string().describe('Company name'),
  position: z.string().describe('Job title or position'),
  startDate: z.string().describe('Start date in YYYY-MM format'),
  endDate: z.string().optional().describe('End date in YYYY-MM format or Present if current'),
  responsibilities: z.array(z.string()).optional().describe('List of key responsibilities and achievements'),
});

export const ParsedResumeSchema = z.object({
  firstName: z.string().describe('First name'),
  lastName: z.string().describe('Last name'),
  email: z.string().email().describe('Email address'),
  phone: z.string().describe('Phone number'),
  address: z.object({
    state: z.string().describe('State or region'),
    zip: z.string().describe('ZIP or postal code'),
  }).optional().describe('Address information'),
  educationHistory: z.array(EducationEntrySchema).describe('Educational background'),
  employmentHistory: z.array(EmploymentEntrySchema).describe('Work experience'),
  skills: z.array(z.string()).describe('Technical and soft skills identified'),
  achievements: z.array(z.string()).describe('Quantified achievements from work history'),
  certifications: z.array(z.object({
    name: z.string(),
    issuingOrganization: z.string(),
    dateObtained: z.string().optional(),
  })).optional().describe('Professional certifications'),
  confidenceScores: z.record(z.number().min(0).max(1)).describe('Confidence score per field (0-1)'),
  rawText: z.string().describe('Original text extracted from resume'),
});

export type ParsedResume = z.infer<typeof ParsedResumeSchema>;
export type EducationEntryParsed = z.infer<typeof EducationEntrySchema>;
export type EmploymentEntryParsed = z.infer<typeof EmploymentEntrySchema>;

/**
 * Prompt template for resume parsing with structured output request
 */
const RESUME_PARSING_PROMPT = `You are an expert resume parser. Extract structured information from the provided resume text.

IMPORTANT: Return ONLY valid JSON matching this exact schema structure. No markdown, no explanation, just the JSON.

Schema requirements:
- firstName: First name of the person
- lastName: Last name of the person
- email: Valid email address
- phone: Phone number
- address: { state, zip } if available, omit if not found
- educationHistory: Array of { institution, degree, fieldOfStudy, startDate, endDate, gpa? }
- employmentHistory: Array of { company, position, startDate, endDate?, responsibilities? }
- skills: Array of skill strings
- achievements: Array of quantified achievements (e.g., "increased sales by 20%")
- certifications: Array of { name, issuingOrganization, dateObtained? } if available
- confidenceScores: Object mapping field names to confidence 0-1
- rawText: The original text

For achievements, look for quantified results like:
- "increased sales by 20%"
- "reduced latency by 50ms"
- "managed team of 5 people"
- "delivered project 2 weeks ahead of schedule"

Resume Text:
---
{resumeText}
---`;

/**
 * Parse resume text directly
 */
export async function parseResume(resumeText: string): Promise<ParsedResume> {
  const model = getLLMClient('resume-parsing') as ChatOpenAI;
  
  const prompt = PromptTemplate.fromTemplate(RESUME_PARSING_PROMPT);
  
  // Invoke model
  const response = await model.invoke(
    await prompt.format({ resumeText })
  );
  
  const rawContent = response.content as string;
  
  // Parse JSON from response
  // Handle markdown code blocks if present
  let jsonStr = rawContent;
  if (rawContent.includes('```json')) {
    jsonStr = rawContent.split('```json')[1].split('```')[0].trim();
  } else if (rawContent.includes('```')) {
    jsonStr = rawContent.split('```')[1].split('```')[0].trim();
  }
  
  try {
    const parsed = JSON.parse(jsonStr);
    return ParsedResumeSchema.parse(parsed);
  } catch (error) {
    throw new Error(`Failed to parse resume JSON: ${error}. Raw content: ${rawContent.substring(0, 500)}`);
  }
}

/**
 * Parse resume from file buffer (PDF/DOCX)
 */
export async function parseResumeFromBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<ParsedResume> {
  let text: string;
  
  if (mimeType === 'application/pdf') {
    text = await extractTextFromPDF(buffer);
  } else if (mimeType.includes('word') || mimeType.includes('document')) {
    text = await extractTextFromDOCX(buffer);
  } else {
    throw new Error(`Unsupported file type: ${mimeType}. Supported: PDF, DOCX`);
  }
  
  if (!text || text.trim().length === 0) {
    throw new Error('No text could be extracted from the document');
  }
  
  return parseResume(text);
}

// PDF text extraction using pdf-parse
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    // Dynamic import with CJS fallback
    const pdfModule = await import('pdf-parse');
    const pdfParse = (pdfModule as any).default || pdfModule;
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    throw new Error(`Failed to extract text from PDF: ${error}`);
  }
}

// DOCX text extraction using mammoth
async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.default.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    throw new Error(`Failed to extract text from DOCX: ${error}`);
  }
}
