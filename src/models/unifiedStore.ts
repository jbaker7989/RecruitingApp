/**
 * Unified data access layer.
 * Uses PostgreSQL when DATABASE_URL is set, falls back to JSON file store for local development.
 */
import * as db from './db.js';
import * as store from './store.js';
import type { DataStore, ObservabilityLog, JobDraft as StoreJobDraft } from './store.js';

export const USE_DATABASE = !!process.env.DATABASE_URL;

// Re-export all types from store
export * from './store.js';

// Re-export all db functions
export {
  initializeDatabase,
  initializeSchema,
  // Company
  saveCompany,
  findCompanies,
  findCompany,
  // Jobs
  saveJobPosting,
  findJobPostings,
  findJobPosting,
  findJobPostingsByCompany,
  // Applicants
  saveApplicant,
  findApplicants,
  findApplicant,
  findApplicantByEmail,
  // Applications
  saveApplication,
  findApplications,
  findApplication,
  findApplicationsByApplicant,
  findApplicationsByJob,
  // Users
  saveUser,
  findUsers,
  findUser,
  findUserByUsername,
  // Hires
  saveHireRecord,
  findHireRecords,
  findHireRecord,
  // Observability
  findObservabilityLog,
  findObservabilityLogs,
  // Drafts
  saveDraft,
  findDrafts,
  findDraft,
  // Password reset
  savePasswordResetToken,
  findPasswordResetToken,
  findPasswordResetTokenByToken,
  // Types
  type Company,
  type JobPosting,
  type Applicant,
  type Application,
  type User,
  type HireRecord,
  type ObservabilityLog,
  type JobDraft,
  type PasswordResetToken,
} from './db.js';

/**
 * Initialize the appropriate storage backend.
 */
export async function initializeStore(): Promise<void> {
  if (USE_DATABASE) {
    console.log('📊 Using PostgreSQL database');
    await db.initializeDatabase();
    // initializeDatabase() falls back to null pool on connection failure
    if (db.getPool()) {
      await db.initializeSchema();
    } else {
      console.log('⚠️  Database unavailable — falling back to JSON file store');
      await store.initializeStore();
    }
  } else {
    console.log('📁 Using JSON file store (development mode)');
    await store.initializeStore();
  }
}

/**
 * Read the full store — reads all entities from DB or JSON file.
 */
export async function readStore(): Promise<DataStore> {
  if (USE_DATABASE) {
    const [companies, jobs, applicants, applications, users, hires, drafts] = await Promise.all([
      db.findCompanies(),
      db.findJobPostings(),
      db.findApplicants(),
      db.findApplications(),
      db.findUsers(),
      db.findHireRecords(),
      db.findDrafts(),
    ]);
    return { companies, jobs, applicants, applications, users, hires, observability: [], drafts: drafts as unknown as StoreJobDraft[], passwordResetTokens: [] };
  }
  return store.readStore();
}

/**
 * Write the full store — no-op in DB mode (writes happen per-entity).
 */
export async function writeStore(_data: DataStore): Promise<void> {
  if (!USE_DATABASE) {
    await store.writeStore(_data);
  }
}

/**
 * Observability — DB mode or file fallback.
 */
export async function readObservability(): Promise<ObservabilityLog[]> {
  if (USE_DATABASE) return db.findObservabilityLogs(500);
  return store.readObservability();
}

export async function writeObservability(logs: ObservabilityLog[]): Promise<void> {
  if (!USE_DATABASE) await store.writeObservability(logs);
}

// addObservabilityEntry: chooses implementation based on mode
const _addObsEntry = USE_DATABASE ? db.addObservabilityEntry : store.addObservabilityEntry;
export const addObservabilityEntry: typeof store.addObservabilityEntry = _addObsEntry;

/**
 * Re-export utilities from store.ts
 */
export { generateId, now, hashPassword, emptyStore } from './store.js';
