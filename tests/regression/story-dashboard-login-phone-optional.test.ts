/**
 * Dashboard Login Phone Optional — Tests
 *
 * Story: story-dashboard-login-phone-optional.md
 *
 * Verifies:
 * - Login form does not include phone field
 * - Login POST succeeds with only email + password (no phone)
 * - Register form phone field is optional (no required attribute)
 * - Register POST succeeds with empty phone
 * - Register POST stores phone when provided
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

let dataDir: string;
let server: Server;
let baseUrl: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'dash-phone-opt-'));
  writeFileSync(join(dataDir, 'store.json'), JSON.stringify({
    companies: [],
    jobs: [],
    applications: [],
    users: [],
    applicants: [],
    observability: [],
    drafts: [],
    passwordResetTokens: [],
  }));
  process.env.DATA_DIR = dataDir;
  process.env.JWT_SECRET = 'test-jwt-secret-for-dashboard-testing-only';
  process.env.APPLICANT_JWT_SECRET = 'test-applicant-jwt-secret-for-dashboard-testing-only';

  const { app } = await import('../../src/index.js');
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://localhost:${(server.address() as any).port}`;
});

after(async () => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.JWT_SECRET;
  delete process.env.APPLICANT_JWT_SECRET;
});

async function post(path: string, body: object, cookieJar?: string[]) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (cookieJar && cookieJar.length > 0) {
    headers.Cookie = cookieJar.join('; ');
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body as Record<string, string>).toString(),
    redirect: 'manual',
  });
  const cookies = res.headers.get('set-cookie');
  return {
    status: res.status,
    body: await res.text(),
    cookies: cookies ? [cookies] : [],
    headers: res.headers,
  };
}

async function get(path: string, cookieJar?: string[]) {
  const headers: Record<string, string> = {};
  if (cookieJar && cookieJar.length > 0) {
    headers.Cookie = cookieJar.join('; ');
  }
  const res = await fetch(`${baseUrl}${path}`, {
    headers,
    redirect: 'manual',
  });
  return {
    status: res.status,
    body: await res.text(),
    cookies: res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [],
  };
}

function extractCookie(res: { cookies: string[] }): string | undefined {
  if (!res.cookies || res.cookies.length === 0) return undefined;
  const cookie = res.cookies[0];
  return cookie.split(';')[0].split('=')[1];
}

function hasPhoneField(html: string): boolean {
  // Check if the login form has a phone input field
  return /<input[^>]*name="phone"[^>]*>/i.test(html);
}

function hasRequiredAttribute(html: string, fieldName: string): boolean {
  // Check if a field has the required attribute
  const regex = new RegExp(`<input[^>]*name="${fieldName}"[^>]*\\brequired\\b`, 'i');
  return regex.test(html);
}

function hasRequiredAsterisk(html: string, labelText: string): boolean {
  // Check if a label contains a required indicator (red asterisk)
  const regex = new RegExp(`<label[^>]*for="${labelText}"[^>]*>[^<]*${labelText}[^<]*<span[^>]*class="required-indicator"[^>]*>\\*`, 'i');
  return regex.test(html);
}

describe('Dashboard Login - Phone Optional', () => {
  
  test('GET /dashboard/login - form does not contain phone field', async () => {
    const res = await get('/dashboard/login');
    assert.equal(res.status, 200);
    const html = res.body;
    assert.equal(hasPhoneField(html), false, 'Login form should not have phone field');
  });

  test('POST /dashboard/login - succeeds with only email and password (no phone)', async () => {
    // First register an applicant via API
    const regRes = await fetch(`${baseUrl}/api/applicants/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'login-test@test.com',
        password: 'password123',
        firstName: 'Login',
        lastName: 'Test',
        phone: '555-0001', // API requires phone
      }),
    });
    assert.equal(regRes.status, 201);

    // Now test dashboard login WITHOUT phone field
    const loginRes = await post('/dashboard/login', {
      email: 'login-test@test.com',
      password: 'password123',
    });
    assert.equal(loginRes.status, 302, `Expected 302 redirect, got ${loginRes.status}: ${loginRes.body}`);
    assert.ok(loginRes.headers.get('location')?.includes('/dashboard/applications'), 'Should redirect to applications');
    
    const cookie = extractCookie(loginRes);
    assert.ok(cookie, 'Should set auth cookie');
  });

  test('POST /dashboard/login - fails with invalid credentials', async () => {
    const loginRes = await post('/dashboard/login', {
      email: 'nonexistent@test.com',
      password: 'wrongpassword',
    });
    assert.equal(loginRes.status, 200, 'Invalid credentials should return 200 with error');
    assert.ok(loginRes.body.includes('error') || loginRes.body.includes('Error'), 'Should show error message');
  });
});

describe('Dashboard Register - Phone Optional', () => {

  test('GET /dashboard/register - form phone field does not have required attribute', async () => {
    const res = await get('/dashboard/register');
    assert.equal(res.status, 200);
    const html = res.body;
    // Phone field should exist but NOT have required attribute
    assert.ok(/<input[^>]*name="phone"[^>]*>/i.test(html), 'Register form should have phone field');
    assert.equal(hasRequiredAttribute(html, 'phone'), false, 'Phone field should not have required attribute');
  });

  test('GET /dashboard/register - required fields have required attribute', async () => {
    const res = await get('/dashboard/register');
    assert.equal(res.status, 200);
    const html = res.body;
    
    // These fields should be required
    assert.equal(hasRequiredAttribute(html, 'firstName'), true, 'firstName should be required');
    assert.equal(hasRequiredAttribute(html, 'lastName'), true, 'lastName should be required');
    assert.equal(hasRequiredAttribute(html, 'email'), true, 'email should be required');
    assert.equal(hasRequiredAttribute(html, 'password'), true, 'password should be required');
    assert.equal(hasRequiredAttribute(html, 'confirmPassword'), true, 'confirmPassword should be required');
  });

  test('POST /dashboard/register - succeeds with empty phone', async () => {
    const regRes = await post('/dashboard/register', {
      email: 'phone-empty@test.com',
      password: 'password123',
      confirmPassword: 'password123',
      firstName: 'Phone',
      lastName: 'Empty',
      phone: '', // Empty phone
    });
    assert.equal(regRes.status, 302, `Expected 302 redirect, got ${regRes.status}: ${regRes.body}`);
    assert.ok(regRes.headers.get('location')?.includes('/dashboard/applications'), 'Should redirect to applications');
    
    const cookie = extractCookie(regRes);
    assert.ok(cookie, 'Should set auth cookie');

    // Verify applicant was created with empty phone
    const { readStore } = await import('../../src/models/store.js');
    const store = await readStore();
    const applicant = store.applicants.find(a => a.email === 'phone-empty@test.com');
    assert.ok(applicant, 'Applicant should be created');
    assert.equal(applicant.phone, '', 'Phone should be empty string');
  });

  test('POST /dashboard/register - succeeds with phone provided', async () => {
    const regRes = await post('/dashboard/register', {
      email: 'phone-provided@test.com',
      password: 'password123',
      confirmPassword: 'password123',
      firstName: 'Phone',
      lastName: 'Provided',
      phone: '555-1234',
    });
    assert.equal(regRes.status, 302, `Expected 302 redirect, got ${regRes.status}: ${regRes.body}`);
    
    const cookie = extractCookie(regRes);
    assert.ok(cookie, 'Should set auth cookie');

    // Verify applicant was created with phone
    const { readStore } = await import('../../src/models/store.js');
    const store = await readStore();
    const applicant = store.applicants.find(a => a.email === 'phone-provided@test.com');
    assert.ok(applicant, 'Applicant should be created');
    assert.equal(applicant.phone, '555-1234', 'Phone should be stored');
  });

  test('POST /dashboard/register - fails validation when required fields missing', async () => {
    // Missing firstName
    const regRes = await post('/dashboard/register', {
      email: 'missing-field@test.com',
      password: 'password123',
      confirmPassword: 'password123',
      lastName: 'Test',
      phone: '',
    });
    assert.equal(regRes.status, 200, 'Missing required field should return 200 with error');
    assert.ok(regRes.body.includes('required') || regRes.body.includes('Required'), 'Should show required field error');
  });

  test('POST /dashboard/register - fails when passwords do not match', async () => {
    const regRes = await post('/dashboard/register', {
      email: 'mismatch@test.com',
      password: 'password123',
      confirmPassword: 'differentpassword',
      firstName: 'Mismatch',
      lastName: 'Test',
      phone: '',
    });
    assert.equal(regRes.status, 200);
    assert.ok(regRes.body.includes('match') || regRes.body.includes('Match'), 'Should show password mismatch error');
  });

  test('POST /dashboard/register - fails when email format invalid', async () => {
    const regRes = await post('/dashboard/register', {
      email: 'invalid-email',
      password: 'password123',
      confirmPassword: 'password123',
      firstName: 'Invalid',
      lastName: 'Email',
      phone: '',
    });
    assert.equal(regRes.status, 200);
    assert.ok(regRes.body.includes('Invalid email') || regRes.body.includes('invalid email'), 'Should show invalid email error');
  });

  test('POST /dashboard/register - fails when password too short', async () => {
    const regRes = await post('/dashboard/register', {
      email: 'short-pass@test.com',
      password: 'short',
      confirmPassword: 'short',
      firstName: 'Short',
      lastName: 'Pass',
      phone: '',
    });
    assert.equal(regRes.status, 200);
    assert.ok(regRes.body.includes('8 characters') || regRes.body.includes('at least 8'), 'Should show minimum password length error');
  });

  test('POST /dashboard/register - prevents duplicate email', async () => {
    // First registration
    await post('/dashboard/register', {
      email: 'duplicate@test.com',
      password: 'password123',
      confirmPassword: 'password123',
      firstName: 'Dup',
      lastName: 'One',
      phone: '',
    });

    // Second registration with same email
    const regRes = await post('/dashboard/register', {
      email: 'duplicate@test.com',
      password: 'password123',
      confirmPassword: 'password123',
      firstName: 'Dup',
      lastName: 'Two',
      phone: '',
    });
    assert.equal(regRes.status, 200);
    assert.ok(regRes.body.includes('already exists') || regRes.body.includes('already exist'), 'Should show duplicate email error');
  });
});