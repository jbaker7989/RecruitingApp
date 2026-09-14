# Agentic Workflows - Feature Documentation

This directory contains detailed documentation for each agentic workflow feature.

## Features

| Feature | Story ID | Priority | Phase | Status |
|---------|----------|----------|-------|--------|
| [Intelligent Resume Parsing](feature-resume-parsing.md) | RP-001 | P0 | 1 | ✅ Implemented |
| [Semantic Matching](feature-semantic-matching.md) | SC-001 | P0 | 1 | ✅ Implemented |
| [Interview Scheduling](feature-interview-scheduling.md) | IS-001 | P1 | 1 | ✅ Implemented |

## Future Features (Phase 2+)

| Feature | Story ID | Priority | Phase | Status |
|---------|----------|----------|-------|--------|
| Background Verification | BG-001 | P1 | 2 | 📋 Planned |
| Job Description Generation | JD-001 | P2 | 2 | 📋 Planned |
| Candidate Communication | CC-001 | P2 | 2 | 📋 Planned |
| Onboarding Orchestration | OD-001 | P2 | 2 | 📋 Planned |

## Quick Start

### Prerequisites
```bash
# Set up environment
cp .env.example .env

# Add API keys
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...

# Install dependencies
npm install
```

### Start Server
```bash
npm run dev
```

### Test Resume Parsing
```bash
curl -X POST http://localhost:3000/api/agents/resume/parse \
  -H "Authorization: Bearer <token>" \
  -F "resume=@resume.pdf"
```

### Calculate Match Score
```bash
curl -X POST http://localhost:3000/api/agents/matching/score \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"applicantId": "app_123", "jobId": "job_456"}'
```

### Start Interview Scheduling
```bash
curl -X POST http://localhost:3000/api/agents/scheduling/interview \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "applicationId": "app_123",
    "interviewerIds": ["user_xyz"],
    "proposedTimes": ["2024-03-15T10:00:00Z"]
  }'
```

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                      New Fronteir Recruiting App               │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐     │
│  │   Resume     │   │   Semantic   │   │   Interview  │     │
│  │   Parsing    │   │   Matching   │   │  Scheduling  │     │
│  │   (Chain)    │   │   (Chain)    │   │   (Agent)    │     │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘     │
│         │                   │                   │              │
│         ▼                   ▼                   ▼              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐     │
│  │    LLM       │   │    Vector    │   │    State     │     │
│  │   Service    │   │    Store     │   │   Machine    │     │
│  └──────────────┘   └──────────────┘   └──────────────┘     │
│         │                   │                   │              │
│         ▼                   ▼                   ▼              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │              OpenAI / Anthropic APIs                │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Dependencies

| Package | Purpose | Used By |
|---------|---------|---------|
| `@langchain/langgraph` | State machine orchestration | Interview Scheduling |
| `@langchain/openai` | GPT models for parsing | Resume Parsing |
| `@langchain/anthropic` | Claude models for reasoning | Interview Scheduling |
| `pdf-parse` | PDF text extraction | Resume Parsing |
| `mammoth` | DOCX text extraction | Resume Parsing |
| `zod` | Schema validation | All features |

## Monitoring

All agentic workflows emit observability events:

```json
{
  "id": "obs_abc123",
  "timestamp": "2024-03-10T12:00:00Z",
  "action": "state_transition",
  "entityType": "Interview",
  "entityId": "app_123",
  "userId": "system",
  "details": {
    "from": "finding_slot",
    "to": "sending_invites",
    "selectedTime": "2024-03-15T10:00:00Z"
  },
  "outcome": "success"
}
```

Access logs via:
```bash
GET /api/observability?entityType=Interview&limit=50
```
