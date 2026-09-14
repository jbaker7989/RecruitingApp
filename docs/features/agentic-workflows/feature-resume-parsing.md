# Feature: Intelligent Resume Parsing

**Story ID:** RP-001  
**Priority:** P0 (Critical)  
**Points:** 5  
**Phase:** 1 - Foundation

## Overview

The Intelligent Resume Parsing feature uses LLM to automatically extract structured data from uploaded resumes (PDF/DOCX format). This eliminates manual data entry and ensures consistent, high-quality candidate profiles.

## Technical Implementation

### Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Resume Upload  │────▶│  File Extractor  │────▶│   LLM Parser    │
│  (PDF/DOCX)     │     │  (pdf-parse/     │     │   (GPT-4o)     │
│                 │     │   mammoth)       │     │                 │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Store in DB    │◀────│  Validate &     │◀────│  Structured     │
│  (Applicant     │     │  Normalize       │     │  JSON Output    │
│   Profile)      │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Output Schema

```typescript
interface ParsedResume {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: {
    state: string;
    zip: string;
  };
  educationHistory: EducationEntry[];
  employmentHistory: EmploymentEntry[];
  skills: string[];
  achievements: string[];
  certifications?: Certification[];
  confidenceScores: Record<string, number>;  // 0-1 per field
  rawText: string;
}

interface EducationEntry {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string;      // YYYY-MM
  endDate: string;       // YYYY-MM or "Present"
  gpa?: string;
}

interface EmploymentEntry {
  company: string;
  position: string;
  startDate: string;      // YYYY-MM
  endDate?: string;       // YYYY-MM or "Present"
  responsibilities?: string[];
}

interface Certification {
  name: string;
  issuingOrganization: string;
  dateObtained?: string;
}
```

### LLM Prompt Strategy

The parser uses a structured output prompt with:
- Clear schema instructions
- Emphasis on quantified achievements
- Confidence scoring per field
- Error handling for ambiguous data

## API Endpoints

### POST /api/agents/resume/parse

Parse an uploaded resume file.

**Authentication:** Required (applicant, recruiter, hiring-manager, member-services)

**Request:**
```
Content-Type: multipart/form-data

resume: <file>  // PDF or DOCX, max 10MB
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "firstName": "Sarah",
    "lastName": "Chen",
    "email": "sarah.chen@email.com",
    "phone": "+1-555-0123",
    "educationHistory": [
      {
        "institution": "Stanford University",
        "degree": "Bachelor of Science",
        "fieldOfStudy": "Computer Science",
        "startDate": "2018-09",
        "endDate": "2022-06",
        "gpa": "3.8"
      }
    ],
    "employmentHistory": [
      {
        "company": "TechCorp Inc",
        "position": "Software Engineer",
        "startDate": "2022-07",
        "responsibilities": [
          "Led migration of legacy monolith to microservices architecture",
          "Reduced API response time by 40% through optimization",
          "Mentored 3 junior engineers"
        ]
      }
    ],
    "skills": ["Python", "TypeScript", "AWS", "Docker", "PostgreSQL"],
    "achievements": [
      "Increased test coverage from 45% to 92%",
      "Reduced deployment time from 2 hours to 15 minutes"
    ],
    "confidenceScores": {
      "firstName": 0.99,
      "lastName": 0.99,
      "email": 0.98,
      "skills": 0.85,
      "achievements": 0.75
    }
  }
}
```

**Errors:**
- `400` - Invalid file type or size exceeded
- `401` - Unauthorized
- `500` - Parsing failed

### POST /api/agents/resume/parse-text

Parse resume data from raw text input.

**Request Body:**
```json
{
  "resumeText": "Sarah Chen\nsarah.chen@email.com\n..."
}
```

**Response:** Same as `/parse`

## User Stories

### US-RP-001: Candidate Uploads Resume
**As a** job applicant  
**I want to** upload my resume in PDF or Word format  
**So that** my profile is automatically populated without manual entry

**Acceptance Criteria:**
- [ ] Accept PDF files up to 10MB
- [ ] Accept DOCX files up to 10MB
- [ ] Return structured JSON matching schema
- [ ] Provide confidence scores for each field
- [ ] Extract education history with dates
- [ ] Extract employment history with dates
- [ ] Identify quantified achievements
- [ ] Handle malformed resumes gracefully

### US-RP-002: Recruiter Reviews Parsed Data
**As a** recruiter  
**I want to** see confidence scores for parsed data  
**So that** I know which fields need verification

**Acceptance Criteria:**
- [ ] Display confidence scores in UI
- [ ] Highlight fields with confidence < 0.7
- [ ] Allow manual correction of parsed data
- [ ] Save corrections for future improvements

## Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Model | GPT-4o | Best for structured output |
| Temperature | 0.1 | Low for consistent parsing |
| Max Tokens | 4096 | Sufficient for full resume |
| File Size Limit | 10MB | Prevent abuse |
| Supported Types | PDF, DOCX | Common resume formats |

## Dependencies

```json
{
  "@langchain/openai": "^0.3.0",
  "pdf-parse": "latest",
  "mammoth": "latest"
}
```

## Future Enhancements

- [ ] Support for image-based PDFs (OCR)
- [ ] Multi-language resume support
- [ ] LinkedIn profile import
- [ ] Resume comparison/ranking
- [ ] Duplicate detection across uploads
