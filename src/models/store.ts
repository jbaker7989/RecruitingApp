import { trace } from '@opentelemetry/api';
import { dirname, join, resolve } from 'path';
import { readFile, writeFile, mkdir, rename, access, constants } from 'fs/promises';
import { existsSync } from 'fs';
import { AsyncLocalStorage } from 'async_hooks';
import { createHash } from 'crypto';
import * as pgb from './pgBackend.js';
import dotenv from 'dotenv';
import { withStoreSpan } from '../telemetry/p2Operations.js';

dotenv.config();

// DATA_DIR env override allows tests to run against isolated temp directories.
// Paths are re-resolved on every call so that setting process.env.DATA_DIR before
// (re-)importing src/index.js always takes effect even when other test files have
// already loaded the store module into the ESM cache.
// ponytail: replace with a reinit() call + plain lets when the test-runner constraint is gone.
function dataDir() { return process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(process.cwd(), 'data'); }
function storeFile() { return join(dataDir(), 'store.json'); }
function observabilityFile() { return join(dataDir(), 'observability.json'); }

export interface Company {
  id: string;
  companyName: string;
  description: string;
  location: string;
  companySize: string;
  industry: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayRange {
  min: number;
  max: number;
  currency: string;
}

export interface JobPosting {
  id: string;
  companyId: string;
  jobTitle: string;
  positionDescription: string;
  requirements: string[];
  positionLocation: string;
  payRange: PayRange;
  responsibilities: string[];
  qualifications: string[];
  requiredSkills: string[];
  requiredExperience: number;
  reportsTo: string;
  isActive: boolean;
  totalOpenings: number;
  currentApplications: number;
  createdAt: string;
  updatedAt: string;
}

export interface EducationEntry {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string;
  endDate: string;
  gpa?: string;
}

export interface EmploymentEntry {
  company: string;
  position: string;
  startDate: string;
  endDate: string;
  responsibilities?: string[];
}

export interface Applicant {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  passwordHash: string | null;
  phone: string;
  preferredContactMethod: 'email' | 'sms';
  address: { state: string; zip: string };
  educationHistory: EducationEntry[];
  employmentHistory: EmploymentEntry[];
  rightToWork: boolean;
  requiresSponsorship: boolean;
  expectedPay: number;
  notificationToManager: boolean;
  hireRecords: string[];
  oauthProvider: string | null;
  oauthProviderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HireRecord {
  id: string;
  applicantId: string;
  companyId: string;
  jobPostingId: string;
  hireDate: string;
  positionTitle: string;
  status: 'active' | 'probation' | 'terminated';
  notifiedEmployer: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationStatus = 'pending' | 'reviewed' | 'accepted' | 'rejected' | 'interview scheduled';

export interface Application {
  id: string;
  applicantId: string;
  jobPostingId: string;
  status: ApplicationStatus;
  matchScore: number;
  keywordMatches: object[];
  educationMatchScore: number;
  experienceMatchScore: number;
  appliedAt: string;
  updatedAt: string;
  emailConfirmed: boolean;
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'member-services' | 'recruiter' | 'hiring-manager' | 'applicant';
  email: string;
  companyId?: string;
  createdAt: string;
  oauthProvider: string | null;
}

export interface ObservabilityLog {
  id: string;
  timestamp: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  details: object;
  outcome: 'success' | 'failure';
}

export type DraftStatus = 'draft' | 'published' | 'archived';

export interface JDGInput {
  companyId?: string;
  jobTitle: string;
  department?: string;
  seniority?: string;
  requirements?: string[];
  responsibilities?: string[];
  qualifications?: string[];
  requiredSkills?: string[];
  location?: string;
  remotePolicy?: string;
  compensation?: { min?: number; max?: number; currency?: string };
  tone?: string;
}

export interface JDGOutput {
  summary: string;
  positionDescription: string;
  responsibilities: string[];
  qualifications: string[];
  requirements: string[];
  requiredSkills: string[];
  requiredExperience: number;
  keywords: string[];
  confidence: number;
}

export interface JobDraft {
  id: string;
  companyId: string;
  userId: string;
  status: DraftStatus;
  input: JDGInput;
  output: JDGOutput;
  variantOf?: string;
  variantsGenerated: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface PasswordResetToken {
  id: string;
  applicantId: string;
  email: string;
  token: string;
  expiresAt: string; // ISO 8601 — tokens older than this are invalid
  usedAt: string | null; // ISO 8601 — non-null means consumed (single-use)
  createdAt: string;
}

export interface DataStore {
  companies: Company[];
  jobs: JobPosting[];
  applicants: Applicant[];
  applications: Application[];
  users: User[];
  hires: HireRecord[];
  observability: ObservabilityLog[];
  drafts: JobDraft[];
  passwordResetTokens: PasswordResetToken[];
}


// ---------------------------------------------------------------------------
// Backend selection (fails closed) — see docs/implementation/db-storage-contract.md
// ---------------------------------------------------------------------------

export class StoreConfigError extends Error {}
export class LegacyWholesaleWriteError extends Error {}
export class StaleStoreWriteError extends Error {}
export class StoreReentrancyError extends Error {}

export type StoreMode = 'json' | 'postgres';

function resolveBackend(): { mode: 'json' } | { mode: 'postgres'; url: string } {
  const url = process.env.DATABASE_URL?.trim();
  const flag = process.env.USE_DATABASE?.trim().toLowerCase();
  if (flag && flag !== 'true' && flag !== 'false') throw new StoreConfigError('USE_DATABASE must be "true" or "false"');
  if (flag === 'true' && !url) throw new StoreConfigError('USE_DATABASE=true requires DATABASE_URL');
  if (url && flag !== 'false') return { mode: 'postgres', url };
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_JSON_STORE !== 'true') {
    throw new StoreConfigError('Production requires DATABASE_URL (durable store); set ALLOW_JSON_STORE=true only to accept an ephemeral JSON store');
  }
  return { mode: 'json' };
}

export function getStoreMode(): StoreMode { return resolveBackend().mode; }

// Re-entrancy guard: mutators must not call back into the store.
const inMutator = new AsyncLocalStorage<true>();
function assertNotInMutator(op: string): void {
  if (inMutator.getStore()) throw new StoreReentrancyError(`${op}() must not be called inside an updateStore mutator`);
}

// ---------------------------------------------------------------------------
// JSON backend (local/test). In-process serialized, atomic file replace.
// Not safe for multiple processes; not durable on ephemeral filesystems.
// ---------------------------------------------------------------------------

async function ensureDataDir() {
  if (!existsSync(dataDir())) {
    await mkdir(dataDir(), { recursive: true });
  }
}

export function emptyStore(): DataStore {
  return {
    companies: [],
    jobs: [],
    applicants: [],
    applications: [],
    users: [],
    hires: [],
    observability: [],
    drafts: [],
    passwordResetTokens: [],
  };
}

// Buckets reveal workload scale without retaining file contents or record identities.
function recordStoreScale(bytes: number, count?: number): void {
  try {
    const span = trace.getActiveSpan();
    span?.setAttribute('app.size_bucket', bytes === 0 ? '0' : bytes <= 1024 ? '1-1024' : bytes <= 65536 ? '1025-65536' : '65537+');
    if (count !== undefined) span?.setAttribute('app.count_bucket', count === 0 ? '0' : count <= 10 ? '1-10' : count <= 50 ? '11-50' : '51+');
    span?.setAttribute('app.store.io_class', 'ok');
  } catch { /* scale diagnostics never affect persistence */ }
}

function countRecords(v: object): number {
  return Object.values(v).reduce<number>((n, x) => n + (Array.isArray(x) ? x.length : 0), 0);
}

let jsonQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = jsonQueue.then(fn, fn);
  jsonQueue = run.catch(() => {});
  return run;
}

// Revision of the file a DataStore snapshot was read from, for stale legacy-write detection.
const snapshotRevision = new WeakMap<object, string>();
const revisionOf = (raw: string) => createHash('sha1').update(raw).digest('hex');

async function jsonReadRaw(): Promise<string> {
  await ensureDataDir();
  return readFile(storeFile(), 'utf-8');
}

async function jsonWriteAtomic(file: string, serializedData: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, serializedData, 'utf-8');
  await rename(tmp, file);
}

function jsonParseStore(raw: string): DataStore {
  // Normalize on read (NFR-004): files written before a collection existed are migrated in memory.
  return { ...emptyStore(), ...JSON.parse(raw) };
}

export async function readStore(): Promise<DataStore> {
  assertNotInMutator('readStore');
  const backend = resolveBackend();
  return withStoreSpan('read', 'store', async () => {
    if (backend.mode === 'postgres') return pgb.pgReadStore(backend.url);
    const raw = await jsonReadRaw();
    const parsed = jsonParseStore(raw);
    recordStoreScale(Buffer.byteLength(raw), countRecords(parsed));
    snapshotRevision.set(parsed, revisionOf(raw));
    return parsed;
  });
}

/**
 * Atomic read-latest → mutate → commit. Resolves only after commit; a throwing mutator rolls back.
 * Mutators must not call store functions, perform network work, or send HTTP responses.
 */
export async function updateStore<T>(mutator: (store: DataStore) => T | Promise<T>): Promise<T> {
  assertNotInMutator('updateStore');
  const backend = resolveBackend();
  const guarded = (store: DataStore) => inMutator.run(true, () => mutator(store));
  // Telemetry keeps the legacy shape: sibling `store.read` and `store.write` spans under the caller.
  const traceRead = <R>(fn: () => Promise<R>) => withStoreSpan('read', 'store', fn);
  const traceWrite = <R>(fn: () => Promise<R>) => withStoreSpan('write', 'store', fn);
  if (backend.mode === 'postgres') return pgb.pgUpdateStore(backend.url, guarded, traceRead, traceWrite);
  return serialized(async () => {
    await ensureDataDir();
    const store = await traceRead(async () => {
      const raw = existsSync(storeFile()) ? await readFile(storeFile(), 'utf-8') : null;
      return raw === null ? emptyStore() : jsonParseStore(raw);
    });
    const result = await guarded(store);
    await traceWrite(async () => {
      const out = JSON.stringify(store, null, 2);
      await jsonWriteAtomic(storeFile(), out);
      recordStoreScale(Buffer.byteLength(out), countRecords(store));
    });
    return result;
  });
}

/**
 * LEGACY wholesale write. Postgres: always refused (it would overwrite concurrent commits).
 * JSON: allowed for seeding, but rejected when `data` is a stale snapshot from readStore().
 */
export async function writeStore(data: DataStore): Promise<void> {
  assertNotInMutator('writeStore');
  const backend = resolveBackend();
  if (backend.mode === 'postgres') {
    throw new LegacyWholesaleWriteError('writeStore() is not supported with the database backend; use updateStore()');
  }
  return withStoreSpan('write', 'store', () => serialized(async () => {
    await ensureDataDir();
    const rev = snapshotRevision.get(data);
    if (rev !== undefined && existsSync(storeFile())) {
      const current = revisionOf(await readFile(storeFile(), 'utf-8'));
      if (current !== rev) throw new StaleStoreWriteError('writeStore() refused: store changed since this snapshot was read; use updateStore()');
    }
    const out = JSON.stringify(data, null, 2);
    await jsonWriteAtomic(storeFile(), out);
    snapshotRevision.set(data, revisionOf(out));
    recordStoreScale(Buffer.byteLength(out), countRecords(data));
  }));
}

async function jsonReadAudit(): Promise<ObservabilityLog[]> {
  await ensureDataDir();
  if (!existsSync(observabilityFile())) return [];
  const data = await readFile(observabilityFile(), 'utf-8');
  const logs = JSON.parse(data).logs || [];
  recordStoreScale(Buffer.byteLength(data), logs.length);
  return logs;
}

export async function readObservability(): Promise<ObservabilityLog[]> {
  assertNotInMutator('readObservability');
  const backend = resolveBackend();
  return withStoreSpan('audit_read', 'store', async () => {
    if (backend.mode === 'postgres') return pgb.pgReadAudit(backend.url);
    await ensureDataDir();
    if (!existsSync(observabilityFile())) {
      await writeFile(observabilityFile(), JSON.stringify({ logs: [] }, null, 2), 'utf-8');
      return [];
    }
    return jsonReadAudit();
  });
}

/** LEGACY: whole-log overwrite; JSON only. Use addObservabilityEntry to append. */
export async function writeObservability(logs: ObservabilityLog[]): Promise<void> {
  assertNotInMutator('writeObservability');
  if (resolveBackend().mode === 'postgres') {
    throw new LegacyWholesaleWriteError('writeObservability() is not supported with the database backend; use addObservabilityEntry()');
  }
  return withStoreSpan('audit_write', 'store', () => serialized(async () => {
    await ensureDataDir();
    const out = JSON.stringify({ logs }, null, 2);
    await jsonWriteAtomic(observabilityFile(), out);
    recordStoreScale(Buffer.byteLength(out), logs.length);
  }));
}

// addObservabilityEntry creates a parent audit_append span; JSON mode keeps read and write as
// child spans within it so analysts do not add inclusive and exclusive durations (S08-AC2).
// Telemetry errors must not trigger a recursive audit write (S08-AC3).
export async function addObservabilityEntry(entry: ObservabilityLog): Promise<void> {
  assertNotInMutator('addObservabilityEntry');
  const backend = resolveBackend();
  return withStoreSpan('audit_append', 'store', async () => {
    if (backend.mode === 'postgres') return pgb.pgAppendAudit(backend.url, entry);
    // Serialize the whole read-append-write so concurrent appends are never lost.
    return serialized(async () => {
      const logs = await jsonReadAuditSpan();
      logs.push(entry);
      await jsonWriteAuditSpan(logs);
    });
  });
}

// The child spans must not re-enter the serialization queue (already held by the caller).
async function jsonReadAuditSpan(): Promise<ObservabilityLog[]> {
  return withStoreSpan('audit_read', 'store', async () => {
    await ensureDataDir();
    if (!existsSync(observabilityFile())) {
      await writeFile(observabilityFile(), JSON.stringify({ logs: [] }, null, 2), 'utf-8');
      return [];
    }
    return jsonReadAudit();
  });
}
async function jsonWriteAuditSpan(logs: ObservabilityLog[]): Promise<void> {
  return withStoreSpan('audit_write', 'store', async () => {
    const out = JSON.stringify({ logs }, null, 2);
    await jsonWriteAtomic(observabilityFile(), out);
    recordStoreScale(Buffer.byteLength(out), logs.length);
  });
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export async function initializeStore(): Promise<DataStore> {
  const backend = resolveBackend();
  if (backend.mode === 'postgres') {
    await pgb.ensureSchema(backend.url); // throws if unreachable: startup fails closed
    return pgb.pgReadStore(backend.url);
  }
  await ensureDataDir();
  if (!existsSync(storeFile())) {
    const initialStore: DataStore = emptyStore();
    await writeStore(initialStore);
    return initialStore;
  }
  return readStore();
}

/** Dependency probe for /ready: reports reachability only, never details. */
export async function checkStoreHealth(): Promise<'up' | 'down'> {
  try {
    const backend = resolveBackend();
    if (backend.mode === 'postgres') return (await pgb.ping(backend.url)) ? 'up' : 'down';
    await access(dataDir(), constants.R_OK);
    return 'up';
  } catch {
    return 'down';
  }
}

export async function closeStore(): Promise<void> {
  await pgb.closePool();
}
