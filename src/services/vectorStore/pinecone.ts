/**
 * Pinecone Vector Store Implementation
 * Wraps the @pinecone-database/pinecone v2 SDK.
 *
 * Features:
 * - Managed, scalable vector similarity search (bring your own embeddings)
 * - Metadata filtering (entityType, entityId)
 * - Automatic index creation if it doesn't exist
 *
 * Setup:
 *   1. Create a free Pinecone account at https://www.pinecone.io
 *   2. Create an API key: https://app.pinecone.io/
 *   3. Add to .env: PINECONE_API_KEY, PINECONE_INDEX_NAME, PINECONE_CLOUD, PINECONE_REGION
 *   4. Index is auto-created on first use (or call initPineconeIndex() at startup)
 */

import { Pinecone } from '@pinecone-database/pinecone';
import type { PineconeRecord, RecordMetadata } from '@pinecone-database/pinecone/dist/data/vectors/types';
import type { ScoredPineconeRecord } from '@pinecone-database/pinecone/dist/data/vectors/query';
import { Embeddings } from '@langchain/core/embeddings';

// ─── Config ───────────────────────────────────────────────────────────────────

const PINECONE_API_KEY    = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'recruiting-app';
const PINECONE_CLOUD     = (process.env.PINECONE_CLOUD  || 'aws') as 'aws' | 'gcp' | 'azure';
const PINECONE_REGION     = process.env.PINECONE_REGION   || 'us-east-1';
const EMBEDDING_DIMENSION = 1536; // text-embedding-3-small output dimension

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VectorEntry {
  id: string;
  entityType: 'job' | 'applicant';
  entityId: string;
  text: string;
  updatedAt: string;
  embedding: number[];
}

export interface SearchResult {
  entry: VectorEntry;
  score: number;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _pc: Pinecone | null = null;
let _store: PineconeVectorStore | null = null;
let _initPromise: Promise<void> | null = null;

/** Returns the Pinecone client (throws if PINECONE_API_KEY is unset). */
export function getPineconeClient(): Pinecone {
  if (!PINECONE_API_KEY) {
    throw new Error(
      'PINECONE_API_KEY is not set. Get your key at https://app.pinecone.io/'
    );
  }
  if (!_pc) {
    _pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  }
  return _pc;
}

/** Create the Pinecone index if it doesn't already exist (idempotent). */
export async function initPineconeIndex(): Promise<void> {
  const pc = getPineconeClient();
  const { indexes } = await pc.listIndexes();

  if (indexes?.some(idx => idx.name === PINECONE_INDEX_NAME)) {
    console.log(`[Pinecone] Index "${PINECONE_INDEX_NAME}" already exists.`);
    return;
  }

  console.log(`[Pinecone] Creating index "${PINECONE_INDEX_NAME}"...`);
  await pc.createIndex({
    name: PINECONE_INDEX_NAME,
    dimension: EMBEDDING_DIMENSION,
    metric: 'cosine',
    spec: {
      serverless: { cloud: PINECONE_CLOUD, region: PINECONE_REGION },
    },
    waitUntilReady: true,
  });
  console.log(`[Pinecone] Index "${PINECONE_INDEX_NAME}" is ready.`);
}

/** Get or create the singleton store (auto-initialises Pinecone on first call). */
export async function getPineconeVectorStore(): Promise<PineconeVectorStore> {
  if (_store) return _store;
  if (!_initPromise) {
    _initPromise = (async () => {
      await initPineconeIndex();
      _store = new PineconeVectorStore();
    })();
  }
  await _initPromise;
  return _store!;
}

/** Reset singletons — useful for testing. */
export function resetPineconeVectorStore(): void {
  _pc = null;
  _store = null;
  _initPromise = null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Convert a Pinecone match record to our SearchResult shape. */
function toSearchResult(match: ScoredPineconeRecord<RecordMetadata>): SearchResult {
  return {
    entry: {
      id:         match.id,
      entityType: (match.metadata?.entityType as 'job' | 'applicant') ?? 'job',
      entityId:   (match.metadata?.entityId   as string)             ?? match.id,
      text:       (match.metadata?.text        as string)             ?? '',
      updatedAt:  (match.metadata?.updatedAt  as string)             ?? '',
      embedding:  match.values ?? [],
    },
    score: match.score ?? 0,
  };
}

/** Convert a fetched PineconeRecord to our VectorEntry shape. */
function toVectorEntry(id: string, record: PineconeRecord<RecordMetadata>): VectorEntry | undefined {
  if (!record.metadata) return undefined;
  // story-slop-cleanup-screening-vectorstore: `values` was dropped here even
  // though Pinecone's fetch response always includes it, forcing every caller
  // that needed the vector to re-embed the text through the OpenAI API instead.
  return {
    id,
    entityType: record.metadata.entityType as 'job' | 'applicant',
    entityId:   record.metadata.entityId   as string,
    text:       record.metadata.text        as string,
    updatedAt:  record.metadata.updatedAt   as string,
    embedding:  record.values ?? [],
  };
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class PineconeVectorStore {
  /**
   * Upsert a single vector record.
   * Idempotent — overwrites existing record with the same id.
   *
   * @param id          - Pinecone record id (e.g. `job_abc123`)
   * @param entityType  - 'job' or 'applicant'
   * @param entityId    - Application-level id
   * @param text        - Original text (stored as metadata for debugging)
   * @param embedding   - Dense vector from OpenAI embeddings
   */
  async addEntry(
    id:         string,
    entityType: 'job' | 'applicant',
    entityId:   string,
    text:       string,
    embedding:  number[]
  ): Promise<void> {
    const pc    = getPineconeClient();
    const index = pc.index(PINECONE_INDEX_NAME);

    const record: PineconeRecord<RecordMetadata> = {
      id,
      values:  embedding,
      metadata: {
        entityType,
        entityId,
        text,
        updatedAt: new Date().toISOString(),
      } as RecordMetadata,
    };

    // v2 SDK: upsert takes { records: PineconeRecord[] }
    await index.upsert({ records: [record] });
  }

  /**
   * Fetch a single record by id.
   * Returns undefined if not found.
   */
  async getEntry(id: string): Promise<VectorEntry | undefined> {
    const pc    = getPineconeClient();
    const index = pc.index(PINECONE_INDEX_NAME);

    const result = await index.fetch({ ids: [id] });
    const record = result.records?.[id];

    return record ? toVectorEntry(id, record) : undefined;
  }

  /**
   * Delete a single record by id.
   */
  async deleteEntry(id: string): Promise<void> {
    const pc    = getPineconeClient();
    const index = pc.index(PINECONE_INDEX_NAME);

    // v2 SDK: deleteOne takes { id: string }
    await index.deleteOne({ id });
  }

  /**
   * Delete all records matching a specific entityId + entityType.
   * Uses metadata filter — safe at scale.
   */
  async deleteByEntityId(
    entityId:   string,
    entityType: 'job' | 'applicant'
  ): Promise<void> {
    const pc    = getPineconeClient();
    const index = pc.index(PINECONE_INDEX_NAME);
    await index.deleteMany({
      filter: { entityId: { $eq: entityId }, entityType: { $eq: entityType } },
    });
  }

  /**
   * Dense vector similarity search with optional metadata filters.
   * Returns top-K scored results with metadata.
   */
  async similaritySearch(
    queryEmbedding: number[],
    filter?: { entityType?: 'job' | 'applicant'; entityIds?: string[] },
    topK: number = 10
  ): Promise<SearchResult[]> {
    const pc    = getPineconeClient();
    const index = pc.index(PINECONE_INDEX_NAME);

    // Build v2 metadata filter
    const pineconeFilter: Record<string, unknown> = {};
    if (filter?.entityType) {
      pineconeFilter.entityType = filter.entityType;
    }
    if (filter?.entityIds?.length) {
      pineconeFilter.entityId = { $in: filter.entityIds };
    }

    const response = await index.query({
      vector:          queryEmbedding,
      topK,
      includeMetadata:  true,
      ...(Object.keys(pineconeFilter).length > 0 ? { filter: pineconeFilter } : {}),
    });

    return (response.matches ?? []).map(toSearchResult);
  }

  /**
   * Text → embed → search (convenience one-shot).
   * Calls the LLM embedder, then similaritySearch.
   */
  async findSimilar(
    text:       string,
    embeddings: Embeddings,
    filter?:    { entityType?: 'job' | 'applicant'; entityIds?: string[] },
    topK:       number = 10
  ): Promise<SearchResult[]> {
    const embedding = await embeddings.embedQuery(text);
    return this.similaritySearch(embedding, filter, topK);
  }

  /** Total vector count across the index. */
  async getCount(): Promise<number> {
    const pc    = getPineconeClient();
    const stats = await pc.index(PINECONE_INDEX_NAME).describeIndexStats();
    return stats.totalRecordCount ?? 0;
  }

  /** Delete ALL vectors in the index. Use with caution. */
  async clearAll(): Promise<void> {
    const pc    = getPineconeClient();
    const index = pc.index(PINECONE_INDEX_NAME);
    await index.deleteAll();
  }

  /**
   * Batch upsert — chunks at 1 000 records per request (Pinecone limit).
   * Efficient for full re-indexing runs.
   */
  async upsertBatch(
    records: Array<{
      id:         string;
      embedding:  number[];
      entityType: 'job' | 'applicant';
      entityId:   string;
      text:       string;
    }>
  ): Promise<void> {
    const pc    = getPineconeClient();
    const index = pc.index(PINECONE_INDEX_NAME);
    const BATCH = 1000;

    for (let i = 0; i < records.length; i += BATCH) {
      const chunk = records.slice(i, i + BATCH);
      await index.upsert({
        records: chunk.map(r => ({
          id:     r.id,
          values: r.embedding,
          metadata: {
            entityType: r.entityType,
            entityId:   r.entityId,
            text:       r.text,
            updatedAt:  new Date().toISOString(),
          } as RecordMetadata,
        })),
      });
      if (i + BATCH < records.length) {
        console.log(`[Pinecone] Upserted batch ${i + BATCH} / ${records.length} vectors…`);
      }
    }
  }
}
