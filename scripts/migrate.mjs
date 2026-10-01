/**
 * Migration script: converts data/store.json to PostgreSQL database.
 * Idempotent — safe to run multiple times (ON CONFLICT upserts).
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs
 */
import fs from 'fs';
import { readFileSync, existsSync } from 'fs';
import pg from 'pg';

const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

// Inline schema to avoid circular imports in .mjs
async function initializeSchema(pool) {
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
  } finally {
    client.release();
  }
}

async function upsert(pool, table, id, sql, params) {
  await pool.query(sql, params);
}

async function migrate() {
  console.log('🔄 Starting migration: JSON store → PostgreSQL');

  const storeFile = 'data/store.json';
  if (!existsSync(storeFile)) {
    console.log('⚠️  No data/store.json found. Skipping data migration.');
    return;
  }

  const data = JSON.parse(readFileSync(storeFile, 'utf-8'));
  const pool = new Pool({ connectionString: DB_URL, max: 5 });

  try {
    // Verify connection
    await pool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL');

    // Initialize schema
    await initializeSchema(pool);
    console.log('✅ Schema initialized');

    // Record migration
    await pool.query(
      `INSERT INTO _migrations (name, applied_at) VALUES ($1, NOW()) ON CONFLICT (name) DO NOTHING`,
      ['migrate-from-json-store']
    );

    // Migrate companies
    const companyCount = (data.companies || []).length;
    for (const c of data.companies || []) {
      await pool.query(
        `INSERT INTO companies (id, company_name, description, location, company_size, industry, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (id) DO UPDATE SET company_name=EXCLUDED.company_name, description=EXCLUDED.description,
           location=EXCLUDED.location, company_size=EXCLUDED.company_size, industry=EXCLUDED.industry, updated_at=NOW()`,
        [c.id, c.companyName, c.description, c.location, c.companySize, c.industry, c.createdAt]
      );
    }
    console.log(`✅ Migrated ${companyCount} companies`);

    // Migrate jobs
    const jobCount = (data.jobs || []).length;
    for (const j of data.jobs || []) {
      await pool.query(
        `INSERT INTO jobs (id, company_id, job_title, position_description, requirements, position_location,
                           pay_range, responsibilities, qualifications, required_skills, required_experience,
                           reports_to, is_active, total_openings, current_applications, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
         ON CONFLICT (id) DO UPDATE SET job_title=EXCLUDED.job_title, requirements=EXCLUDED.requirements,
           pay_range=EXCLUDED.pay_range, updated_at=NOW()`,
        [j.id, j.companyId, j.jobTitle, j.positionDescription, j.requirements, j.positionLocation,
         JSON.stringify(j.payRange), j.responsibilities, j.qualifications, j.requiredSkills,
         j.requiredExperience, j.reportsTo, j.isActive, j.totalOpenings, j.currentApplications, j.createdAt]
      );
    }
    console.log(`✅ Migrated ${jobCount} jobs`);

    // Migrate applicants
    const applicantCount = (data.applicants || []).length;
    for (const a of data.applicants || []) {
      await pool.query(
        `INSERT INTO applicants (id, first_name, last_name, email, password_hash, phone, preferred_contact_method,
                                address, education_history, employment_history, right_to_work, requires_sponsorship,
                                expected_pay, notification_to_manager, hire_records, oauth_provider, oauth_provider_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
         ON CONFLICT (id) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
           email=EXCLUDED.email, password_hash=EXCLUDED.password_hash, updated_at=NOW()`,
        [a.id, a.firstName, a.lastName, a.email, a.passwordHash, a.phone, a.preferredContactMethod,
         JSON.stringify(a.address), JSON.stringify(a.educationHistory), JSON.stringify(a.employmentHistory),
         a.rightToWork, a.requiresSponsorship, a.expectedPay, a.notificationToManager,
         a.hireRecords, a.oauthProvider, a.oauthProviderId, a.createdAt]
      );
    }
    console.log(`✅ Migrated ${applicantCount} applicants`);

    // Migrate applications
    const applicationCount = (data.applications || []).length;
    for (const a of data.applications || []) {
      await pool.query(
        `INSERT INTO applications (id, applicant_id, job_posting_id, status, match_score, keyword_matches,
                                   education_match_score, experience_match_score, applied_at, updated_at, email_confirmed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10)
         ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, match_score=EXCLUDED.match_score, updated_at=NOW()`,
        [a.id, a.applicantId, a.jobPostingId, a.status, a.matchScore, JSON.stringify(a.keywordMatches),
         a.educationMatchScore, a.experienceMatchScore, a.appliedAt, a.emailConfirmed]
      );
    }
    console.log(`✅ Migrated ${applicationCount} applications`);

    // Migrate users
    const userCount = (data.users || []).length;
    for (const u of data.users || []) {
      await pool.query(
        `INSERT INTO users (id, username, password_hash, role, email, company_id, created_at, oauth_provider, oauth_provider_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, email=EXCLUDED.email, updated_at=NOW()`,
        [u.id, u.username, u.passwordHash, u.role, u.email, u.companyId, u.createdAt, u.oauthProvider, null]
      );
    }
    console.log(`✅ Migrated ${userCount} users`);

    // Migrate hires
    const hireCount = (data.hires || []).length;
    for (const h of data.hires || []) {
      await pool.query(
        `INSERT INTO hires (id, applicant_id, company_id, job_posting_id, hire_date, position_title, status,
                            notified_employer, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`,
        [h.id, h.applicantId, h.companyId, h.jobPostingId, h.hireDate, h.positionTitle, h.status,
         h.notifiedEmployer, h.createdAt]
      );
    }
    console.log(`✅ Migrated ${hireCount} hire records`);

    // Migrate drafts
    const draftCount = (data.drafts || []).length;
    for (const d of data.drafts || []) {
      await pool.query(
        `INSERT INTO drafts (id, company_id, user_id, status, input, output, variants_generated, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, output=EXCLUDED.output, updated_at=NOW()`,
        [d.id, d.companyId, d.userId, d.status, JSON.stringify(d.input),
         d.output ? JSON.stringify(d.output) : null, d.variantsGenerated, d.createdAt]
      );
    }
    console.log(`✅ Migrated ${draftCount} drafts`);

    // Migrate observability (skip if large)
    const obsData = data.observability || [];
    const obsCount = obsData.length;
    if (obsCount > 1000) {
      console.log(`⚠️  Skipping observability migration (${obsCount} entries — migrate manually if needed)`);
    } else {
      for (const o of obsData) {
        await pool.query(
          `INSERT INTO observability (id, timestamp, action, entity_type, entity_id, user_id, details, outcome)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET timestamp=EXCLUDED.timestamp`,
          [o.id, o.timestamp, o.action, o.entityType, o.entityId, o.userId, JSON.stringify(o.details), o.outcome]
        );
      }
      console.log(`✅ Migrated ${obsCount} observability entries`);
    }

    console.log('\n🎉 Migration complete!');
    console.log(`   Companies: ${companyCount}, Jobs: ${jobCount}, Applicants: ${applicantCount}`);
    console.log(`   Applications: ${applicationCount}, Users: ${userCount}, Hires: ${hireCount}, Drafts: ${draftCount}`);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
