# Feature: Job Description Generator (JD-001)

**Status:** Implemented  
**Linear:** [REC-11](https://linear.app/recruiting-app/issue/REC-11)  
**Story Points:** 4

Generate professional job descriptions using LLM to help hiring managers quickly create compelling job postings.

---

## Overview

The Job Description Generator uses LangChain to create professional, engaging job descriptions from structured inputs. It supports drafting, A/B variant generation, and direct publishing to the job store.

### Key Features

- **LLM-powered generation** — Professional descriptions from minimal input
- **Auto company context** — Fetches company info when `companyId` provided
- **Draft workflow** — Save, edit, and refine before publishing
- **A/B variants** — Generate multiple tone variants for testing
- **Direct publish** — One-click publish to job postings

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Job Description Generator                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │  API Routes  │────▶│  JD Chain    │────▶│  LLM Client  │   │
│  │(jdGenerator) │     │(jobDesc.ts)  │     │(GPT-4o)      │   │
│  └──────────────┘     └──────────────┘     └──────────────┘   │
│         │                    │                                 │
│         │                    ▼                                 │
│         │             ┌──────────────┐                         │
│         └────────────▶│  Data Store │◀── JobDraft Collection  │
│                       │  (store.ts) │                         │
│                       └──────────────┘                         │
│                              │                                  │
│                              ▼                                  │
│                       ┌──────────────┐                         │
│                       │ JobPosting  │─── Published Jobs       │
│                       └──────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Generate Job Description

```http
POST /api/agents/jd/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "companyId": "uuid",
  "jobTitle": "Senior Software Engineer",
  "department": "Engineering",
  "seniority": "senior",
  "requirements": ["5+ years TypeScript", "React experience"],
  "remotePolicy": "hybrid",
  "tone": "professional"
}
```

**Response (201 Created):**
```json
{
  "draftId": "uuid",
  "jobTitle": "Senior Software Engineer",
  "summary": "We're looking for a Senior Software Engineer...",
  "positionDescription": "As a Senior Software Engineer...",
  "responsibilities": [
    "Lead development of customer-facing features",
    "Mentor junior engineers",
    "Collaborate with product and design teams"
  ],
  "qualifications": [
    "6+ years of software development experience",
    "Expert knowledge of TypeScript and React",
    "Experience with cloud platforms (AWS/GCP)"
  ],
  "requirements": [
    "6+ years of relevant experience",
    "Bachelor's degree in Computer Science or equivalent"
  ],
  "requiredSkills": ["TypeScript", "React", "Node.js", "AWS"],
  "requiredExperience": 6,
  "keywords": ["software engineer", "senior developer", "typescript", "react"],
  "tone": "professional",
  "confidence": 0.92,
  "status": "draft"
}
```

### Generate A/B Variants

```http
POST /api/agents/jd/generate-variants
Authorization: Bearer <token>
Content-Type: application/json

{
  "baseDraftId": "uuid",
  "count": 3,
  "tones": ["professional", "casual", "inclusive"]
}
```

**Response (201 Created):**
```json
{
  "baseDraftId": "uuid",
  "variants": [
    { "draftId": "uuid1", "tone": "professional", "confidence": 0.92 },
    { "draftId": "uuid2", "tone": "casual", "confidence": 0.88 },
    { "draftId": "uuid3", "tone": "inclusive", "confidence": 0.90 }
  ]
}
```

### List Drafts

```http
GET /api/agents/jd/drafts
Authorization: Bearer <token>
```

### Get Draft Details

```http
GET /api/agents/jd/drafts/:id
Authorization: Bearer <token>
```

### Update Draft

```http
PUT /api/agents/jd/drafts/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "summary": "Updated summary...",
  "responsibilities": ["...", "..."]
}
```

### Publish Draft

```http
POST /api/agents/jd/drafts/:id/publish
Authorization: Bearer <token>
```

**Response (201 Created):**
```json
{
  "success": true,
  "jobId": "uuid",
  "jobPosting": {
    "id": "uuid",
    "jobTitle": "Senior Software Engineer",
    "companyId": "uuid",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

### Delete Draft

```http
DELETE /api/agents/jd/drafts/:id
Authorization: Bearer <token>
```

---

## Data Models

### JobDraft

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `companyId` | UUID | Associated company |
| `userId` | UUID | Creator |
| `status` | enum | `draft`, `published`, `archived` |
| `input` | JDGInput | Generation inputs |
| `output` | JDGOutput | Generated content |
| `variantOf` | UUID? | Parent draft if variant |
| `variantsGenerated` | number | Count of variants |
| `createdAt` | ISO Date | Creation timestamp |
| `updatedAt` | ISO Date | Last update |
| `publishedAt` | ISO Date? | When published |

### JDGInput

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `companyId` | UUID | No | Auto-fetch company context |
| `jobTitle` | string | **Yes** | Job title |
| `department` | string | No | Department name |
| `seniority` | enum | No | `entry`, `mid`, `senior`, `lead`, `director` |
| `requirements` | string[] | No | Hard requirements |
| `responsibilities` | string[] | No | Key responsibilities |
| `qualifications` | string[] | No | Preferred qualifications |
| `requiredSkills` | string[] | No | Technical skills |
| `location` | string | No | Job location |
| `remotePolicy` | enum | No | `onsite`, `hybrid`, `remote` |
| `compensation` | object | No | Pay range |
| `tone` | enum | No | `professional`, `casual`, `inclusive`, `startup` |

---

## Tone Options

| Tone | Use Case | Example |
|------|----------|---------|
| `professional` | Corporate, enterprise | Formal language, clear expectations |
| `casual` | Startup, tech | Conversational, friendly |
| `inclusive` | Diversity-focused | Gender-neutral, welcoming |
| `startup` | Early-stage | High-energy, impact-focused |

---

## Workflow

### 1. Generate Draft

```
User → POST /generate
       ├── Validate input
       ├── Fetch company context (if companyId)
       ├── Generate via LLM
       ├── Save to drafts collection
       └── Return draft + generated content
```

### 2. Review & Edit

```
User → GET /drafts/:id
       ├── View generated content
       ├── Edit any field
       └── PUT /drafts/:id with updates
```

### 3. Create Variants (Optional)

```
User → POST /generate-variants
       ├── Read base draft
       ├── Generate variants sequentially
       ├── Save each as new draft
       └── Return variant summaries
```

### 4. Publish

```
User → POST /drafts/:id/publish
       ├── Validate companyId exists
       ├── Transform draft to JobPosting
       ├── Save to jobs collection
       ├── Update draft status
       └── Return created job
```

---

## User Stories

### Story 1: Generate from scratch
> As a hiring manager, I want to generate a job description from just a title, so I can quickly create postings without manual writing.

**Acceptance Criteria:**
- [ ] Generate with only job title
- [ ] Return complete job description structure
- [ ] Save as draft automatically
- [ ] Require authentication

### Story 2: Company personalization
> As a hiring manager, I want the generator to use my company info, so descriptions feel authentic.

**Acceptance Criteria:**
- [ ] Accept companyId in input
- [ ] Auto-fetch company name, description, industry
- [ ] Incorporate into generation prompt
- [ ] Handle missing company gracefully

### Story 3: A/B testing
> As a recruiter, I want multiple tone variants, so I can test which attracts better candidates.

**Acceptance Criteria:**
- [ ] Generate 2-3 variants
- [ ] Each with different tone
- [ ] Sequential generation (cost-effective)
- [ ] Track parent-child relationship

### Story 4: Edit before publish
> As a hiring manager, I want to refine generated content, so I can add my personal touch.

**Acceptance Criteria:**
- [ ] Update any generated field
- [ ] Preserve non-updated fields
- [ ] Cannot edit published drafts
- [ ] Track update timestamp

### Story 5: Direct publish
> As a hiring manager, I want to publish directly from the generator, so I can streamline my workflow.

**Acceptance Criteria:**
- [ ] Convert draft to JobPosting
- [ ] Require companyId for publish
- [ ] Create in jobs collection
- [ ] Update draft status to published

---

## Error Handling

| Error | HTTP Code | Message |
|-------|-----------|---------|
| Missing job title | 400 | "Job title is required" |
| Draft not found | 404 | "Draft not found" |
| Not authorized | 403 | "Not authorized to access this draft" |
| LLM unavailable | 503 | "AI service temporarily unavailable" |
| Already published | 400 | "Draft already published" |
| No company for publish | 400 | "Cannot publish draft without company" |

---

## Configuration

### Environment Variables

```bash
# Required for LLM calls
OPENAI_API_KEY=sk-...

# Optional: Override defaults
JDG_DEFAULT_TONE=professional
JDG_MAX_VARIANTS=3
JDG_TIMEOUT_MS=30000
```

### Model Configuration

| Task | Model | Temperature |
|------|-------|-------------|
| Job Description | GPT-4o | 0.7-0.8 |

---

## Future Enhancements

- [ ] Integration with job boards (Indeed, LinkedIn)
- [ ] SEO optimization suggestions
- [ ] Candidate persona matching
- [ ] Competitive salary insights
- [ ] Diversity score analysis
