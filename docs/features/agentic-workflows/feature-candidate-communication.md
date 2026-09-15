# CC-001: Candidate Communication Agent

**Status:** Implemented | **Story:** REC-12 | **Type:** LangChain Agent

Generate personalized recruiter-to-candidate messages using LLM-powered prompt chains.

## Overview

The Candidate Communication Agent (CC-001) uses LangChain prompt templates to generate professional recruiting messages. It adapts tone, personalizes content, and returns structured JSON ready for review or dispatch.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  POST /api/agents/communication/generate              │
│  POST /api/agents/communication/generate-variants  │
│  GET  /api/agents/communication/templates          │
└────────────────┬────────────────────────────────────┘
                   │ CCInput
                   ▼
┌─────────────────────────────────────────────────────┐
│  candidateCommunication.ts (LangChain chain)        │
│  - PromptTemplate with tone modifiers              │
│  - ChatOpenAI (GPT-4o)                            │
│  - JSON output parsing + Zod validation            │
└────────────────┬────────────────────────────────────┘
                   │ CCOutput (subject, body, confidence, ...)
                   ▼
              Recruiter / Hiring Manager
```

## Message Types

| Type | Description | Recommended Tone |
|------|-------------|-----------------|
| `application_received` | Acknowledge application submission | warm |
| `interview_invitation` | Invite candidate to interview | professional |
| `reschedule_request` | Request or acknowledge rescheduling | concise |
| `rejection` | Inform candidate they were not selected | warm |
| `offer_extended` | Communicate a formal offer | professional |
| `next_steps` | Provide follow-up instructions | concise |

## Tones

- **professional**: Formal, business-appropriate, direct
- **warm**: Friendly, approachable, genuine interest
- **concise**: Brief, to the point, respects time
- **inclusive**: Gender-neutral, no assumptions

## API Endpoints

### POST /api/agents/communication/generate

Generate a single personalized message.

**Request:**
```json
{
  "messageType": "interview_invitation",
  "applicantName": "Jane Doe",
  "jobTitle": "Senior Software Engineer",
  "companyName": "Acme Corp",
  "interviewerName": "John Smith",
  "scheduledTime": "2024-01-15 at 2:00 PM EST",
  "location": "https://meet.google.com/abc-defg-hij",
  "additionalNotes": "Please bring your portfolio",
  "tone": "professional"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "subject": "Interview Invitation — Senior Software Engineer at Acme Corp",
    "body": "Dear Jane,\n\nThank you for your application...",
    "tone": "professional",
    "messageType": "interview_invitation",
    "confidence": 0.94,
    "requiresHumanReview": false
  }
}
```

### POST /api/agents/communication/generate-variants

Generate A/B tone variants of a message.

**Request:**
```json
{
  "baseInput": {
    "messageType": "rejection",
    "applicantName": "Jane Doe",
    "jobTitle": "Software Engineer"
  },
  "count": 2,
  "tones": ["professional", "warm"]
}
```

### GET /api/agents/communication/templates

List available message templates with recommended tones.

## Input Schema

```typescript
{
  messageType: 'application_received' | 'interview_invitation' | 'reschedule_request' | 'rejection' | 'offer_extended' | 'next_steps',
  applicantName: string,
  jobTitle: string,
  companyName?: string,
  interviewerName?: string,
  scheduledTime?: string,
  location?: string,
  additionalNotes?: string,
  tone?: 'professional' | 'warm' | 'concise' | 'inclusive',
  companyContext?: string
}
```

## Output Schema

```typescript
{
  subject: string,        // 10-80 characters
  body: string,          // 100-500 words
  tone: ToneType,
  messageType: MessageType,
  confidence: number,      // 0.0-1.0
  requiresHumanReview: boolean  // true for salary/legal content
}
```

## Files

| File | Purpose |
|------|---------|
| `src/types/candidateCommunication.ts` | Type definitions, Zod schemas |
| `src/chains/candidateCommunication.ts` | LangChain prompt + chain |
| `src/routes/agents/candidateCommunication.ts` | API endpoints |
| `tests/chains/CC-001-candidate-communication.test.ts` | Unit tests |

## LLM Configuration

- **Model:** GPT-4o via `OPENAI_API_KEY`
- **Task type:** `candidate-communication`
- **Temperature:** 0.7 (balanced creativity/factuality)
- **Output:** Structured JSON via Zod schema

## Acceptance Criteria

- [x] Generate messages for all 6 message types
- [x] Support all 4 tones (professional, warm, concise, inclusive)
- [x] Return structured JSON with confidence score
- [x] Reject unsupported message types with clear errors
- [x] Mark sensitive content (`requiresHumanReview: true`)
- [x] Generate A/B tone variants
- [x] Log observability entries for all generations
