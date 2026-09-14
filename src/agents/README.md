# Agentic Workflows

This directory contains LangChain/LangGraph-based agentic workflows for the New Fronteir Recruiting application.

## Available Agents

### 1. Interview Scheduling Agent (`scheduling/agent.ts`)
A state machine for managing the interview scheduling workflow.

**States:**
- `init` - Initial validation
- `collecting_availability` - Requesting availability from candidate and interviewers
- `finding_slot` - Finding overlapping availability
- `sending_invites` - Creating calendar events and sending invites
- `confirmed` - Interview is scheduled
- `reschedule_requested` - Reschedule requested
- `cancelled` - Interview cancelled (terminal)
- `completed` - Interview completed (terminal)
- `error` - Error state (terminal)

**API Endpoints:**
- `POST /api/agents/scheduling/interview` - Start scheduling workflow
- `POST /api/agents/scheduling/reschedule` - Request reschedule
- `POST /api/agents/scheduling/cancel` - Cancel interview
- `POST /api/agents/scheduling/complete` - Mark as completed

## Available Chains

### 1. Resume Parsing Chain (`chains/resumeParsing.ts`)
Extracts structured data from resumes using LLM.

**API Endpoints:**
- `POST /api/agents/resume/parse` - Parse resume file (PDF/DOCX)
- `POST /api/agents/resume/parse-text` - Parse resume from text

**Output Schema:**
```typescript
{
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: { state: string; zip: string; };
  educationHistory: Array<{
    institution: string;
    degree: string;
    fieldOfStudy: string;
    startDate: string;
    endDate: string;
  }>;
  employmentHistory: Array<{
    company: string;
    position: string;
    startDate: string;
    endDate?: string;
    responsibilities?: string[];
  }>;
  skills: string[];
  achievements: string[];
  certifications?: Array<{
    name: string;
    issuingOrganization: string;
    dateObtained?: string;
  }>;
  confidenceScores: Record<string, number>;
}
```

### 2. Semantic Matching Chain (`chains/matching.ts`)
Computes match scores between jobs and candidates using embeddings.

**API Endpoints:**
- `POST /api/agents/matching/score` - Calculate match score for job-applicant pair
- `GET /api/agents/matching/job-suggestions/:applicantId` - Get similar jobs for applicant
- `GET /api/agents/matching/similar-candidates/:jobId` - Find similar candidates for job
- `POST /api/agents/matching/rescore/:jobId` - Rescore all applications for a job
- `POST /api/agents/matching/rebuild-index` - Rebuild semantic index (admin only)

**Score Breakdown:**
- 30% Keyword matching
- 30% Education match
- 30% Experience match
- 10% Semantic similarity (embeddings)

## Services

### LLM Service (`services/llm/index.ts`)
Factory for routing LLM requests to appropriate providers.

**Task Types:**
- `resume-parsing` - Structured output (OpenAI GPT-4o)
- `embeddings` - Text embeddings (OpenAI)
- `scheduling` - Calendar reasoning (Anthropic Claude)
- `communication` - Natural language (Anthropic Claude)
- `job-description` - Creative writing (OpenAI GPT-4o)
- `interview-questions` - Fast generation (OpenAI GPT-4o-mini)

### Vector Store (`services/vectorStore/index.ts`)
In-memory vector storage for semantic search.

Supports:
- Job indexing
- Applicant indexing
- Similarity search
- Batch reindexing

## Configuration

Required environment variables:
```bash
OPENAI_API_KEY=sk-...        # For GPT-4o and embeddings
ANTHROPIC_API_KEY=sk-ant-... # For Claude models
```

## Future Enhancements (Phase 2+)

- BG-001: Background Verification Agent (LangGraph)
- OD-001: Onboarding Orchestration Agent (LangGraph)
- JD-001: Job Description Generator (LangChain)
- CC-001: Candidate Communication Agent (LangChain)
