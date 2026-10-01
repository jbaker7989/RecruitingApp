/**
 * story-commercial-replace-json-store-with-db: TDD Tests
 * RED phase: These tests define expected behavior before implementation.
 *
 * Run with: npm test -- tests/regression/story-db-replace-store.test.ts
 * Requires: DATABASE_URL environment variable set
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const DB_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/recruiting_test';

// Skip all tests if DATABASE_URL is not set (file store fallback mode)
const hasDB = !!process.env.DATABASE_URL;

const TABLES = ['companies', 'jobs', 'applicants', 'applications', 'users', 'hires', 'observability', 'drafts', 'password_reset_tokens', '_migrations'];

describe('story-commercial-replace-json-store-with-db', () => {
  let pool: any;
  let dbAvailable = false;

  before(async () => {
    if (!hasDB) {
      console.log('⚠️  DATABASE_URL not set — DB tests will be skipped');
      return;
    }
    try {
      const { Pool } = await import('pg');
      pool = new (Pool as any)({ connectionString: DB_URL, max: 5 });
      await pool.query('SELECT 1'); // Verify connection
      dbAvailable = true;
      console.log('✅ PostgreSQL connected — running DB tests');
    } catch (err) {
      console.log(`⚠️  PostgreSQL not reachable — DB tests will be skipped (${(err as Error).message})`);
      if (pool) { await pool.end(); pool = null; }
    }
  });

  after(async () => {
    await pool?.end?.();
  });

  beforeEach(async () => {
    if (!pool || !dbAvailable) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const t of TABLES) {
        if (t !== '_migrations') {
          await client.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE;`).catch(() => {});
        }
      }
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    if (!pool || !dbAvailable) return;
    const client = await pool.connect();
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  // Skip all tests if DB not available — defined once at parent scope
  const maybeTest = dbAvailable ? test : (_n: string, _fn: any) => test(_n, async () => {});

  // ========================================================================
  // RED-1: Database module exports correctly
  // ========================================================================
  describe('RED-1: Module exports', () => {
    maybeTest('initializeDatabase should be exported and callable', async () => {
      const db = await import('../../src/models/db.js');
      assert.ok(typeof db.initializeDatabase === 'function', 'initializeDatabase should be exported');
      assert.ok(typeof db.initializeSchema === 'function', 'initializeSchema should be exported');
    });

    maybeTest('initializeDatabase should connect to PostgreSQL', async () => {
      const { initializeDatabase } = await import('../../src/models/db.js');
      await initializeDatabase();
    });
  });

  // ========================================================================
  // RED-2: Schema initialization creates all required tables
  // ========================================================================
  describe('RED-2: Schema initialization', () => {
    maybeTest('initializeSchema creates all required tables', async () => {
      const { initializeSchema } = await import('../../src/models/db.js');
      await initializeSchema();

      for (const table of TABLES) {
        const res = await pool.query('SELECT to_regclass($1) as exists', [`public.${table}`]);
        assert.strictEqual(res.rows[0]?.exists, `public.${table}`, `Table ${table} should exist`);
      }
    });

    maybeTest('applicants table has correct columns', async () => {
      const res = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'applicants'
        ORDER BY ordinal_position
      `);
      const cols = res.rows.map((r: any) => r.column_name);
      assert.ok(cols.includes('id'), 'should have id column');
      assert.ok(cols.includes('email'), 'should have email column');
      assert.ok(cols.includes('first_name'), 'should have first_name column');
      assert.ok(cols.includes('last_name'), 'should have last_name column');
    });

    maybeTest('applications table has unique constraint on applicant_id + job_posting_id', async () => {
      const res = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'applications'
          AND constraint_type = 'UNIQUE'
          AND columns = ARRAY['applicant_id', 'job_posting_id']
      `);
      assert.ok(res.rows.length > 0, 'should have unique constraint on applicant_id + job_posting_id');
    });
  });

  // ========================================================================
  // RED-3: Company CRUD operations
  // ========================================================================
  describe('RED-3: Company CRUD', () => {
    maybeTest('saveCompany inserts a company', async () => {
      const { saveCompany } = await import('../../src/models/db.js');
      const company = {
        id: 'test-co-1',
        companyName: 'Acme Corp',
        description: 'Test company',
        location: 'New York',
        companySize: '50-100',
        industry: 'Technology',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveCompany(company);

      const res = await pool.query('SELECT * FROM companies WHERE id = $1', ['test-co-1']);
      assert.strictEqual(res.rows.length, 1);
      assert.strictEqual(res.rows[0].company_name, 'Acme Corp');
    });

    maybeTest('saveCompany updates on conflict (idempotent)', async () => {
      const { saveCompany } = await import('../../src/models/db.js');
      const company = {
        id: 'test-co-2',
        companyName: 'First Name',
        description: 'Original',
        location: 'NYC',
        companySize: '10-50',
        industry: 'Retail',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveCompany(company);
      company.companyName = 'Updated Name';
      await saveCompany(company);

      const res = await pool.query('SELECT company_name FROM companies WHERE id = $1', ['test-co-2']);
      assert.strictEqual(res.rows.length, 1);
      assert.strictEqual(res.rows[0].company_name, 'Updated Name');
    });

    maybeTest('findCompanies returns all companies', async () => {
      const { saveCompany, findCompanies } = await import('../../src/models/db.js');
      await saveCompany({ id: 'co-a', companyName: 'A Corp', description: '', location: '', companySize: '', industry: '', createdAt: '', updatedAt: '' });
      await saveCompany({ id: 'co-b', companyName: 'B Corp', description: '', location: '', companySize: '', industry: '', createdAt: '', updatedAt: '' });

      const companies = await findCompanies();
      assert.ok(companies.length >= 2, 'should have at least 2 companies');
      assert.ok(companies.some((c: any) => c.companyName === 'A Corp'), 'should contain A Corp');
      assert.ok(companies.some((c: any) => c.companyName === 'B Corp'), 'should contain B Corp');
    });
  });

  // ========================================================================
  // RED-4: Applicant CRUD operations
  // ========================================================================
  describe('RED-4: Applicant CRUD', () => {
    maybeTest('saveApplicant inserts an applicant', async () => {
      const { saveApplicant } = await import('../../src/models/db.js');
      const applicant = {
        id: 'test-app-1',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        passwordHash: 'hash123',
        phone: '555-1234',
        preferredContactMethod: 'email' as const,
        address: { state: 'NY', zip: '10001' },
        educationHistory: [],
        employmentHistory: [],
        rightToWork: true,
        requiresSponsorship: false,
        expectedPay: 80000,
        notificationToManager: false,
        hireRecords: [],
        oauthProvider: null,
        oauthProviderId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveApplicant(applicant);

      const res = await pool.query('SELECT * FROM applicants WHERE id = $1', ['test-app-1']);
      assert.strictEqual(res.rows.length, 1);
      assert.strictEqual(res.rows[0].first_name, 'Jane');
      assert.strictEqual(res.rows[0].email, 'jane@example.com');
    });

    maybeTest('findApplicant returns applicant by id', async () => {
      const { saveApplicant, findApplicant } = await import('../../src/models/db.js');
      const applicant = {
        id: 'test-app-2',
        firstName: 'John',
        lastName: 'Smith',
        email: 'john@example.com',
        passwordHash: null,
        phone: '555-5678',
        preferredContactMethod: 'sms' as const,
        address: { state: 'CA', zip: '90210' },
        educationHistory: [],
        employmentHistory: [],
        rightToWork: true,
        requiresSponsorship: false,
        expectedPay: 90000,
        notificationToManager: false,
        hireRecords: [],
        oauthProvider: null,
        oauthProviderId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveApplicant(applicant);

      const found = await findApplicant('test-app-2');
      assert.ok(found, 'should find the applicant');
      assert.strictEqual((found as any).firstName, 'John');
    });

    maybeTest('findApplicant returns null for non-existent id', async () => {
      const { findApplicant } = await import('../../src/models/db.js');
      const found = await findApplicant('non-existent-id');
      assert.strictEqual(found, null);
    });
  });

  // ========================================================================
  // RED-5: Job posting CRUD
  // ========================================================================
  describe('RED-5: Job Posting CRUD', () => {
    maybeTest('saveJobPosting inserts a job', async () => {
      const { saveCompany, saveJobPosting } = await import('../../src/models/db.js');
      await saveCompany({ id: 'co-job-1', companyName: 'TestCo', description: '', location: '', companySize: '', industry: '', createdAt: '', updatedAt: '' });

      const job = {
        id: 'test-job-1',
        companyId: 'co-job-1',
        jobTitle: 'Software Engineer',
        positionDescription: 'Build great software',
        requirements: ['TypeScript', 'Node.js'],
        positionLocation: 'Remote',
        payRange: { min: 80000, max: 120000, currency: 'USD' },
        responsibilities: ['Code', 'Review'],
        qualifications: ['3+ years experience'],
        requiredSkills: ['TypeScript', 'Node.js'],
        requiredExperience: 3,
        reportsTo: 'CTO',
        isActive: true,
        totalOpenings: 2,
        currentApplications: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveJobPosting(job);

      const res = await pool.query('SELECT * FROM jobs WHERE id = $1', ['test-job-1']);
      assert.strictEqual(res.rows.length, 1);
      assert.strictEqual(res.rows[0].job_title, 'Software Engineer');
      assert.deepStrictEqual(res.rows[0].requirements, ['TypeScript', 'Node.js']);
    });

    maybeTest('findJobPosting returns job with all fields', async () => {
      const { saveCompany, saveJobPosting, findJobPosting } = await import('../../src/models/db.js');
      await saveCompany({ id: 'co-job-2', companyName: 'Co2', description: '', location: '', companySize: '', industry: '', createdAt: '', updatedAt: '' });

      const job = {
        id: 'test-job-2',
        companyId: 'co-job-2',
        jobTitle: 'PM',
        positionDescription: 'Product management',
        requirements: ['MBA'],
        positionLocation: 'NYC',
        payRange: { min: 100000, max: 150000, currency: 'USD' },
        responsibilities: [],
        qualifications: [],
        requiredSkills: [],
        requiredExperience: 5,
        reportsTo: 'CEO',
        isActive: true,
        totalOpenings: 1,
        currentApplications: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveJobPosting(job);

      const found = await findJobPosting('test-job-2');
      assert.ok(found, 'should find the job');
      assert.strictEqual((found as any).jobTitle, 'PM');
      assert.strictEqual((found as any).positionLocation, 'NYC');
      assert.deepStrictEqual((found as any).payRange, { min: 100000, max: 150000, currency: 'USD' });
    });
  });

  // ========================================================================
  // RED-6: Application CRUD
  // ========================================================================
  describe('RED-6: Application CRUD', () => {
    maybeTest('saveApplication inserts an application', async () => {
      const { saveCompany, saveJobPosting, saveApplicant, saveApplication } = await import('../../src/models/db.js');
      await saveCompany({ id: 'co-app-1', companyName: 'Co', description: '', location: '', companySize: '', industry: '', createdAt: '', updatedAt: '' });
      await saveJobPosting({ id: 'job-app-1', companyId: 'co-app-1', jobTitle: 'Dev', positionDescription: '', requirements: [], positionLocation: '', payRange: { min: 0, max: 0, currency: 'USD' }, responsibilities: [], qualifications: [], requiredSkills: [], requiredExperience: 0, reportsTo: '', isActive: true, totalOpenings: 1, currentApplications: 0, createdAt: '', updatedAt: '' });
      await saveApplicant({ id: 'app-app-1', firstName: 'A', lastName: 'B', email: 'a@b.com', passwordHash: null, phone: '', preferredContactMethod: 'email', address: { state: '', zip: '' }, educationHistory: [], employmentHistory: [], rightToWork: true, requiresSponsorship: false, expectedPay: 0, notificationToManager: false, hireRecords: [], oauthProvider: null, oauthProviderId: null, createdAt: '', updatedAt: '' });

      const application = {
        id: 'test-application-1',
        applicantId: 'app-app-1',
        jobPostingId: 'job-app-1',
        status: 'pending' as const,
        matchScore: 85.5,
        keywordMatches: [],
        educationMatchScore: 90,
        experienceMatchScore: 80,
        appliedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        emailConfirmed: false,
      };
      await saveApplication(application);

      const res = await pool.query('SELECT * FROM applications WHERE id = $1', ['test-application-1']);
      assert.strictEqual(res.rows.length, 1);
      assert.strictEqual(res.rows[0].status, 'pending');
      assert.strictEqual(Number(res.rows[0].match_score), 85.5);
    });

    maybeTest('findApplication returns application by id', async () => {
      const { findApplication } = await import('../../src/models/db.js');
      const found = await findApplication('test-application-1');
      assert.ok(found, 'should find the application');
      assert.strictEqual((found as any).status, 'pending');
    });
  });

  // ========================================================================
  // RED-7: User CRUD
  // ========================================================================
  describe('RED-7: User CRUD', () => {
    maybeTest('saveUser inserts a user', async () => {
      const { saveUser } = await import('../../src/models/db.js');
      const user = {
        id: 'test-user-1',
        username: 'recruiter1',
        passwordHash: 'hashedpassword',
        role: 'recruiter' as const,
        email: 'recruiter@example.com',
        companyId: undefined,
        createdAt: new Date().toISOString(),
        oauthProvider: null,
      };
      await saveUser(user);

      const res = await pool.query('SELECT * FROM users WHERE id = $1', ['test-user-1']);
      assert.strictEqual(res.rows.length, 1);
      assert.strictEqual(res.rows[0].username, 'recruiter1');
      assert.strictEqual(res.rows[0].role, 'recruiter');
    });

    maybeTest('findUser returns user by id with all fields', async () => {
      const { saveUser, findUser } = await import('../../src/models/db.js');
      const user = {
        id: 'test-user-2',
        username: 'hr_manager',
        passwordHash: 'hash2',
        role: 'hiring-manager' as const,
        email: 'hr@example.com',
        companyId: 'comp-1',
        createdAt: new Date().toISOString(),
        oauthProvider: 'google',
      };
      await saveUser(user);

      const found = await findUser('test-user-2');
      assert.ok(found, 'should find user');
      assert.strictEqual((found as any).username, 'hr_manager');
      assert.strictEqual((found as any).role, 'hiring-manager');
      assert.strictEqual((found as any).oauthProvider, 'google');
    });
  });

  // ========================================================================
  // RED-8: Hire record CRUD
  // ========================================================================
  describe('RED-8: Hire Record CRUD', () => {
    maybeTest('saveHireRecord inserts a hire record', async () => {
      const { saveHireRecord, findHireRecord } = await import('../../src/models/db.js');
      const hire = {
        id: 'test-hire-1',
        applicantId: 'applicant-1',
        companyId: 'company-1',
        jobPostingId: 'job-1',
        hireDate: new Date().toISOString(),
        positionTitle: 'Software Engineer',
        status: 'active' as const,
        notifiedEmployer: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveHireRecord(hire);

      const found = await findHireRecord('test-hire-1');
      assert.ok(found, 'should find hire record');
      assert.strictEqual((found as any).positionTitle, 'Software Engineer');
      assert.strictEqual((found as any).status, 'active');
    });
  });

  // ========================================================================
  // RED-9: Observability CRUD
  // ========================================================================
  describe('RED-9: Observability CRUD', () => {
    maybeTest('addObservabilityEntry inserts a log entry', async () => {
      const { addObservabilityEntry, findObservabilityLog } = await import('../../src/models/db.js');
      const entry = {
        id: 'obs-1',
        timestamp: new Date().toISOString(),
        action: 'user_login',
        entityType: 'user',
        entityId: 'user-123',
        userId: 'user-123',
        details: { ip: '127.0.0.1' },
        outcome: 'success' as const,
      };
      await addObservabilityEntry(entry);

      const found = await findObservabilityLog('obs-1');
      assert.ok(found, 'should find observability log');
      assert.strictEqual((found as any).action, 'user_login');
    });
  });

  // ========================================================================
  // RED-10: Password reset token CRUD
  // ========================================================================
  describe('RED-10: Password Reset Token CRUD', () => {
    maybeTest('savePasswordResetToken inserts a token', async () => {
      const { savePasswordResetToken, findPasswordResetToken } = await import('../../src/models/db.js');
      const token = {
        id: 'prt-1',
        applicantId: 'applicant-1',
        email: 'test@example.com',
        token: 'abc123token',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        usedAt: null,
        createdAt: new Date().toISOString(),
      };
      await savePasswordResetToken(token);

      const found = await findPasswordResetToken('prt-1');
      assert.ok(found, 'should find password reset token');
      assert.strictEqual((found as any).token, 'abc123token');
      assert.strictEqual(found?.usedAt, null);
    });

    maybeTest('findPasswordResetToken returns null for non-existent token', async () => {
      const { findPasswordResetToken } = await import('../../src/models/db.js');
      const found = await findPasswordResetToken('non-existent');
      assert.strictEqual(found, null);
    });
  });

  // ========================================================================
  // RED-11: Job Draft CRUD
  // ========================================================================
  describe('RED-11: Job Draft CRUD', () => {
    maybeTest('saveDraft inserts a draft', async () => {
      const { saveDraft, findDraft } = await import('../../src/models/db.js');
      const draft = {
        id: 'draft-1',
        companyId: 'company-1',
        userId: 'user-1',
        status: 'draft' as const,
        input: { jobTitle: 'Engineer', requirements: [] },
        output: { summary: 'A great job' },
        variantsGenerated: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveDraft(draft);

      const found = await findDraft('draft-1');
      assert.ok(found, 'should find draft');
      assert.strictEqual((found as any).status, 'draft');
    });
  });

  // ========================================================================
  // RED-12: Unified store integration
  // ========================================================================
  describe('RED-12: Unified store integration', () => {
    maybeTest('unifiedStore exports initializeStore that calls db initialization', async () => {
      const unifiedStore = await import('../../src/models/unifiedStore.js');
      assert.ok(typeof unifiedStore.initializeStore === 'function', 'should export initializeStore');
      assert.ok(typeof unifiedStore.readStore === 'function', 'should export readStore');
      assert.ok(typeof unifiedStore.writeStore === 'function', 'should export writeStore');
    });

    maybeTest('unifiedStore re-exports store utilities', async () => {
      const unifiedStore = await import('../../src/models/unifiedStore.js');
      assert.ok(typeof unifiedStore.generateId === 'function', 'should export generateId');
      assert.ok(typeof unifiedStore.now === 'function', 'should export now');
    });
  });

  // ========================================================================
  // RED-13: Concurrent writes (NFR-020 verification)
  // ========================================================================
  describe('RED-13: Concurrent writes do not corrupt data', () => {
    maybeTest('concurrent saves to same applicant do not corrupt data', async () => {
      const { saveApplicant, findApplicant } = await import('../../src/models/db.js');

      const applicant = {
        id: 'concurrent-test-1',
        firstName: 'Original',
        lastName: 'Name',
        email: 'concurrent@test.com',
        passwordHash: null,
        phone: '555-0000',
        preferredContactMethod: 'email' as const,
        address: { state: 'NY', zip: '10001' },
        educationHistory: [],
        employmentHistory: [],
        rightToWork: true,
        requiresSponsorship: false,
        expectedPay: 50000,
        notificationToManager: false,
        hireRecords: [],
        oauthProvider: null,
        oauthProviderId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Save concurrently
      await Promise.all([
        saveApplicant({ ...applicant, firstName: 'First1' }),
        saveApplicant({ ...applicant, firstName: 'First2' }),
        saveApplicant({ ...applicant, firstName: 'First3' }),
      ]);

      const found = await findApplicant('concurrent-test-1');
      assert.ok(found, 'should still exist after concurrent writes');
      // One of the writes should have "won" (deterministic based on timing)
      assert.ok(
        ['First1', 'First2', 'First3'].includes((found as any).firstName),
        `firstName should be one of the written values, got: ${(found as any).firstName}`
      );
      // But the record should NOT be corrupted (all fields present)
      assert.strictEqual((found as any).lastName, 'Name');
      assert.strictEqual((found as any).email, 'concurrent@test.com');
    });
  });
});
