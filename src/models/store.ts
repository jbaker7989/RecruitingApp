import { dirname, join, resolve } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// DATA_DIR env override allows tests to run against isolated temp directories
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(process.cwd(), 'data');
const STORE_FILE = join(DATA_DIR, 'store.json');
const OBSERVABILITY_FILE = join(DATA_DIR, 'observability.json');

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

export type EmploymentType = 'full-time' | 'part-time' | 'contract' | 'temporary' | 'internship' | 'volunteer' | 'self-employed';
export type WorkMode = 'onsite' | 'hybrid' | 'remote';

export interface EmploymentEntry {
  id?: string; // optional only for backwards compatibility; new entries always receive an ID
  company: string;
  position: string;
  positionDescription?: string;
  startDate: string;
  endDate?: string;
  currentPosition?: boolean;
  responsibilities?: string[];
  accomplishments?: string[];
  skills?: string[];
  employmentType?: EmploymentType;
  location?: string;
  workMode?: WorkMode;
}

export interface SkillEntry {
  name: string;
  proficiency: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  yearsUsed?: number;
  lastUsed?: string;
}

export interface ApplicantAvatar {
  kind: 'default-person-icon' | 'upload';
  icon: 'person';
  altText: string;
  provider?: 'vercel-blob';
  url?: string;
  pathname?: string;
  contentType?: string;
  size?: number;
}

export interface ProfileCompleteness {
  percent: number;
  missingSections: string[];
}

export interface Applicant {
  id: string;
  userId?: string | null;
  personId?: string;
  profileVersion?: number;
  profileStatus?: 'draft' | 'complete' | 'archived';
  firstName: string;
  lastName: string;
  preferredName?: string;
  pronouns?: string;
  headline?: string;
  professionalSummary?: string;
  email: string;
  phone: string;
  preferredContactMethod: 'email' | 'sms';
  contactVisibility?: { email: 'authorized-staff'; phone: 'post-initial-review' };
  avatar?: ApplicantAvatar;
  address: { city?: string; state: string; zip: string; country?: 'US' };
  educationHistory: EducationEntry[];
  employmentHistory: EmploymentEntry[];
  skills?: SkillEntry[];
  rightToWork: boolean;
  requiresSponsorship: boolean;
  expectedPay: number;
  notificationToManager: boolean;
  hireRecords: string[];
  completeness?: ProfileCompleteness;
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
  personId?: string;
  applicantId?: string | null;
  username: string;
  passwordHash: string;
  role: 'member-services' | 'recruiter' | 'hiring-manager' | 'applicant';
  email: string;
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

export interface DataStore {
  companies: Company[];
  jobs: JobPosting[];
  applicants: Applicant[];
  applications: Application[];
  users: User[];
  hires: HireRecord[];
  observability: ObservabilityLog[];
}

async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
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
  };
}

export async function readStore(): Promise<DataStore> {
  await ensureDataDir();
  const data = await readFile(STORE_FILE, 'utf-8');
  const parsed = JSON.parse(data);
  // Normalize on read (NFR-004): files written before a collection existed
  // (e.g. no `hires` key) are migrated in memory so store.hires.push/filter
  // et al. can never crash on undefined. The normalized shape is persisted
  // on the next writeStore call.
  return { ...emptyStore(), ...parsed };
}

export async function writeStore(data: DataStore): Promise<void> {
  await ensureDataDir();
  await writeFile(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export async function readObservability(): Promise<ObservabilityLog[]> {
  await ensureDataDir();
  if (!existsSync(OBSERVABILITY_FILE)) {
    await writeFile(OBSERVABILITY_FILE, JSON.stringify({ logs: [] }, null, 2), 'utf-8');
    return [];
  }
  const data = await readFile(OBSERVABILITY_FILE, 'utf-8');
  return JSON.parse(data).logs || [];
}

export async function writeObservability(logs: ObservabilityLog[]): Promise<void> {
  await ensureDataDir();
  await writeFile(OBSERVABILITY_FILE, JSON.stringify({ logs }, null, 2), 'utf-8');
}

export async function addObservabilityEntry(entry: ObservabilityLog): Promise<void> {
  const logs = await readObservability();
  logs.push(entry);
  await writeObservability(logs);
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export async function initializeStore(): Promise<DataStore> {
  await ensureDataDir();
  if (!existsSync(STORE_FILE)) {
    const initialStore: DataStore = emptyStore();
    await writeStore(initialStore);
    return initialStore;
  }
  return readStore();
}
