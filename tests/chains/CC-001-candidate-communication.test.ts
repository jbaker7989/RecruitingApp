/**
 * CC-001 Candidate Communication Agent — TDD Red Phase
 * These tests define expected behavior BEFORE implementation.
 * They currently FAIL because the feature does not exist yet.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Dynamically import the chain module — will fail until CC-001 is implemented
const ccChain = await import('../../src/chains/candidateCommunication.js').catch(() => null);

describe('CC-001 Candidate Communication Types', () => {
  test('MessageType enum accepts all valid message types', async () => {
    const { MessageType } = await import('../../src/types/candidateCommunication.js');
    assert.doesNotThrow(() => MessageType.parse('application_received'));
    assert.doesNotThrow(() => MessageType.parse('interview_invitation'));
    assert.doesNotThrow(() => MessageType.parse('reschedule_request'));
    assert.doesNotThrow(() => MessageType.parse('rejection'));
    assert.doesNotThrow(() => MessageType.parse('offer_extended'));
    assert.doesNotThrow(() => MessageType.parse('next_steps'));
  });

  test('MessageType enum rejects invalid message types', async () => {
    const { MessageType } = await import('../../src/types/candidateCommunication.js');
    assert.throws(() => MessageType.parse('invalid_message'));
    assert.throws(() => MessageType.parse(''));
  });

  test('ToneType enum accepts valid tones', async () => {
    const { ToneType } = await import('../../src/types/candidateCommunication.js');
    assert.doesNotThrow(() => ToneType.parse('professional'));
    assert.doesNotThrow(() => ToneType.parse('warm'));
    assert.doesNotThrow(() => ToneType.parse('concise'));
    assert.doesNotThrow(() => ToneType.parse('inclusive'));
  });

  test('CCInputSchema validates required fields', async () => {
    const { CCInputSchema } = await import('../../src/types/candidateCommunication.js');
    // Valid input should not throw
    assert.doesNotThrow(() => CCInputSchema.parse({
      messageType: 'interview_invitation',
      applicantName: 'Jane Doe',
      jobTitle: 'Software Engineer',
      tone: 'professional',
    }));
  });

  test('CCInputSchema rejects missing required fields', async () => {
    const { CCInputSchema } = await import('../../src/types/candidateCommunication.js');
    // Missing messageType should throw
    assert.throws(() => CCInputSchema.parse({
      applicantName: 'Jane Doe',
      jobTitle: 'Software Engineer',
    }));
    // Missing applicantName should throw
    assert.throws(() => CCInputSchema.parse({
      messageType: 'interview_invitation',
      jobTitle: 'Software Engineer',
    }));
  });

  test('CCOutputSchema validates required output fields', async () => {
    const { CCOutputSchema } = await import('../../src/types/candidateCommunication.js');
    const validOutput = {
      subject: 'Interview Invitation - Software Engineer',
      body: 'Dear Jane, we would like to invite you to an interview...',
      tone: 'professional',
      messageType: 'interview_invitation',
      confidence: 0.92,
      requiresHumanReview: false,
    };
    assert.doesNotThrow(() => CCOutputSchema.parse(validOutput));
  });

  test('CCOutputSchema rejects invalid confidence range', async () => {
    const { CCOutputSchema } = await import('../../src/types/candidateCommunication.js');
    const invalidOutput = {
      subject: 'Test',
      body: 'Test body',
      tone: 'professional',
      messageType: 'interview_invitation',
      confidence: 1.5, // out of range
      requiresHumanReview: false,
    };
    assert.throws(() => CCOutputSchema.parse(invalidOutput));
  });
});

describe('CC-001 Candidate Communication Chain', () => {
  test('generateCandidateMessage function is exported', () => {
    // The chain module should export generateCandidateMessage
    assert.ok(ccChain !== null, 'candidateCommunication module should exist');
    assert.ok(ccChain.generateCandidateMessage, 'generateCandidateMessage should be exported');
    assert.equal(typeof ccChain.generateCandidateMessage, 'function');
  });

  test('generateCandidateMessage rejects unsupported message types', async () => {
    if (!ccChain) {
      throw new Error('Module not yet implemented');
    }
    // Unsupported message type should throw
    assert.rejects(() =>
      ccChain.generateCandidateMessage({
        messageType: 'unsupported_type' as any,
        applicantName: 'Jane Doe',
        jobTitle: 'Software Engineer',
        tone: 'professional',
      })
    );
  });

  test('generateCandidateMessage accepts all supported message types', async () => {
    if (!ccChain) {
      throw new Error('Module not yet implemented');
    }
    // Check if API key is available — skip if not (LLM required)
    if (!process.env.OPENAI_API_KEY) {
      // Verify the chain is callable and rejects invalid types without API
      await assert.rejects(() =>
        ccChain.generateCandidateMessage({
          messageType: 'unsupported_type' as any,
          applicantName: 'Jane Doe',
          jobTitle: 'Engineer',
          tone: 'professional',
        })
      );
      return;
    }
    // Full integration test when API key is available
    const types = [
      'application_received',
      'interview_invitation',
      'reschedule_request',
      'rejection',
      'offer_extended',
      'next_steps',
    ];
    for (const messageType of types) {
      const result = await ccChain.generateCandidateMessage({
        messageType: messageType as any,
        applicantName: 'Jane Doe',
        jobTitle: 'Software Engineer',
        tone: 'professional',
      });
      assert.ok(result, `${messageType} should return a result`);
      assert.ok(typeof result.subject === 'string', `${messageType} should return a subject`);
      assert.ok(typeof result.body === 'string', `${messageType} should return a body`);
    }
  });
});
