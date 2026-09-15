/**
 * Unit Tests for Job Description Generator Chain
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the LLM client
vi.mock('../../src/services/llm/index.js', () => ({
  getLLMClient: vi.fn(() => ({
    invoke: vi.fn(),
  })),
}));

describe('JDG Chain', () => {
  // Import after mocking
  let generateJobDescription: any;
  let generateJobDescriptionVariants: any;
  let calculateInputConfidence: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import('../../src/chains/jobDescription.js');
    generateJobDescription = module.generateJobDescription;
    generateJobDescriptionVariants = module.generateJobDescriptionVariants;
    calculateInputConfidence = module.calculateInputConfidence;
  });

  describe('calculateInputConfidence', () => {
    it('should return base score for empty input', () => {
      const input = { jobTitle: '' };
      const score = calculateInputConfidence(input as any);
      expect(score).toBe(0.5);
    });

    it('should increase score for job title', () => {
      const input = { jobTitle: 'Software Engineer' };
      const score = calculateInputConfidence(input as any);
      expect(score).toBe(0.6);
    });

    it('should increase score for requirements', () => {
      const input = { 
        jobTitle: 'Software Engineer',
        requirements: ['5 years experience', 'JavaScript'],
      };
      const score = calculateInputConfidence(input as any);
      expect(score).toBe(0.7);
    });

    it('should increase score for all fields', () => {
      const input = { 
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
      };
      const score = calculateInputConfidence(input as any);
      expect(score).toBeGreaterThan(0.9);
    });

    it('should cap score at 1.0', () => {
      const input = { 
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
      };
      const score = calculateInputConfidence(input as any);
      expect(score).toBeLessThanOrEqual(1.0);
    });
  });

  describe('generateJobDescription', () => {
    it('should be defined', () => {
      expect(generateJobDescription).toBeDefined();
      expect(typeof generateJobDescription).toBe('function');
    });

    // Note: Full integration test would require actual LLM mocking
    // These are structural tests only
  });

  describe('generateJobDescriptionVariants', () => {
    it('should be defined', () => {
      expect(generateJobDescriptionVariants).toBeDefined();
      expect(typeof generateJobDescriptionVariants).toBe('function');
    });
  });
});

describe('JDG Types', () => {
  it('should export type definitions', async () => {
    const types = await import('../../src/types/jdGenerator.js');
    // These are Zod schemas, not plain types
    expect(types.JDGInputSchema).toBeDefined();
    expect(types.JDGOutputSchema).toBeDefined();
    expect(types.SeniorityLevel).toBeDefined();
    expect(types.RemotePolicy).toBeDefined();
    expect(types.ToneType).toBeDefined();
    expect(types.DraftStatus).toBeDefined();
  });

  it('should have valid enum values', async () => {
    const types = await import('../../src/types/jdGenerator.js');
    
    // Seniority
    expect(() => types.SeniorityLevel.parse('entry')).not.toThrow();
    expect(() => types.SeniorityLevel.parse('mid')).not.toThrow();
    expect(() => types.SeniorityLevel.parse('senior')).not.toThrow();
    expect(() => types.SeniorityLevel.parse('lead')).not.toThrow();
    expect(() => types.SeniorityLevel.parse('director')).not.toThrow();
    expect(() => types.SeniorityLevel.parse('invalid')).toThrow();
    
    // RemotePolicy
    expect(() => types.RemotePolicy.parse('onsite')).not.toThrow();
    expect(() => types.RemotePolicy.parse('hybrid')).not.toThrow();
    expect(() => types.RemotePolicy.parse('remote')).not.toThrow();
    
    // ToneType
    expect(() => types.ToneType.parse('professional')).not.toThrow();
    expect(() => types.ToneType.parse('casual')).not.toThrow();
    expect(() => types.ToneType.parse('inclusive')).not.toThrow();
    expect(() => types.ToneType.parse('startup')).not.toThrow();
    
    // DraftStatus
    expect(() => types.DraftStatus.parse('draft')).not.toThrow();
    expect(() => types.DraftStatus.parse('published')).not.toThrow();
    expect(() => types.DraftStatus.parse('archived')).not.toThrow();
  });

  it('should validate input schema', async () => {
    const types = await import('../../src/types/jdGenerator.js');
    
    // Valid input
    const validInput = {
      jobTitle: 'Software Engineer',
      department: 'Engineering',
      seniority: 'senior',
      requirements: ['5 years experience'],
      tone: 'professional',
    };
    expect(() => types.JDGInputSchema.parse(validInput)).not.toThrow();
    
    // Invalid input - missing jobTitle
    const invalidInput = {
      department: 'Engineering',
    };
    expect(() => types.JDGInputSchema.parse(invalidInput)).toThrow();
  });

  it('should have default values', async () => {
    const types = await import('../../src/types/jdGenerator.js');
    
    const minimalInput = { jobTitle: 'Engineer' };
    const parsed = types.JDGInputSchema.parse(minimalInput);
    
    expect(parsed.requirements).toEqual([]);
    expect(parsed.tone).toBe('professional');
  });
});
