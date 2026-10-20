import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestTelemetry, type TestTelemetry } from '../src/telemetry/testing.js';
import { addObservabilityEntry, emptyStore, readObservability, readStore, writeStore } from '../src/models/store.js';
import { cancelInterview, completeInterview, createInitialState, getAvailableTransitions, startInterviewScheduling } from '../src/agents/scheduling/agent.js';

const marker = 'synthetic-applicant-private-823719';
let directory: string;
let telemetry: TestTelemetry;
let previousDataDir: string | undefined;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rec-p2-store-'));
  previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  telemetry = createTestTelemetry({ overrides: { traceSampleRatio: 1 } });
});

after(async () => {
  await telemetry?.shutdown();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('S08: real JSON read/write and audit append preserve data while exporting only bounded operation data', async () => {
  const store = emptyStore();
  store.companies.push({
    id: marker, companyName: marker, description: marker, location: 'Synthetic',
    companySize: '1', industry: 'Test', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  });
  await writeStore(store);
  assert.equal((await readStore()).companies[0].companyName, marker);

  assert.deepEqual(await readObservability(), []);
  await addObservabilityEntry({
    id: marker, timestamp: '2026-01-01T00:00:00Z', action: 'test', entityType: 'Test',
    entityId: marker, userId: marker, details: { private: marker }, outcome: 'success',
  });
  assert.equal((await readObservability()).length, 1);
  assert.equal(JSON.parse(await readFile(join(directory, 'observability.json'), 'utf8')).logs.length, 1);

  await telemetry.flush();
  const signal = telemetry.payloadJson();
  assert.ok(!signal.includes(marker), 'exported spans and metrics must exclude stored payloads');
  const spans = telemetry.spans();
  assert.ok(spans.some(span => /store|audit/i.test(span.name)), 'real store operations need spans');
  const write = spans.find(span => span.name === 'store.write');
  const read = spans.find(span => span.name === 'store.read');
  assert.ok(write && read);
  assert.equal(write.attributes['app.store.io_class'], 'ok');
  assert.equal(read.attributes['app.store.io_class'], 'ok');
  assert.match(String(write.attributes['app.size_bucket']), /^(0|1-1024|1025-65536|65537\+)$/);
  assert.match(String(write.attributes['app.count_bucket']), /^(0|1-10|11-50|51\+)$/);
  const audit = spans.find(span => span.name === 'store.audit.append');
  assert.ok(audit, 'audit append needs a total-operation span');
  assert.ok(spans.some(span => span.parentSpanContext?.spanId === audit.spanContext().spanId),
    'audit read/write must be nested under total append');
});

test('S08: a corrupt store keeps its parse failure and reports a bounded telemetry outcome', async () => {
  await writeFile(join(directory, 'store.json'), '{bad synthetic JSON', 'utf8');
  await assert.rejects(readStore(), SyntaxError);
  await telemetry.flush();
  assert.ok(telemetry.spans().some(span => /store/i.test(span.name) && span.status.code !== 0),
    'a failed read must remain diagnosable after it throws');
  assert.ok(!telemetry.payloadJson().includes('{bad synthetic JSON'));
});

test('S09: cancellation is observable as simulated workflow work without exporting run identifiers', async () => {
  const state = createInitialState(marker, marker, marker, marker, [marker]);
  state.currentState = 'collecting_availability';
  await writeStore(emptyStore());
  assert.ok(getAvailableTransitions(state).includes('cancelled'));
  const cancelled = await cancelInterview(state, marker);
  assert.equal(cancelled.currentState, 'cancelled');
  await telemetry.flush();
  const signal = telemetry.payloadJson();
  assert.ok(!signal.includes(marker), 'candidate and cancellation reason must not escape');
  assert.ok(telemetry.spans().some(span => /schedul|workflow/i.test(span.name)),
    'a real state-machine transition needs a workflow span');
  const transition = telemetry.spans().filter(span => span.name === 'scheduling.transition').at(-1);
  assert.ok(transition);
  assert.equal(transition.attributes['app.workflow.name'], 'interview_scheduling');
  assert.equal(transition.attributes['app.workflow.version'], '1');
  assert.equal(transition.attributes['app.integration.mode'], 'simulated');
});

test('S08: missing store and write I/O errors preserve application errors with bounded telemetry', async () => {
  const previous = process.env.DATA_DIR;
  const isolated = join(directory, 'missing-store');
  process.env.DATA_DIR = isolated;
  const before = telemetry.spans().length;
  try {
    await assert.rejects(readStore(), (error: unknown) =>
      (error as NodeJS.ErrnoException).code === 'ENOENT');
    const blocker = join(directory, 'regular-file');
    await writeFile(blocker, 'synthetic blocker', 'utf8');
    process.env.DATA_DIR = blocker;
    await assert.rejects(writeStore(emptyStore()), (error: unknown) =>
      (error as NodeJS.ErrnoException).code === 'ENOTDIR');
  } finally {
    process.env.DATA_DIR = previous;
  }
  await telemetry.flush();
  const spans = telemetry.spans().slice(before);
  assert.equal(spans.filter(span => span.name === 'store.read').length, 1);
  assert.equal(spans.filter(span => span.name === 'store.write').length, 1);
  assert.ok(spans.every(span => span.attributes['app.outcome'] !== 'success'));
  assert.ok(spans.every(span => typeof span.attributes['app.store.io_class'] === 'string'));
  assert.ok(!telemetry.payloadJson().includes(isolated));
});

test('S09: terminal replay and invalid completion leave the state unchanged and do not count a new completion', async () => {
  const state = createInitialState(marker, marker, marker, marker, [marker]);
  state.currentState = 'cancelled';
  const originalState = structuredClone(state);
  await telemetry.flush();
  const successfulCompletionsBefore = telemetry.count('app.scheduling.transition.count',
    { 'app.operation': 'completed', 'app.outcome': 'success' });
  const before = telemetry.spans().length;
  await assert.rejects(completeInterview(state), (error: unknown) => {
    assert.equal((error as Error).message,
      'Invalid transition from cancelled to completed. Allowed: none (terminal state)');
    return true;
  });
  assert.deepEqual(state, originalState, 'rejected completion must not mutate the caller state');
  await telemetry.flush();
  const spans = telemetry.spans().slice(before);
  const transitions = spans.filter(span => span.name === 'scheduling.transition');
  assert.equal(transitions.length, 1, 'rejected replay must emit one ended transition span');
  assert.equal(transitions[0].endTime.length, 2);
  assert.ok(transitions[0].status.code === 2 ||
    ['unknown', 'invalid_state', 'error'].includes(String(transitions[0].attributes['app.outcome'])),
  'rejected replay must report an error status or bounded error outcome');
  assert.equal(spans.filter(span => span.name === 'scheduling.transition' &&
    span.attributes['app.outcome'] === 'success').length, 0);
  assert.equal(telemetry.count('app.scheduling.transition.count',
    { 'app.operation': 'completed', 'app.outcome': 'success' }), successfulCompletionsBefore,
  'rejected replay must not increment successful completion metrics');
  assert.ok(!telemetry.payloadJson().includes(marker));
});

test('S09: missing application returns terminal error without a successful workflow completion', async () => {
  await writeStore(emptyStore());
  const before = telemetry.spans().length;
  const result = await startInterviewScheduling(marker, marker, marker, marker, [marker]);
  assert.equal(result.currentState, 'error');
  await telemetry.flush();
  const spans = telemetry.spans().slice(before);
  const execution = spans.find(span => span.name === 'scheduling.execute');
  assert.ok(execution);
  assert.equal(execution.attributes['app.outcome'], 'error');
  assert.ok(spans.some(span => span.name === 'scheduling.step' &&
    span.parentSpanContext?.spanId === execution.spanContext().spanId));
  assert.ok(!telemetry.payloadJson().includes(marker));
});
