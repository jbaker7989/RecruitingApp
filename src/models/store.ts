import { trace } from '@opentelemetry/api';
import { dirname, join, resolve } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
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

async function ensureDataDir() {
  if (!existsSync(dataDir())) {
    await mkdir(dataDir(), { recursive: true });
  }
}

// Fresh-empty store: defaults for every collection. Returned arrays are new
// instances on each call so callers can never mutate shared module state.
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

export async function readStore(): Promise<DataStore> {
  return withStoreSpan('read', 'store', async () => {
    await ensureDataDir();
    const data = await readFile(storeFile(), 'utf-8');
    const parsed = JSON.parse(data);
    recordStoreScale(Buffer.byteLength(data), Object.values(parsed).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0));
    // Normalize on read (NFR-004): files written before a collection existed
    // (e.g. no `hires` key) are migrated in memory so store.hires.push/filter
    // et al. can never crash on undefined. The normalized shape is persisted
    // on the next writeStore call.
    return { ...emptyStore(), ...parsed };
  });
}

export async function writeStore(data: DataStore): Promise<void> {
  return withStoreSpan('write', 'store', async () => {
    await ensureDataDir();
    const serialized = JSON.stringify(data, null, 2);
    await writeFile(storeFile(), serialized, 'utf-8');
    recordStoreScale(Buffer.byteLength(serialized), Object.values(data).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0));
  });
}

export async function readObservability(): Promise<ObservabilityLog[]> {
  return withStoreSpan('audit_read', 'store', async () => {
    await ensureDataDir();
    if (!existsSync(observabilityFile())) {
      await writeFile(observabilityFile(), JSON.stringify({ logs: [] }, null, 2), 'utf-8');
      return [];
    }
    const data = await readFile(observabilityFile(), 'utf-8');
    const logs = JSON.parse(data).logs || [];
    recordStoreScale(Buffer.byteLength(data), logs.length);
    return logs;
  });
}

export async function writeObservability(logs: ObservabilityLog[]): Promise<void> {
  return withStoreSpan('audit_write', 'store', async () => {
    await ensureDataDir();
    const serialized = JSON.stringify({ logs }, null, 2);
    await writeFile(observabilityFile(), serialized, 'utf-8');
    recordStoreScale(Buffer.byteLength(serialized), logs.length);
  });
}

// addObservabilityEntry creates a parent audit_append span; read and write each
// run as child spans within it.  This makes the parent–child structure explicit
// so analysts do not add inclusive and exclusive durations (S08-AC2).
// Telemetry errors must not trigger a recursive audit write — withStoreSpan is
// fail-open so this invariant is preserved (S08-AC3).
export async function addObservabilityEntry(entry: ObservabilityLog): Promise<void> {
  return withStoreSpan('audit_append', 'store', async () => {
    const logs = await readObservability();
    logs.push(entry);
    await writeObservability(logs);
  });
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export async function initializeStore(): Promise<DataStore> {
  await ensureDataDir();
  if (!existsSync(storeFile())) {
    const initialStore: DataStore = emptyStore();
    await writeStore(initialStore);
    return initialStore;
  }
  return readStore();
}
