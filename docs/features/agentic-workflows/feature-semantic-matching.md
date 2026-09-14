# Feature: Semantic Matching

**Story ID:** SC-001  
**Priority:** P0 (Critical)  
**Points:** 5  
**Phase:** 1 - Foundation

## Overview

Semantic Matching enhances the existing keyword-based matching system with vector embeddings, enabling the application to understand the *meaning* behind job requirements and candidate qualifications—not just exact keyword matches.

## Technical Implementation

### Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Job Posting    │────▶│  Text Builder    │────▶│  Embeddings API │
│  (Full Profile) │     │  (Combine all    │     │  (text-         │
│                 │     │   relevant       │     │   embedding-3)  │
└─────────────────┘     │   fields)        │     └────────┬────────┘
                        └──────────────────┘              │
                                                         ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Match Score    │◀────│  Score Calculator │◀────│  Cosine         │
│  (0-10 scale)  │     │  (Weighted       │     │  Similarity     │
│                 │     │   Average)       │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Score Calculation

The final match score combines four components:

| Component | Weight | Description |
|-----------|--------|-------------|
| Keyword Score | 30% | Exact/semantic keyword matching |
| Education Score | 30% | Degree level and field alignment |
| Experience Score | 30% | Years of experience comparison |
| Semantic Score | 10% | Vector embedding similarity |

**Weights are configurable** and can be adjusted per job type or company preference.

### Vector Store

An in-memory vector store maintains embeddings for:
- All active job postings
- All applicants

When new content is added:
1. Build combined text representation
2. Generate embedding via OpenAI
3. Store in vector index
4. Update last indexed timestamp

**Note:** For production, replace with ChromaDB or Pinecone for persistence and scalability.

## Text Representation

### Job Posting
```
[Job Title]
[Full Position Description]
Requirements:
- [requirement 1]
- [requirement 2]
...
Responsibilities:
- [responsibility 1]
...
Qualifications:
- [qualification 1]
...
Skills:
- [skill 1]
- [skill 2]
...
Location: [City, State]
```

### Applicant Profile
```
Candidate: [First Name] [Last Name]
Education:
- [Degree] in [Field] from [Institution]
- ...
Experience:
- [Position] at [Company]: [responsibilities...]
- ...
Skills:
- [skill 1]
- [skill 2]
...
Achievements:
- [quantified achievement 1]
- ...
```

## API Endpoints

### POST /api/agents/matching/score

Calculate match score for a specific job-applicant pair.

**Request:**
```json
{
  "applicantId": "applicant_abc123",
  "jobId": "job_xyz789"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "applicationId": "",
    "jobId": "job_xyz789",
    "applicantId": "applicant_abc123",
    "keywordScore": 8.5,
    "educationScore": 9.0,
    "experienceScore": 7.2,
    "semanticScore": 8.9,
    "finalScore": 8.4,
    "breakdown": {
      "keywordWeight": 0.30,
      "educationWeight": 0.30,
      "experienceWeight": 0.30,
      "semanticWeight": 0.10
    }
  }
}
```

### GET /api/agents/matching/job-suggestions/:applicantId

Get job recommendations for an applicant (passive candidate sourcing).

**Query Parameters:**
- `excludeApplied=true` (default) - Exclude already applied jobs
- `limit=5` - Maximum results (default: 5)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "jobId": "job_abc123",
      "similarityScore": 0.87,
      "jobTitle": "Senior Software Engineer"
    },
    {
      "jobId": "job_def456",
      "similarityScore": 0.82,
      "jobTitle": "Tech Lead"
    }
  ]
}
```

### GET /api/agents/matching/similar-candidates/:jobId

Find candidates similar to a job posting (passive sourcing).

**Query Parameters:**
- `limit=10` - Maximum results (default: 10)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "applicantId": "applicant_xyz789",
      "similarityScore": 0.91,
      "candidateName": "John Smith"
    }
  ]
}
```

### POST /api/agents/matching/rescore/:jobId

Rescore all applications for a specific job.

**Response:**
```json
{
  "success": true,
  "data": {
    "updated": 15,
    "errors": 0
  }
}
```

### POST /api/agents/matching/rebuild-index

Rebuild the entire semantic index (admin operation).

**Response:**
```json
{
  "success": true,
  "data": {
    "jobsIndexed": 45,
    "applicantsIndexed": 230,
    "applicationsRescored": 180,
    "errors": 0
  }
}
```

## User Stories

### US-SC-001: Recruiter Views Match Score
**As a** recruiter  
**I want to** see a composite match score for each application  
**So that** I can quickly identify top candidates

**Acceptance Criteria:**
- [ ] Display final score (0-10) on each application
- [ ] Show score breakdown (4 components)
- [ ] Sort applications by score
- [ ] Filter by score threshold

### US-SC-002: System Suggests Jobs to Candidates
**As a** system  
**I want to** recommend relevant jobs to applicants  
**So that** candidates discover opportunities they might have missed

**Acceptance Criteria:**
- [ ] Show top 5 job suggestions per applicant
- [ ] Exclude already-applied jobs
- [ ] Display similarity score
- [ ] Update suggestions when new jobs are posted

### US-SC-003: System Sources Passive Candidates
**As a** system  
**I want to** find candidates similar to a job posting  
**So that** recruiters can reach out to potential fits

**Acceptance Criteria:**
- [ ] Return top 10 similar candidates
- [ ] Exclude existing applicants
- [ ] Include similarity score
- [ ] Show candidate name for reference

## Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Embedding Model | text-embedding-3-small | Cost-effective, high quality |
| Embedding Dimension | 1536 | Standard for the model |
| Similarity Threshold | 0.6 | Minimum score for "similar" |
| Default Weights | 30/30/30/10 | Keyword/Edu/Exp/Semantic |
| Reindex Batch Size | 100 | Records per batch |

## Dependencies

```json
{
  "@langchain/openai": "^0.3.0"
}
```

## Production Considerations

### Scaling
- Current in-memory store suitable for ~10K records
- For larger scale, migrate to:
  - **ChromaDB** - Self-hosted, easy setup
  - **Pinecone** - Managed, serverless option
  - **Weaviate** - Open source, hybrid search

### Performance
- Embedding generation is async (background job)
- Cache embeddings, regenerate only on update
- Use batch embedding endpoints for bulk operations

### Maintenance
- Reindex nightly for new content
- Monitor embedding drift over time
- Log low-confidence matches for review
