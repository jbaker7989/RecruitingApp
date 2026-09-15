/**
 * Vector Store Service for Semantic Search
 * Uses in-memory storage (can be swapped for ChromaDB/Pinecone in production)
 */

import { Embeddings } from '@langchain/core/embeddings';
import { getEmbeddingsClient } from '../llm/index.js';
import { readStore } from '../../models/store.js';

// Simple in-memory vector store for development
// In production, replace with ChromaDB or Pinecone
interface VectorEntry {
  id: string;
  entityType: 'job' | 'applicant';
  entityId: string;
  embedding: number[];
  text: string; // Original text for debugging
  updatedAt: string;
}

class InMemoryVectorStore {
  private entries: Map<string, VectorEntry> = new Map();
  private dimension: number = 1536; // text-embedding-3-small default

  async addEntry(id: string, entityType: 'job' | 'applicant', entityId: string, text: string, embedding: number[]): Promise<void> {
    this.entries.set(id, {
      id,
      entityType,
      entityId,
      embedding,
      text,
      updatedAt: new Date().toISOString(),
    });
  }

  async getEntry(id: string): Promise<VectorEntry | undefined> {
    return this.entries.get(id);
  }

  async deleteEntry(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async similaritySearch(
    queryEmbedding: number[],
    filter?: { entityType?: 'job' | 'applicant'; entityIds?: string[] },
    topK: number = 10
  ): Promise<Array<{ entry: VectorEntry; score: number }>> {
    const results: Array<{ entry: VectorEntry; score: number }> = [];

    for (const entry of this.entries.values()) {
      // Apply filters
      if (filter?.entityType && entry.entityType !== filter.entityType) continue;
      if (filter?.entityIds && !filter.entityIds.includes(entry.entityId)) continue;

      const score = cosineSimilarity(queryEmbedding, entry.embedding);
      results.push({ entry, score });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  async findSimilar(
    text: string,
    embeddings: Embeddings,
    filter?: { entityType?: 'job' | 'applicant'; entityIds?: string[] },
    topK: number = 10
  ): Promise<Array<{ entry: VectorEntry; score: number }>> {
    const queryEmbedding = await embeddings.embedQuery(text);
    return this.similaritySearch(queryEmbedding, filter, topK);
  }

  get count(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

// Cosine similarity calculation
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (normA * normB);
}

// Singleton instance
let vectorStoreInstance: InMemoryVectorStore | null = null;

export function getVectorStore(): InMemoryVectorStore {
  if (!vectorStoreInstance) {
    vectorStoreInstance = new InMemoryVectorStore();
  }
  return vectorStoreInstance;
}

// Build text representation for a job posting
export function buildJobText(job: {
  jobTitle: string;
  positionDescription: string;
  requirements: string[];
  responsibilities: string[];
  qualifications: string[];
  requiredSkills: string[];
  positionLocation: string;
}): string {
  return [
    job.jobTitle,
    job.positionDescription,
    'Requirements:',
    ...job.requirements,
    'Responsibilities:',
    ...job.responsibilities,
    'Qualifications:',
    ...job.qualifications,
    'Skills:',
    ...job.requiredSkills,
    `Location: ${job.positionLocation}`,
  ].join('\n');
}

// Build text representation for an applicant
export function buildApplicantText(applicant: {
  firstName: string;
  lastName: string;
  educationHistory: Array<{ institution: string; degree: string; fieldOfStudy: string }>;
  employmentHistory: Array<{ company: string; position: string; responsibilities?: string[] }>;
  skills?: string[];
  achievements?: string[];
}): string {
  const parts = [
    `Candidate: ${applicant.firstName} ${applicant.lastName}`,
    'Education:',
    ...applicant.educationHistory.map(
      e => `- ${e.degree} in ${e.fieldOfStudy} from ${e.institution}`
    ),
    'Experience:',
    ...applicant.employmentHistory.map(
      e => `- ${e.position} at ${e.company}${e.responsibilities?.length ? ': ' + e.responsibilities.join(', ') : ''}`
    ),
  ];

  if (applicant.skills?.length) {
    parts.push('Skills:', ...applicant.skills.map(s => `- ${s}`));
  }

  if (applicant.achievements?.length) {
    parts.push('Achievements:', ...applicant.achievements.map(a => `- ${a}`));
  }

  return parts.join('\n');
}

/**
 * Index a job posting in the vector store
 */
export async function indexJob(
  jobId: string,
  job: {
    jobTitle: string;
    positionDescription: string;
    requirements: string[];
    responsibilities: string[];
    qualifications: string[];
    requiredSkills: string[];
    positionLocation: string;
  }
): Promise<void> {
  const embeddings = getEmbeddingsClient();
  const store = getVectorStore();
  const text = buildJobText(job);
  const embedding = await embeddings.embedQuery(text);
  
  await store.addEntry(`job_${jobId}`, 'job', jobId, text, embedding);
}

/**
 * Index an applicant in the vector store
 */
export async function indexApplicant(
  applicantId: string,
  applicant: {
    firstName: string;
    lastName: string;
    educationHistory: Array<{ institution: string; degree: string; fieldOfStudy: string }>;
    employmentHistory: Array<{ company: string; position: string; responsibilities?: string[] }>;
    skills?: string[];
    achievements?: string[];
  }
): Promise<void> {
  const embeddings = getEmbeddingsClient();
  const store = getVectorStore();
  const text = buildApplicantText(applicant);
  const embedding = await embeddings.embedQuery(text);
  
  await store.addEntry(`applicant_${applicantId}`, 'applicant', applicantId, text, embedding);
}

/**
 * Find jobs similar to an applicant (for job suggestions)
 */
export async function findSimilarJobsForApplicant(
  applicantId: string,
  excludeJobIds: string[] = [],
  topK: number = 5
): Promise<Array<{ jobId: string; similarityScore: number }>> {
  const store = getVectorStore();
  
  // Get applicant's vector
  const applicantEntry = await store.getEntry(`applicant_${applicantId}`);
  if (!applicantEntry) {
    return [];
  }

  const results = await store.similaritySearch(
    applicantEntry.embedding,
    { entityType: 'job' },
    topK + excludeJobIds.length
  );

  return results
    .filter(r => !excludeJobIds.includes(r.entry.entityId))
    .slice(0, topK)
    .map(r => ({
      jobId: r.entry.entityId,
      similarityScore: Math.round(r.score * 100) / 100,
    }));
}

/**
 * Find applicants similar to a job (for passive candidate sourcing)
 */
export async function findSimilarApplicantsForJob(
  jobId: string,
  excludeApplicantIds: string[] = [],
  topK: number = 10
): Promise<Array<{ applicantId: string; similarityScore: number }>> {
  const store = getVectorStore();
  
  // Get job's vector
  const jobEntry = await store.getEntry(`job_${jobId}`);
  if (!jobEntry) {
    return [];
  }

  const results = await store.similaritySearch(
    jobEntry.embedding,
    { entityType: 'applicant' },
    topK + excludeApplicantIds.length
  );

  return results
    .filter(r => !excludeApplicantIds.includes(r.entry.entityId))
    .slice(0, topK)
    .map(r => ({
      applicantId: r.entry.entityId,
      similarityScore: Math.round(r.score * 100) / 100,
    }));
}

/**
 * Calculate semantic similarity between a job and applicant
 */
export async function calculateSemanticSimilarity(
  jobId: string,
  applicantId: string
): Promise<number> {
  const store = getVectorStore();
  
  const jobEntry = await store.getEntry(`job_${jobId}`);
  const applicantEntry = await store.getEntry(`applicant_${applicantId}`);
  
  if (!jobEntry || !applicantEntry) {
    return 0;
  }

  return Math.round(cosineSimilarity(jobEntry.embedding, applicantEntry.embedding) * 100) / 100;
}

/**
 * Re-index all jobs (batch operation)
 */
export async function reindexAllJobs(): Promise<{ indexed: number; errors: number }> {
  const store = await readStore();
  const vectorStore = getVectorStore();
  let indexed = 0;
  let errors = 0;

  for (const job of store.jobs) {
    try {
      await indexJob(job.id, job);
      indexed++;
    } catch (error) {
      console.error(`Failed to index job ${job.id}:`, error);
      errors++;
    }
  }

  return { indexed, errors };
}

/**
 * Re-index all applicants (batch operation)
 */
export async function reindexAllApplicants(): Promise<{ indexed: number; errors: number }> {
  const store = await readStore();
  let indexed = 0;
  let errors = 0;

  for (const applicant of store.applicants) {
    try {
      await indexApplicant(applicant.id, applicant);
      indexed++;
    } catch (error) {
      console.error(`Failed to index applicant ${applicant.id}:`, error);
      errors++;
    }
  }

  return { indexed, errors };
}
