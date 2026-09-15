/**
 * Unit Tests for Job Description Generator Chain
 * NFR-044 fix: rewrote from Vitest to node:test + node:assert/strict
 *
 * Note: Functions that call the LLM (generateJobDescription,
 * generateJobDescriptionVariants) are tested as exported functions only;
 * full integration tests require a valid OPENAI_API_KEY and are
 * covered by the API route integration tests.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Dynamically import so tsx can compile the TypeScript source
const { calculateInputConfidence } = await import('../../src/chains/jobDescription.js');

describe('JDG Chain calculateInputConfidence', () => {
  test('returns base score for empty input', () => {
    const score = calculateInputConfidence({ jobTitle: '' });
    assert.equal(score, 0.5);
  });

  test('increases score for job title', () => {
    const score = calculateInputConfidence({ jobTitle: 'Software Engineer' });
    assert.equal(score, 0.6);
  });

  test('increases score for requirements', () => {
    const score = calculateInputConfidence({
      jobTitle: 'Software Engineer',
      requirements: ['5 years experience', 'JavaScript'],
    });
    assert.equal(score, 0.7);
  });

  test('increases score for all fields', () => {
    const score = calculateInputConfidence({
      jobTitle: 'Software Engineer',
      department: 'Engineering',
      seniority: 'senior',
      requirements: ['5 years experience'],
      responsibilities: ['Write code'],
      qualifications: ['CS degree'],
      requiredSkills: ['JavaScript'],
      location: 'Remote',
      remotePolicy: 'remote',
      compensation: { min: 100000, max: 150000, currency: 'USD' },
    });
    assert.ok(score > 0.9, `score ${score} should exceed 0.9`);
  });

  test('caps score at 1.0', () => {
    const score = calculateInputConfidence({
      jobTitle: 'Software Engineer',
      department: 'Engineering',
      seniority: 'senior',
      requirements: ['5 years experience'],
      responsibilities: ['Write code'],
      qualifications: ['CS degree'],
      requiredSkills: ['JavaScript'],
      location: 'Remote',
      remotePolicy: 'remote',
      compensation: { min: 100000, max: 150000, currency: 'USD' },
    });
    assert.ok(score <= 1.0, `score ${score} should not exceed 1.0`);
  });

  test('score increases with each additional field', () => {
    // Baseline: empty
    const base = calculateInputConfidence({});
    // Add title
    const withTitle = calculateInputConfidence({ jobTitle: 'Engineer' });
    assert.ok(withTitle > base, 'title should increase score');
    // Add department
    const withDept = calculateInputConfidence({ jobTitle: 'Engineer', department: 'Eng' });
    assert.ok(withDept > withTitle, 'department should increase score');
    // Add seniority
    const withSeniority = calculateInputConfidence({ jobTitle: 'Engineer', department: 'Eng', seniority: 'senior' });
    assert.ok(withSeniority > withDept, 'seniority should increase score');
    // Add requirements
    const withReqs = calculateInputConfidence({ jobTitle: 'Engineer', department: 'Eng', seniority: 'senior', requirements: ['5 years'] });
    assert.ok(withReqs > withSeniority, 'requirements should increase score');
  });
});

describe('JDG Types', () => {
  test('exports all required type definitions', async () => {
    const types = await import('../../src/types/jdGenerator.js');
    assert.ok(types.JDGInputSchema, 'JDGInputSchema should be exported');
    assert.ok(types.JDGOutputSchema, 'JDGOutputSchema should be exported');
    assert.ok(types.SeniorityLevel, 'SeniorityLevel should be exported');
    assert.ok(types.RemotePolicy, 'RemotePolicy should be exported');
    assert.ok(types.ToneType, 'ToneType should be exported');
    assert.ok(types.DraftStatus, 'DraftStatus should be exported');
  });

  test('SeniorityLevel accepts valid enum values and rejects invalid', async () => {
    const { SeniorityLevel } = await import('../../src/types/jdGenerator.js');
    assert.doesNotThrow(() => SeniorityLevel.parse('entry'));
    assert.doesNotThrow(() => SeniorityLevel.parse('mid'));
    assert.doesNotThrow(() => SeniorityLevel.parse('senior'));
    assert.doesNotThrow(() => SeniorityLevel.parse('lead'));
    assert.doesNotThrow(() => SeniorityLevel.parse('director'));
    assert.throws(() => SeniorityLevel.parse('invalid'));
  });

  test('RemotePolicy accepts valid enum values', async () => {
    const { RemotePolicy } = await import('../../src/types/jdGenerator.js');
    assert.doesNotThrow(() => RemotePolicy.parse('onsite'));
    assert.doesNotThrow(() => RemotePolicy.parse('hybrid'));
    assert.doesNotThrow(() => RemotePolicy.parse('remote'));
  });

  test('ToneType accepts valid enum values', async () => {
    const { ToneType } = await import('../../src/types/jdGenerator.js');
    assert.doesNotThrow(() => ToneType.parse('professional'));
    assert.doesNotThrow(() => ToneType.parse('casual'));
    assert.doesNotThrow(() => ToneType.parse('inclusive'));
    assert.doesNotThrow(() => ToneType.parse('startup'));
  });

  test('DraftStatus accepts valid enum values', async () => {
    const { DraftStatus } = await import('../../src/types/jdGenerator.js');
    assert.doesNotThrow(() => DraftStatus.parse('draft'));
    assert.doesNotThrow(() => DraftStatus.parse('published'));
    assert.doesNotThrow(() => DraftStatus.parse('archived'));
  });

  test('JDGInputSchema validates and accepts valid input', async () => {
    const { JDGInputSchema } = await import('../../src/types/jdGenerator.js');
    const validInput = {
      jobTitle: 'Software Engineer',
      department: 'Engineering',
      seniority: 'senior',
      requirements: ['5 years experience'],
      tone: 'professional',
    };
    assert.doesNotThrow(() => JDGInputSchema.parse(validInput));
  });

  test('JDGInputSchema rejects missing jobTitle', async () => {
    const { JDGInputSchema } = await import('../../src/types/jdGenerator.js');
    const invalidInput = { department: 'Engineering' };
    assert.throws(() => JDGInputSchema.parse(invalidInput));
  });

  test('JDGInputSchema applies default tone and empty arrays', async () => {
    const { JDGInputSchema } = await import('../../src/types/jdGenerator.js');
    const parsed = JDGInputSchema.parse({ jobTitle: 'Engineer' });
    assert.equal(parsed.tone, 'professional');
    assert.ok(Array.isArray(parsed.requirements));
    assert.equal(parsed.requirements.length, 0);
    assert.ok(Array.isArray(parsed.responsibilities));
    assert.equal(parsed.responsibilities.length, 0);
  });

  test('JDGOutputSchema validates expected output structure', async () => {
    const { JDGOutputSchema } = await import('../../src/types/jdGenerator.js');
    const validOutput = {
      summary: 'A great role',
      positionDescription: 'Long description here',
      responsibilities: ['Build features', 'Write tests'],
      qualifications: ['5 years exp', 'CS degree'],
      requirements: ['Python', 'AWS'],
      requiredSkills: ['Python', 'Docker'],
      requiredExperience: 5,
      keywords: ['software', 'engineer'],
      confidence: 0.85,
    };
    assert.doesNotThrow(() => JDGOutputSchema.parse(validOutput));
  });

  test('JDGOutputSchema rejects invalid confidence', async () => {
    const { JDGOutputSchema } = await import('../../src/types/jdGenerator.js');
    const invalidOutput = {
      summary: 'A great role',
      positionDescription: 'Desc',
      responsibilities: [],
      qualifications: [],
      requirements: [],
      requiredSkills: [],
      requiredExperience: 0,
      keywords: [],
      confidence: 1.5, // out of range
    };
    assert.throws(() => JDGOutputSchema.parse(invalidOutput));
  });
});
