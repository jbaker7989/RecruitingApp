/**
 * NFR-080: Honor requested interview duration.
 *
 * The HTTP route destructured `durationMinutes` from the request body but
 * never passed it into the workflow. `createInitialState` always set
 * `durationMinutes: 60`, so a caller requesting 30 or 90 minutes still got
 * a 60-minute interview.
 *
 * These tests exercise the workflow directly (the same way the existing
 * observability-p2-store-workflow tests do) plus the route validation.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';

const TEST_DIR = `/tmp/nfr-080-interview-duration-${process.pid}`;
const MARKER = 'nfr-080-marker';

interface WorkflowModule {
  startInterviewScheduling(
    applicationId: string,
    candidateId: string,
    jobId: string,
    companyId: string,
    interviewerIds: string[],
    proposedTimes?: string[],
    entryPoint?: string,
    durationMinutes?: number,
  ): Promise<any>;
  requestReschedule(state: any): Promise<any>;
  createInitialState(
    applicationId: string,
    candidateId: string,
    jobId: string,
    companyId: string,
    interviewerIds: string[],
    durationMinutes?: number,
  ): any;
}

let workflow: WorkflowModule;

describe('NFR-080: interview duration is honored', () => {
  before(async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.DATA_DIR = TEST_DIR;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'nfr-080-test-secret-must-be-at-least-32-chars';
    process.env.APPLICANT_JWT_SECRET = 'nfr-080-applicant-secret-must-be-32-chars-min';

    const { initializeStore } = await import('../../src/models/store.js');
    await initializeStore();
    workflow = await import('../../src/agents/scheduling/agent.js') as WorkflowModule;
  });

  after(() => {
    delete process.env.DATA_DIR;
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('a requested duration of 30 minutes is preserved in the initial state', async () => {
    const state = workflow.createInitialState(MARKER, MARKER, MARKER, MARKER, [MARKER], 30);
    assert.equal(state.durationMinutes, 30);
  });

  it('a requested duration of 90 minutes is preserved in the initial state', async () => {
    const state = workflow.createInitialState(MARKER, MARKER, MARKER, MARKER, [MARKER], 90);
    assert.equal(state.durationMinutes, 90);
  });

  it('omitted duration defaults to 60 minutes', async () => {
    const state = workflow.createInitialState(MARKER, MARKER, MARKER, MARKER, [MARKER]);
    assert.equal(state.durationMinutes, 60);
  });

  it('a passed-through duration survives the full workflow execution', async () => {
    const result = await workflow.startInterviewScheduling(
      MARKER, MARKER, MARKER, MARKER, [MARKER],
      undefined, 'api', 45,
    );
    assert.equal(result.durationMinutes, 45,
      `expected 45 minutes; got ${result.durationMinutes} after currentState=${result.currentState}`);
  });

  it('rescheduling retains the selected duration', async () => {
    // Drive to a state from which reschedule is allowed. `confirmed` transitions
    // to `reschedule_requested` via requestReschedule; the `reschedule_requested`
    // node is a partial that does not return durationMinutes, so the merge
    // ({ ...state, ...partial }) must preserve it.
    const startState = workflow.createInitialState(MARKER, MARKER, MARKER, MARKER, [MARKER], 90);
    const confirmedState = { ...startState, currentState: 'confirmed' as const };
    const after = await workflow.requestReschedule(confirmedState);
    assert.equal(after.durationMinutes, 90,
      `reschedule must preserve durationMinutes; got ${after.durationMinutes}`);
  });
});

describe('NFR-080: route validation rejects malformed durationMinutes', () => {
  let server: any;
  let baseUrl = '';
  let token = '';

  before(async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.DATA_DIR = TEST_DIR;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'nfr-080-test-secret-must-be-at-least-32-chars';
    process.env.APPLICANT_JWT_SECRET = 'nfr-080-applicant-secret-must-be-32-chars-min';

    const store = await import('../../src/models/store.js');
    await store.initializeStore();

    // Seed a minimal application/job/applicant so the route gets past its 404 checks.
    await store.updateStore((s: any) => {
      s.applicants.push({ id: 'app-person', firstName: 'Test', lastName: 'Applicant', email: 'a@b.com', createdAt: '', updatedAt: '' });
      s.jobs.push({ id: 'job-1', companyId: 'co-1', jobTitle: 'Test Engineer', positionDescription: '', requirements: [], positionLocation: '', payRange: { min: 0, max: 0, currency: 'USD' }, responsibilities: [], qualifications: [], requiredSkills: [], requiredExperience: 0, reportsTo: '', isActive: true, totalOpenings: 1, currentApplications: 0, createdAt: '', updatedAt: '' });
      s.applications.push({ id: 'appl-1', applicantId: 'app-person', jobPostingId: 'job-1', status: 'pending', appliedAt: '', updatedAt: '' });
      return { ok: true };
    });

    const { app } = await import('../../src/index.js');
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${(address as any).port}`;

    const registered = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: `nfr080-${Date.now()}`,
        password: 'pass1234',
        email: `nfr080-${Date.now()}@example.test`,
        role: 'recruiter',
      }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
    assert.equal(registered.status, 201, `register failed: ${JSON.stringify(registered.body)}`);
    token = registered.body.token;
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.DATA_DIR;
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  async function postSchedule(durationMinutes: unknown): Promise<{ status: number; body: any }> {
    const response = await fetch(`${baseUrl}/api/agents/scheduling/interview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ applicationId: 'appl-1', interviewerIds: ['i-1'], durationMinutes }),
    });
    const body = await response.json();
    return { status: response.status, body };
  }

  it('rejects fractional durationMinutes with HTTP 400', async () => {
    const res = await postSchedule(30.5);
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /positive integer/);
  });

  it('rejects zero durationMinutes with HTTP 400', async () => {
    const res = await postSchedule(0);
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /positive integer/);
  });

  it('rejects negative durationMinutes with HTTP 400', async () => {
    const res = await postSchedule(-15);
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /positive integer/);
  });

  it('rejects nonnumeric durationMinutes with HTTP 400', async () => {
    const res = await postSchedule('45');
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /positive integer/);
  });
});