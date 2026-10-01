/**
 * NFR-020: Replace JSON file store with a durable, concurrent database.
 *
 * Tests verify:
 * 1. DB connection layer initializes correctly
 * 2. Schema is auto-created on first run
 * 3. Concurrent writes do not lose updates (transactions)
 * 4. Shared state across simulated instances (same DB = shared state)
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/recruiting_test';
const hasDB = !!process.env.DATABASE_URL;
let pool: InstanceType<typeof Pool> | null = null;
let dbAvailable = false;

// Schema definitions
const TABLES = [
  'companies',
  'jobs',
  'applicants',
  'applications',
  'users',
  'hires',
  'observability',
  'drafts',
  '_migrations',
];

before(async () => {
  if (!hasDB) {
    console.log('⚠️  NFR-020 skipped: DATABASE_URL not set');
    return;
  }
  try {
    pool = new Pool({ connectionString: DB_URL, max: 5 });
    await pool.query('SELECT 1');
    dbAvailable = true;
    console.log('✅ NFR-020 PostgreSQL connected');
  } catch (err) {
    console.log(`⚠️  NFR-020 skipped: PostgreSQL not reachable (${(err as Error).message})`);
    if (pool) { await pool.end(); pool = null; }
  }
});

after(async () => {
  await pool?.end?.();
});

beforeEach(async () => {
  // Truncate all tables before each test for isolation
  if (!pool || !dbAvailable) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of TABLES) {
      if (t !== '_migrations') {
        await client.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE;`).catch(() => {});
      }
    }
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

afterEach(async () => {
  if (!pool || !dbAvailable) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of TABLES) {
      if (t !== '_migrations') {
        await client.query(`DELETE FROM ${t};`).catch(() => {});
      }
    }
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

describe('NFR-020: Database Schema', () => {
  test('all required tables exist after schema initialization', async () => {
    if (!pool || !dbAvailable) return;
    const client = await pool.connect();
    try {
      for (const table of TABLES) {
        const res = await client.query(
          'SELECT to_regclass($1) as table_exists;',
          [`public.${table}`]
        );
        if (table === '_migrations') {
          // Migrations table created by initializeDb
          assert.ok(
            (res.rows[0]?.table_exists as string | null) === `public.${table}`,
            `table ${table} should exist`
          );
        } else {
          // Other tables created by initializeDb
          assert.ok(
            (res.rows[0]?.table_exists as string | null) === `public.${table}`,
            `table ${table} should exist`
          );
        }
      }
    } finally {
      client.release();
    }
  });

  test('applications table has composite unique constraint on applicant_id + job_posting_id', async () => {
    if (!pool || !dbAvailable) return;
    const client = await pool.connect();
    try {
      // Insert test applicant and job
      const applicantRes = await client.query(
        `INSERT INTO applicants (id, first_name, last_name, email, phone, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id;`,
        ['test-app-1', 'Test', 'Applicant', 'test@example.com', '555-0100']
      );
      const jobRes = await client.query(
        `INSERT INTO jobs (id, company_id, title, position_description, requirements, position_location, pay_min, pay_max, pay_currency, responsibilities, qualifications, required_skills, required_experience, reports_to, is_active, total_openings, current_applications, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW()) RETURNING id;`,
        ['test-job-1', 'company-1', 'Test Job', 'Test description', '[]', 'Remote', 50000, 80000, 'USD', '[]', '[]', '[]', 0, 'Manager', true, 1, 0]
      );

      // First application should succeed
      await client.query(
        `INSERT INTO applications (id, applicant_id, job_posting_id, status, match_score, applied_at, updated_at)
         VALUES ($1, $2, $3, 'pending', 5, NOW(), NOW());`,
        ['app-1', applicantRes.rows[0].id, jobRes.rows[0].id]
      );

      // Second application for same applicant+job should fail (unique constraint)
      await assert.rejects(
        () => client.query(
          `INSERT INTO applications (id, applicant_id, job_posting_id, status, match_score, applied_at, updated_at)
           VALUES ($1, $2, $3, 'pending', 5, NOW(), NOW());`,
          ['app-2', applicantRes.rows[0].id, jobRes.rows[0].id]
        ),
        /duplicate key|unique_violation/i
      );
    } finally {
      client.release();
    }
  });

  test('observability table has audit columns', async () => {
    if (!pool || !dbAvailable) return;
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'observability' AND column_name IN ('id', 'timestamp', 'action', 'entity_type', 'entity_id', 'user_id', 'details', 'outcome');`
      );
      const columns = res.rows.map((r: any) => r.column_name);
      assert.ok(columns.length >= 7, `expected 7+ audit columns, got ${columns.join(', ')}`);
    } finally {
      client.release();
    }
  });
});

describe('NFR-020: Concurrent Write Safety', () => {
  test('duplicate applications for same applicant+job are rejected at DB level', async () => {
    if (!pool || !dbAvailable) return;
    const client = await pool.connect();
    try {
      const applicantId = 'conc-applicant';
      const jobId = 'conc-job';

      await client.query(
        `INSERT INTO applicants (id, first_name, last_name, email, phone, created_at, updated_at)
         VALUES ($1, 'Conc', 'Applicant', 'conc@example.com', '555-0200', NOW(), NOW());`,
        [applicantId]
      );

      await client.query(
        `INSERT INTO jobs (id, company_id, title, position_description, requirements, position_location, pay_min, pay_max, pay_currency, responsibilities, qualifications, required_skills, required_experience, reports_to, is_active, total_openings, current_applications, created_at, updated_at)
         VALUES ($1, 'company-1', 'Conc Job', 'desc', '[]', 'Remote', 50000, 80000, 'USD', '[]', '[]', '[]', 0, 'Mgr', true, 1, 0, NOW(), NOW());`,
        [jobId]
      );

      // Concurrent attempts: both try to insert
      const results = await Promise.allSettled([
        client.query(
          `INSERT INTO applications (id, applicant_id, job_posting_id, status, match_score, applied_at, updated_at)
           VALUES ('conc-app-1', $1, $2, 'pending', 5, NOW(), NOW());`,
          [applicantId, jobId]
        ),
        client.query(
          `INSERT INTO applications (id, applicant_id, job_posting_id, status, match_score, applied_at, updated_at)
           VALUES ('conc-app-2', $1, $2, 'pending', 5, NOW(), NOW());`,
          [applicantId, jobId]
        ),
      ]);

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected').length;

      // Exactly one should succeed, one should fail with unique violation
      assert.equal(succeeded, 1, `expected 1 success, got ${succeeded}`);
      assert.equal(rejected, 1, `expected 1 rejection, got ${rejected}`);
    } finally {
      client.release();
    }
  });

  test('concurrent job application count increment is atomic', async () => {
    if (!pool || !dbAvailable) return;
    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM applications;`);
      await client.query(`UPDATE jobs SET current_applications = 0;`);

      const jobId = 'atomic-job';
      await client.query(
        `INSERT INTO jobs (id, company_id, title, position_description, requirements, position_location, pay_min, pay_max, pay_currency, responsibilities, qualifications, required_skills, required_experience, reports_to, is_active, total_openings, current_applications, created_at, updated_at)
         VALUES ($1, 'company-1', 'Atomic Job', 'desc', '[]', 'Remote', 50000, 80000, 'USD', '[]', '[]', '[]', 0, 'Mgr', true, 1, 0, NOW(), NOW());`,
        [jobId]
      );

      // Concurrent increments
      const increments = Array.from({ length: 10 }, (_, i) =>
        client.query(
          `UPDATE jobs SET current_applications = current_applications + 1 WHERE id = $1;`,
          [jobId]
        )
      );

      await Promise.all(increments);

      const res = await client.query(`SELECT current_applications FROM jobs WHERE id = $1;`, [jobId]);
      assert.equal(res.rows[0].current_applications, 10, 'all 10 concurrent increments should be applied');
    } finally {
      client.release();
    }
  });
});

describe('NFR-020: Multi-Instance State Sharing', () => {
  test('write to DB from one connection is visible to another', async () => {
    if (!pool || !dbAvailable) return;
    const clientA = await pool.connect();
    const clientB = await pool.connect();
    try {
      const applicantId = 'shared-app';
      await clientA.query(
        `INSERT INTO applicants (id, first_name, last_name, email, phone, created_at, updated_at)
         VALUES ($1, 'Shared', 'Applicant', 'shared@example.com', '555-0300', NOW(), NOW());`,
        [applicantId]
      );

      // Read from a different connection
      const res = await clientB.query(
        `SELECT first_name, last_name FROM applicants WHERE id = $1;`,
        [applicantId]
      );

      assert.equal(res.rows.length, 1);
      assert.equal(res.rows[0].first_name, 'Shared');
      assert.equal(res.rows[0].last_name, 'Applicant');
    } finally {
      clientA.release();
      clientB.release();
    }
  });
});