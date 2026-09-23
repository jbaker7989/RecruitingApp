/**
 * Vector Store Service — Pinecone-backed semantic search.
 *
 * Replaces the in-memory implementation with Pinecone for production use.
 * All public APIs remain identical — callers (matching.ts, agents/index.ts) need no changes.
 *
 * Setup:
 *   1. Create a Pinecone account: https://www.pinecone.io
 *   2. Set PINECONE_API_KEY and PINECONE_INDEX_NAME in your .env
 *   3. Call initVectorStore() at app startup (or on first use it auto-inits)
 */

import { getEmbeddingsClient } from '../llm/index.js';
import { readStore } from '../../models/store.js';

/** Cosine similarity between two equal-length embedding vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type { VectorEntry } from './pinecone.js';
export type { SearchResult } from './pinecone.js';
export { getPineconeClient, initPineconeIndex, getPineconeVectorStore, resetPineconeVectorStore } from './pinecone.js';
export { PineconeVectorStore } from './pinecone.js';

// Lazy-initialized store instance
let _store: import('./pinecone.js').PineconeVectorStore | null = null;
let _initPromise: Promise<void> | null = null;

/**
 * Get the vector store singleton. Initializes Pinecone on first call.
 * Safe to call concurrently — only the first call triggers initialization.
 */
async function getStore(): Promise<import('./pinecone.js').PineconeVectorStore> {
  if (_store) return _store;

  if (!_initPromise) {
    _initPromise = (async () => {
      const { getPineconeVectorStore } = await import('./pinecone.js');
      _store = await getPineconeVectorStore();
    })();
  }

  await _initPromise;
  return _store!;
}

/**
 * Initialize the vector store at app startup.
 * Call this once (e.g., in your server setup) to surface errors early.
 * Idempotent — safe to call multiple times.
 */
export async function initVectorStore(): Promise<void> {
  await getStore();
}

// ─── Text Builders ─────────────────────────────────────────────────────────────

/**
 * Build a search-friendly text blob from a job posting.
 * This is what gets embedded and stored in Pinecone.
 */
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

/**
 * Build a search-friendly text blob from an applicant profile.
 */
export function buildApplicantText(applicant: {
  firstName: string;
  lastName: string;
  educationHistory: Array<{ institution: string; degree: string; fieldOfStudy: string }>;
  employmentHistory: Array<{ company: string; position: string; responsibilities?: string[] }>;
  skills?: string[];
  achievements?: string[];
}): string {
  const parts: string[] = [
    `Candidate: ${applicant.firstName} ${applicant.lastName}`,
    'Education:',
    ...applicant.educationHistory.map(
      e => `- ${e.degree} in ${e.fieldOfStudy} from ${e.institution}`
    ),
    'Experience:',
    ...applicant.employmentHistory.map(
      e =>
        `- ${e.position} at ${e.company}${e.responsibilities?.length ? ': ' + e.responsibilities.join(', ') : ''}`
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

// ─── Indexing ─────────────────────────────────────────────────────────────────

/**
 * Index (or re-index) a job posting in Pinecone.
 * Upserts by `job_<id>` so re-indexing is safe and idempotent.
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
  const store = await getStore();
  const embeddings = getEmbeddingsClient();

  const text = buildJobText(job);
  const embedding = await embeddings.embedQuery(text);

  await store.addEntry(`job_${jobId}`, 'job', jobId, text, embedding);
}

/**
 * Index (or re-index) an applicant in Pinecone.
 * Upserts by `applicant_<id>` so re-indexing is safe and idempotent.
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
  const store = await getStore();
  const embeddings = getEmbeddingsClient();

  const text = buildApplicantText(applicant);
  const embedding = await embeddings.embedQuery(text);

  await store.addEntry(`applicant_${applicantId}`, 'applicant', applicantId, text, embedding);
}

// ─── Similarity Search ────────────────────────────────────────────────────────

/**
 * Find jobs most similar to an applicant's profile.
 * Used for: "Recommended Jobs for You" feature.
 *
 * @param applicantId       — ID to find similar jobs for
 * @param excludeJobIds     — Job IDs to exclude (e.g., already applied)
 * @param topK              — Number of results to return
 */
export async function findSimilarJobsForApplicant(
  applicantId: string,
  excludeJobIds: string[] = [],
  topK: number = 5
): Promise<Array<{ jobId: string; similarityScore: number }>> {
  const store = await getStore();

  const applicantEntry = await store.getEntry(`applicant_${applicantId}`);
  if (!applicantEntry) {
    return [];
  }

  // story-slop-cleanup-screening-vectorstore: applicantEntry was already
  // embedded at index time, but this called store.findSimilar(text, ...)
  // which re-embeds the text via the OpenAI API on every call. Reuse the
  // embedding Pinecone already returned instead.
  // const embeddings = getEmbeddingsClient();
  // const results = await store.findSimilar(
  //   applicantEntry.text,
  //   embeddings,
  //   { entityType: 'job' },
  //   topK + excludeJobIds.length
  // );

  // Fetch enough to account for exclusions
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
      similarityScore: Math.round((r.score ?? 0) * 100) / 100,
    }));
}

/**
 * Find applicants most similar to a job posting.
 * Used for: passive candidate sourcing ("Build Talent Pipeline").
 *
 * @param jobId               — Job to find similar candidates for
 * @param excludeApplicantIds — Applicant IDs to exclude (e.g., already applied)
 * @param topK                — Number of results to return
 */
export async function findSimilarApplicantsForJob(
  jobId: string,
  excludeApplicantIds: string[] = [],
  topK: number = 10
): Promise<Array<{ applicantId: string; similarityScore: number }>> {
  const store = await getStore();

  const jobEntry = await store.getEntry(`job_${jobId}`);
  if (!jobEntry) {
    return [];
  }

  // story-slop-cleanup-screening-vectorstore: same redundant-re-embed issue
  // as findSimilarJobsForApplicant above — reuse the stored embedding.
  // const embeddings = getEmbeddingsClient();
  // const results = await store.findSimilar(
  //   jobEntry.text,
  //   embeddings,
  //   { entityType: 'applicant' },
  //   topK + excludeApplicantIds.length
  // );
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
      similarityScore: Math.round((r.score ?? 0) * 100) / 100,
    }));
}

/**
 * Calculate the cosine similarity score between a job and applicant pair.
 * Used to enrich the existing keyword + education + experience scoring with
 * a semantic dimension.
 */
export async function calculateSemanticSimilarity(
  jobId: string,
  applicantId: string
): Promise<number> {
  const store = await getStore();

  const jobEntry = await store.getEntry(`job_${jobId}`);
  const applicantEntry = await store.getEntry(`applicant_${applicantId}`);

  if (!jobEntry || !applicantEntry) {
    return 0;
  }

  // story-slop-cleanup-screening-vectorstore: both entries were already
  // embedded at index time; re-embedding them here paid for two extra
  // OpenAI API calls per match-score lookup for no benefit.
  // const embeddings = getEmbeddingsClient();
  // const [jobEmbedding, applicantEmbedding] = await Promise.all([
  //   embeddings.embedQuery(jobEntry.text),
  //   embeddings.embedQuery(applicantEntry.text),
  // ]);
  // let dot = 0, normJob = 0, normApp = 0;
  // for (let i = 0; i < jobEmbedding.length; i++) {
  //   dot += jobEmbedding[i] * applicantEmbedding[i];
  //   normJob += jobEmbedding[i] * jobEmbedding[i];
  //   normApp += applicantEmbedding[i] * applicantEmbedding[i];
  // }
  // const similarity = dot / (Math.sqrt(normJob) * Math.sqrt(normApp) + 1e-9);
  // return Math.round(similarity * 100) / 100;

  const similarity = cosineSimilarity(jobEntry.embedding, applicantEntry.embedding);
  return Math.round(similarity * 100) / 100;
}

// ─── Bulk Re-indexing ─────────────────────────────────────────────────────────

/**
 * Re-index all active job postings in Pinecone.
 * Idempotent — re-runs are safe (upsert semantics).
 */
export async function reindexAllJobs(): Promise<{ indexed: number; errors: number }> {
  const store = await readStore();
  let indexed = 0, errors = 0;

  for (const job of store.jobs) {
    try {
      await indexJob(job.id, job);
      indexed++;
    } catch (error) {
      console.error(`[reindexAllJobs] Failed to index job ${job.id}:`, error);
      errors++;
    }
  }

  return { indexed, errors };
}

/**
 * Re-index all applicants in Pinecone.
 * Idempotent — re-runs are safe (upsert semantics).
 */
export async function reindexAllApplicants(): Promise<{ indexed: number; errors: number }> {
  const store = await readStore();
  let indexed = 0, errors = 0;

  for (const applicant of store.applicants) {
    try {
      await indexApplicant(applicant.id, applicant);
      indexed++;
    } catch (error) {
      console.error(`[reindexAllApplicants] Failed to index applicant ${applicant.id}:`, error);
      errors++;
    }
  }

  return { indexed, errors };
}

/**
 * Full re-index: all jobs + all applicants.
 * Use when migrating to a new Pinecone index or after bulk data import.
 */
export async function reindexAll(): Promise<{
  jobsIndexed: number;
  applicantsIndexed: number;
  errors: number;
}> {
  const jobsResult = await reindexAllJobs();
  const applicantsResult = await reindexAllApplicants();

  return {
    jobsIndexed: jobsResult.indexed,
    applicantsIndexed: applicantsResult.indexed,
    errors: jobsResult.errors + applicantsResult.errors,
  };
}

/**
 * Delete a job from the vector index.
 */
export async function deleteJobFromIndex(jobId: string): Promise<void> {
  const store = await getStore();
  await store.deleteByEntityId(jobId, 'job');
}

/**
 * Delete an applicant from the vector index.
 */
export async function deleteApplicantFromIndex(applicantId: string): Promise<void> {
  const store = await getStore();
  await store.deleteByEntityId(applicantId, 'applicant');
}

/**
 * Get index statistics (total vectors, dimension, etc.)
 */
export async function getIndexStats(): Promise<{
  totalVectors: number;
  dimension: number;
  indexName: string;
}> {
  const store = await getStore();
  const count = await store.getCount();
  return {
    totalVectors: count,
    dimension: 1536, // text-embedding-3-small
    indexName: process.env.PINECONE_INDEX_NAME || 'recruiting-app',
  };
}
