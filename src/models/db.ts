import { Pool, PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------

let pool: Pool | null = null;

export async function initializeDatabase() {
  if (pool) return;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected successfully');
  } catch (err) {
    console.warn('⚠️  Database connection failed — falling back to JSON store mode:', (err as Error).message);
    await pool.end().catch(() => {});
    pool = null;
  }
}

// ---------------------------------------------------------------------------
// Connection accessor (for tests)
// ---------------------------------------------------------------------------

export function getPool(): Pool | null { return pool; }

// ---------------------------------------------------------------------------
// Types — mirror store.ts interfaces
// ---------------------------------------------------------------------------

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

export interface JobPosting {
  id: string;
  companyId: string;
  jobTitle: string;
  positionDescription: string;
  requirements: string[];
  positionLocation: string;
  payRange: { min: number; max: number; currency: string };
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

export interface Applicant {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  passwordHash: string | null;
  phone: string;
  preferredContactMethod: 'email' | 'sms';
  address: { state: string; zip: string };
  educationHistory: { institution: string; degree: string; fieldOfStudy: string; startDate: string; endDate: string; gpa?: string }[];
  employmentHistory: { company: string; position: string; startDate: string; endDate: string; responsibilities?: string[] }[];
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

export interface Application {
  id: string;
  applicantId: string;
  jobPostingId: string;
  status: 'pending' | 'reviewed' | 'accepted' | 'rejected' | 'interview scheduled';
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

export interface JobDraft {
  id: string;
  companyId: string;
  userId: string;
  status: 'draft' | 'published' | 'archived';
  input: object;
  output: object | null;
  variantsGenerated: number;
  createdAt: string;
  updatedAt: string;
}

export interface PasswordResetToken {
  id: string;
  applicantId: string;
  email: string;
  token: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Schema initialization
// ---------------------------------------------------------------------------

export async function initializeSchema(): Promise<void> {
  if (!pool) throw new Error('Database not initialized (pool is null)');
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id         VARCHAR(255) PRIMARY KEY,
        company_name    VARCHAR(255) NOT NULL,
        description    TEXT,
        location    VARCHAR(255),
        company_size   VARCHAR(50),
        industry    VARCHAR(100),
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id                VARCHAR(255) PRIMARY KEY,
        company_id        VARCHAR(255),
        job_title         VARCHAR(255) NOT NULL,
        position_description TEXT,
        requirements      TEXT[],
        position_location VARCHAR(255),
        pay_range         JSONB,
        responsibilities   TEXT[],
        qualifications    TEXT[],
        required_skills   TEXT[],
        required_experience INTEGER,
        reports_to        VARCHAR(255),
        is_active         BOOLEAN DEFAULT TRUE,
        total_openings    INTEGER DEFAULT 1,
        current_applications INTEGER DEFAULT 0,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS applicants (
        id                         VARCHAR(255) PRIMARY KEY,
        first_name                 VARCHAR(100) NOT NULL,
        last_name                  VARCHAR(100) NOT NULL,
        email                      VARCHAR(255) UNIQUE,
        password_hash              VARCHAR(255),
        phone                      VARCHAR(50),
        preferred_contact_method   VARCHAR(10) CHECK (preferred_contact_method IN ('email', 'sms')),
        address                    JSONB,
        education_history          JSONB,
        employment_history         JSONB,
        right_to_work              BOOLEAN DEFAULT FALSE,
        requires_sponsorship       BOOLEAN DEFAULT FALSE,
        expected_pay               DECIMAL(12,2),
        notification_to_manager    BOOLEAN DEFAULT FALSE,
        hire_records               TEXT[],
        oauth_provider             VARCHAR(100),
        oauth_provider_id          VARCHAR(100),
        created_at                 TIMESTAMPTZ DEFAULT NOW(),
        updated_at                 TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS applications (
        id                     VARCHAR(255) PRIMARY KEY,
        applicant_id           VARCHAR(255) NOT NULL,
        job_posting_id         VARCHAR(255) NOT NULL,
        status                 VARCHAR(30) CHECK (status IN ('pending','reviewed','accepted','rejected','interview scheduled')),
        match_score            NUMERIC(5,2),
        keyword_matches        JSONB,
        education_match_score  NUMERIC(5,2),
        experience_match_score NUMERIC(5,2),
        applied_at             TIMESTAMPTZ DEFAULT NOW(),
        updated_at             TIMESTAMPTZ DEFAULT NOW(),
        email_confirmed        BOOLEAN DEFAULT FALSE,
        UNIQUE(applicant_id, job_posting_id)
      );

      CREATE TABLE IF NOT EXISTS users (
        id              VARCHAR(255) PRIMARY KEY,
        username        VARCHAR(100) UNIQUE NOT NULL,
        password_hash   VARCHAR(255) NOT NULL,
        role            VARCHAR(30) CHECK (role IN ('member-services','recruiter','hiring-manager','applicant')),
        email           VARCHAR(255) UNIQUE NOT NULL,
        company_id      VARCHAR(255),
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        oauth_provider  VARCHAR(100),
        oauth_provider_id VARCHAR(100)
      );

      CREATE TABLE IF NOT EXISTS hires (
        id                VARCHAR(255) PRIMARY KEY,
        applicant_id      VARCHAR(255) NOT NULL,
        company_id        VARCHAR(255),
        job_posting_id    VARCHAR(255),
        hire_date         TIMESTAMPTZ DEFAULT NOW(),
        position_title    VARCHAR(255) NOT NULL,
        status            VARCHAR(20) CHECK (status IN ('active','probation','terminated')),
        notified_employer BOOLEAN DEFAULT FALSE,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS observability (
        id          VARCHAR(255) PRIMARY KEY,
        timestamp   TIMESTAMPTZ DEFAULT NOW(),
        action      VARCHAR(100),
        entity_type VARCHAR(50),
        entity_id   VARCHAR(255),
        user_id     VARCHAR(255),
        details     JSONB,
        outcome     VARCHAR(20)
      );

      CREATE TABLE IF NOT EXISTS drafts (
        id                  VARCHAR(255) PRIMARY KEY,
        company_id          VARCHAR(255),
        user_id             VARCHAR(255),
        status              VARCHAR(20) CHECK (status IN ('draft','published','archived')),
        input               JSONB,
        output              JSONB,
        variants_generated  INTEGER DEFAULT 0,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id           VARCHAR(255) PRIMARY KEY,
        applicant_id VARCHAR(255) NOT NULL,
        email        VARCHAR(255) NOT NULL,
        token        VARCHAR(255) UNIQUE NOT NULL,
        expires_at   TIMESTAMPTZ NOT NULL,
        used_at      TIMESTAMPTZ,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Database schema initialized');
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function release(client: PoolClient) { client.release(); }

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapCompany(r: any): Company {
  return {
    id: r.id,
    companyName: r.company_name,
    description: r.description ?? '',
    location: r.location ?? '',
    companySize: r.company_size ?? '',
    industry: r.industry ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapJob(r: any): JobPosting {
  const payRange = typeof r.pay_range === 'object' && r.pay_range !== null
    ? r.pay_range as { min: number; max: number; currency: string }
    : { min: 0, max: 0, currency: 'USD' };
  return {
    id: r.id,
    companyId: r.company_id ?? '',
    jobTitle: r.job_title ?? '',
    positionDescription: r.position_description ?? '',
    requirements: r.requirements ?? [],
    positionLocation: r.position_location ?? '',
    payRange,
    responsibilities: r.responsibilities ?? [],
    qualifications: r.qualifications ?? [],
    requiredSkills: r.required_skills ?? [],
    requiredExperience: r.required_experience ?? 0,
    reportsTo: r.reports_to ?? '',
    isActive: r.is_active ?? true,
    totalOpenings: r.total_openings ?? 1,
    currentApplications: r.current_applications ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapApplicant(r: any): Applicant {
  return {
    id: r.id,
    firstName: r.first_name ?? '',
    lastName: r.last_name ?? '',
    email: r.email ?? null,
    passwordHash: r.password_hash ?? null,
    phone: r.phone ?? '',
    preferredContactMethod: r.preferred_contact_method ?? 'email',
    address: typeof r.address === 'object' && r.address !== null ? r.address : { state: '', zip: '' },
    educationHistory: Array.isArray(r.education_history) ? r.education_history : [],
    employmentHistory: Array.isArray(r.employment_history) ? r.employment_history : [],
    rightToWork: r.right_to_work ?? false,
    requiresSponsorship: r.requires_sponsorship ?? false,
    expectedPay: Number(r.expected_pay) || 0,
    notificationToManager: r.notification_to_manager ?? false,
    hireRecords: Array.isArray(r.hire_records) ? r.hire_records : [],
    oauthProvider: r.oauth_provider ?? null,
    oauthProviderId: r.oauth_provider_id ?? null,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
  };
}

function mapApplication(r: any): Application {
  return {
    id: r.id,
    applicantId: r.applicant_id ?? '',
    jobPostingId: r.job_posting_id ?? '',
    status: r.status ?? 'pending',
    matchScore: Number(r.match_score) || 0,
    keywordMatches: Array.isArray(r.keyword_matches) ? r.keyword_matches : [],
    educationMatchScore: Number(r.education_match_score) || 0,
    experienceMatchScore: Number(r.experience_match_score) || 0,
    appliedAt: r.applied_at ?? '',
    updatedAt: r.updated_at ?? '',
    emailConfirmed: r.email_confirmed ?? false,
  };
}

function mapUser(r: any): User {
  return {
    id: r.id,
    username: r.username ?? '',
    passwordHash: r.password_hash ?? '',
    role: r.role ?? 'applicant',
    email: r.email ?? '',
    companyId: r.company_id ?? undefined,
    createdAt: r.created_at ?? '',
    oauthProvider: r.oauth_provider ?? null,
  };
}

function mapHire(r: any): HireRecord {
  return {
    id: r.id,
    applicantId: r.applicant_id ?? '',
    companyId: r.company_id ?? '',
    jobPostingId: r.job_posting_id ?? '',
    hireDate: r.hire_date ?? '',
    positionTitle: r.position_title ?? '',
    status: r.status ?? 'active',
    notifiedEmployer: r.notified_employer ?? false,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
  };
}

function mapObservability(r: any): ObservabilityLog {
  return {
    id: r.id,
    timestamp: r.timestamp ?? '',
    action: r.action ?? '',
    entityType: r.entity_type ?? '',
    entityId: r.entity_id ?? '',
    userId: r.user_id ?? '',
    details: typeof r.details === 'object' && r.details !== null ? r.details : {},
    outcome: r.outcome ?? 'success',
  };
}

function mapDraft(r: any): JobDraft {
  return {
    id: r.id,
    companyId: r.company_id ?? '',
    userId: r.user_id ?? '',
    status: r.status ?? 'draft',
    input: typeof r.input === 'object' && r.input !== null ? r.input : {},
    output: typeof r.output === 'object' && r.output !== null ? r.output : null,
    variantsGenerated: r.variants_generated ?? 0,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
  };
}

function mapPasswordResetToken(r: any): PasswordResetToken {
  return {
    id: r.id,
    applicantId: r.applicant_id ?? '',
    email: r.email ?? '',
    token: r.token ?? '',
    expiresAt: r.expires_at ?? '',
    usedAt: r.used_at ?? null,
    createdAt: r.created_at ?? '',
  };
}

// ---------------------------------------------------------------------------
// Company CRUD
// ---------------------------------------------------------------------------

export async function saveCompany(c: Company): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO companies (id, company_name, description, location, company_size, industry, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (id) DO UPDATE SET
         company_name=EXCLUDED.company_name, description=EXCLUDED.description,
         location=EXCLUDED.location, company_size=EXCLUDED.company_size,
         industry=EXCLUDED.industry, updated_at=NOW()`,
      [c.id, c.companyName, c.description, c.location, c.companySize, c.industry, c.createdAt]
    );
  } finally { client.release(); }
}

export async function findCompanies(): Promise<Company[]> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const rows = await client.query('SELECT * FROM companies ORDER BY id LIMIT 500');
    return rows.rows.map(mapCompany);
  } finally { client.release(); }
}

export async function findCompany(id: string): Promise<Company | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM companies WHERE id=$1 LIMIT 1', [id]);
    return row.rows[0] ? mapCompany(row.rows[0]) : null;
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Job CRUD
// ---------------------------------------------------------------------------

export async function saveJobPosting(j: JobPosting): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO jobs (id, company_id, job_title, position_description, requirements, position_location,
                          pay_range, responsibilities, qualifications, required_skills, required_experience,
                          reports_to, is_active, total_openings, current_applications, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
       ON CONFLICT (id) DO UPDATE SET
         company_id=EXCLUDED.company_id, job_title=EXCLUDED.job_title,
         position_description=EXCLUDED.position_description, requirements=EXCLUDED.requirements,
         position_location=EXCLUDED.position_location, pay_range=EXCLUDED.pay_range,
         responsibilities=EXCLUDED.responsibilities, qualifications=EXCLUDED.qualifications,
         required_skills=EXCLUDED.required_skills, required_experience=EXCLUDED.required_experience,
         reports_to=EXCLUDED.reports_to, is_active=EXCLUDED.is_active,
         total_openings=EXCLUDED.total_openings, current_applications=EXCLUDED.current_applications,
         updated_at=NOW()`,
      [j.id, j.companyId, j.jobTitle, j.positionDescription, j.requirements, j.positionLocation,
       JSON.stringify(j.payRange), j.responsibilities, j.qualifications, j.requiredSkills,
       j.requiredExperience, j.reportsTo, j.isActive, j.totalOpenings, j.currentApplications, j.createdAt]
    );
  } finally { client.release(); }
}

export async function findJobPostings(): Promise<JobPosting[]> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const rows = await client.query('SELECT * FROM jobs ORDER BY id LIMIT 500');
    return rows.rows.map(mapJob);
  } finally { client.release(); }
}

export async function findJobPosting(id: string): Promise<JobPosting | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM jobs WHERE id=$1 LIMIT 1', [id]);
    return row.rows[0] ? mapJob(row.rows[0]) : null;
  } finally { client.release(); }
}

export async function findJobPostingsByCompany(companyId: string): Promise<JobPosting[]> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const rows = await client.query('SELECT * FROM jobs WHERE company_id=$1 ORDER BY id', [companyId]);
    return rows.rows.map(mapJob);
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Applicant CRUD
// ---------------------------------------------------------------------------

export async function saveApplicant(a: Applicant): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO applicants (id, first_name, last_name, email, password_hash, phone, preferred_contact_method,
                                address, education_history, employment_history, right_to_work, requires_sponsorship,
                                expected_pay, notification_to_manager, hire_records, oauth_provider, oauth_provider_id,
                                created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
       ON CONFLICT (id) DO UPDATE SET
         first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, email=EXCLUDED.email,
         password_hash=EXCLUDED.password_hash, phone=EXCLUDED.phone,
         preferred_contact_method=EXCLUDED.preferred_contact_method, address=EXCLUDED.address,
         education_history=EXCLUDED.education_history, employment_history=EXCLUDED.employment_history,
         right_to_work=EXCLUDED.right_to_work, requires_sponsorship=EXCLUDED.requires_sponsorship,
         expected_pay=EXCLUDED.expected_pay, notification_to_manager=EXCLUDED.notification_to_manager,
         hire_records=EXCLUDED.hire_records, oauth_provider=EXCLUDED.oauth_provider,
         oauth_provider_id=EXCLUDED.oauth_provider_id, updated_at=NOW()`,
      [a.id, a.firstName, a.lastName, a.email, a.passwordHash, a.phone, a.preferredContactMethod,
       JSON.stringify(a.address), JSON.stringify(a.educationHistory), JSON.stringify(a.employmentHistory),
       a.rightToWork, a.requiresSponsorship, a.expectedPay, a.notificationToManager,
       a.hireRecords, a.oauthProvider, a.oauthProviderId, a.createdAt]
    );
  } finally { client.release(); }
}

export async function findApplicants(): Promise<Applicant[]> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const rows = await client.query('SELECT * FROM applicants ORDER BY id LIMIT 500');
    return rows.rows.map(mapApplicant);
  } finally { client.release(); }
}

export async function findApplicant(id: string): Promise<Applicant | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM applicants WHERE id=$1 LIMIT 1', [id]);
    return row.rows[0] ? mapApplicant(row.rows[0]) : null;
  } finally { client.release(); }
}

export async function findApplicantByEmail(email: string): Promise<Applicant | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM applicants WHERE email=$1 LIMIT 1', [email]);
    return row.rows[0] ? mapApplicant(row.rows[0]) : null;
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Application CRUD
// ---------------------------------------------------------------------------

export async function saveApplication(a: Application): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO applications (id, applicant_id, job_posting_id, status, match_score, keyword_matches,
                                  education_match_score, experience_match_score, applied_at, updated_at, email_confirmed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10)
       ON CONFLICT (id) DO UPDATE SET
         applicant_id=EXCLUDED.applicant_id, job_posting_id=EXCLUDED.job_posting_id,
         status=EXCLUDED.status, match_score=EXCLUDED.match_score,
         keyword_matches=EXCLUDED.keyword_matches, education_match_score=EXCLUDED.education_match_score,
         experience_match_score=EXCLUDED.experience_match_score, updated_at=NOW(),
         email_confirmed=EXCLUDED.email_confirmed`,
      [a.id, a.applicantId, a.jobPostingId, a.status, a.matchScore, JSON.stringify(a.keywordMatches),
       a.educationMatchScore, a.experienceMatchScore, a.appliedAt, a.emailConfirmed]
    );
  } finally { client.release(); }
}

export async function findApplications(): Promise<Application[]> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const rows = await client.query('SELECT * FROM applications ORDER BY id LIMIT 500');
    return rows.rows.map(mapApplication);
  } finally { client.release(); }
}

export async function findApplication(id: string): Promise<Application | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM applications WHERE id=$1 LIMIT 1', [id]);
    return row.rows[0] ? mapApplication(row.rows[0]) : null;
  } finally { client.release(); }
}

export async function findApplicationsByApplicant(applicantId: string): Promise<Application[]> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const rows = await client.query('SELECT * FROM applications WHERE applicant_id=$1', [applicantId]);
    return rows.rows.map(mapApplication);
  } finally { client.release(); }
}

export async function findApplicationsByJob(jobPostingId: string): Promise<Application[]> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const rows = await client.query('SELECT * FROM applications WHERE job_posting_id=$1', [jobPostingId]);
    return rows.rows.map(mapApplication);
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// User CRUD
// ---------------------------------------------------------------------------

export async function saveUser(u: User): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO users (id, username, password_hash, role, email, company_id, created_at, oauth_provider, oauth_provider_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         username=EXCLUDED.username, password_hash=EXCLUDED.password_hash, role=EXCLUDED.role,
         email=EXCLUDED.email, company_id=EXCLUDED.company_id,
         oauth_provider=EXCLUDED.oauth_provider, oauth_provider_id=EXCLUDED.oauth_provider_id`,
      [u.id, u.username, u.passwordHash, u.role, u.email, u.companyId ?? null, u.createdAt, u.oauthProvider, null]
    );
  } finally { client.release(); }
}

export async function findUsers(): Promise<User[]> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const rows = await client.query('SELECT * FROM users ORDER BY id LIMIT 500');
    return rows.rows.map(mapUser);
  } finally { client.release(); }
}

export async function findUser(id: string): Promise<User | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM users WHERE id=$1 LIMIT 1', [id]);
    return row.rows[0] ? mapUser(row.rows[0]) : null;
  } finally { client.release(); }
}

export async function findUserByUsername(username: string): Promise<User | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM users WHERE username=$1 LIMIT 1', [username]);
    return row.rows[0] ? mapUser(row.rows[0]) : null;
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Hire CRUD
// ---------------------------------------------------------------------------

export async function saveHireRecord(h: HireRecord): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO hires (id, applicant_id, company_id, job_posting_id, hire_date, position_title,
                           status, notified_employer, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (id) DO UPDATE SET
         applicant_id=EXCLUDED.applicant_id, company_id=EXCLUDED.company_id,
         job_posting_id=EXCLUDED.job_posting_id, hire_date=EXCLUDED.hire_date,
         position_title=EXCLUDED.position_title, status=EXCLUDED.status,
         notified_employer=EXCLUDED.notified_employer, updated_at=NOW()`,
      [h.id, h.applicantId, h.companyId, h.jobPostingId, h.hireDate, h.positionTitle, h.status, h.notifiedEmployer, h.createdAt]
    );
  } finally { client.release(); }
}

export async function findHireRecords(): Promise<HireRecord[]> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const rows = await client.query('SELECT * FROM hires ORDER BY id LIMIT 500');
    return rows.rows.map(mapHire);
  } finally { client.release(); }
}

export async function findHireRecord(id: string): Promise<HireRecord | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM hires WHERE id=$1 LIMIT 1', [id]);
    return row.rows[0] ? mapHire(row.rows[0]) : null;
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Observability CRUD
// ---------------------------------------------------------------------------

export async function addObservabilityEntry(e: ObservabilityLog): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO observability (id, timestamp, action, entity_type, entity_id, user_id, details, outcome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         timestamp=EXCLUDED.timestamp, action=EXCLUDED.action, entity_type=EXCLUDED.entity_type,
         entity_id=EXCLUDED.entity_id, user_id=EXCLUDED.user_id, details=EXCLUDED.details, outcome=EXCLUDED.outcome`,
      [e.id, e.timestamp, e.action, e.entityType, e.entityId, e.userId, JSON.stringify(e.details), e.outcome]
    );
  } finally { client.release(); }
}

export async function findObservabilityLog(id: string): Promise<ObservabilityLog | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM observability WHERE id=$1 LIMIT 1', [id]);
    return row.rows[0] ? mapObservability(row.rows[0]) : null;
  } finally { client.release(); }
}

export async function findObservabilityLogs(limit = 100): Promise<ObservabilityLog[]> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const rows = await client.query('SELECT * FROM observability ORDER BY timestamp DESC LIMIT $1', [limit]);
    return rows.rows.map(mapObservability);
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Draft CRUD
// ---------------------------------------------------------------------------

export async function saveDraft(d: JobDraft): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO drafts (id, company_id, user_id, status, input, output, variants_generated, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (id) DO UPDATE SET
         company_id=EXCLUDED.company_id, user_id=EXCLUDED.user_id, status=EXCLUDED.status,
         input=EXCLUDED.input, output=EXCLUDED.output, variants_generated=EXCLUDED.variants_generated,
         updated_at=NOW()`,
      [d.id, d.companyId, d.userId, d.status, JSON.stringify(d.input), d.output ? JSON.stringify(d.output) : null, d.variantsGenerated, d.createdAt]
    );
  } finally { client.release(); }
}

export async function findDrafts(): Promise<JobDraft[]> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const rows = await client.query('SELECT * FROM drafts ORDER BY id LIMIT 500');
    return rows.rows.map(mapDraft);
  } finally { client.release(); }
}

export async function findDraft(id: string): Promise<JobDraft | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM drafts WHERE id=$1 LIMIT 1', [id]);
    return row.rows[0] ? mapDraft(row.rows[0]) : null;
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Password Reset Token CRUD
// ---------------------------------------------------------------------------

export async function savePasswordResetToken(t: PasswordResetToken): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO password_reset_tokens (id, applicant_id, email, token, expires_at, used_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         applicant_id=EXCLUDED.applicant_id, email=EXCLUDED.email, token=EXCLUDED.token,
         expires_at=EXCLUDED.expires_at, used_at=EXCLUDED.used_at`,
      [t.id, t.applicantId, t.email, t.token, t.expiresAt, t.usedAt, t.createdAt]
    );
  } finally { client.release(); }
}

export async function findPasswordResetToken(id: string): Promise<PasswordResetToken | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM password_reset_tokens WHERE id=$1 LIMIT 1', [id]);
    return row.rows[0] ? mapPasswordResetToken(row.rows[0]) : null;
  } finally { client.release(); }
}

export async function findPasswordResetTokenByToken(token: string): Promise<PasswordResetToken | null> {
  if (!pool) throw new Error('Database not initialized');
  const client = await pool.connect();
  try {
    const row = await client.query('SELECT * FROM password_reset_tokens WHERE token=$1 LIMIT 1', [token]);
    return row.rows[0] ? mapPasswordResetToken(row.rows[0]) : null;
  } finally { client.release(); }
}
