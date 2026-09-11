# New Fronteir Recruiting — Core Domain Logic

## Overview

New Fronteir Recruiting is a full-stack recruiting application that allows companies to post jobs and applicants to apply. The application uses JSON-file-based persistence, supports dynamic resume matching, role-based access control, mass CSV/JSON job import, hire tracking, and an MCP (Model Context Protocol) layer for external/internal interaction.

---

## Data Models

### Company
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (UUID) |
| `companyName` | string | Legal company name |
| `description` | string | Company overview |
| `location` | string | HQ location |
| `companySize` | string | e.g., "1-50", "51-200", "201-1000", "1000+" |
| `industry` | string | Industry sector |
| `createdAt` | string | ISO date |
| `updatedAt` | string | ISO date |

### JobPosting
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (UUID) |
| `companyId` | string | Reference to Company |
| `jobTitle` | string | Title of the position |
| `positionDescription` | string | Full description |
| `requirements` | string[] | List of requirements |
| `positionLocation` | string | Location of the role |
| `payRange` | object | `{ min: number, max: number, currency: string }` |
| `responsibilities` | string[] | List of responsibilities |
| `qualifications` | string[] | Required qualifications |
| `requiredSkills` | string[] | Skills required |
| `requiredExperience` | number | Years of experience required |
| `reportsTo` | string | Who the position reports to |
| `isActive` | boolean | Whether the position is still open for applications |
| `totalOpenings` | number | Total number of openings for this position |
| `currentApplications` | number | Current number of applications received |
| `createdAt` | string | ISO date |
| `updatedAt` | string | ISO date |

### Applicant
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (UUID) |
| `firstName` | string | Legal first name |
| `lastName` | string | Legal last name |
| `email` | string | Primary email |
| `phone` | string | Phone number |
| `preferredContactMethod` | enum | `"email"` or `"sms"` |
| `address` | object | `{ state: string, zip: string }` |
| `educationHistory` | object[] | Array of education entries |
| `employmentHistory` | object[] | Up to 3 prior employers |
| `rightToWork` | boolean | Right to work in country validation |
| `requiresSponsorship` | boolean | Visa sponsorship needed |
| `expectedPay` | number | Expected salary |
| `notificationToManager` | boolean | Whether to notify manager |
| `hireRecords` | HireRecord[] | History of hires associated with this applicant |
| `createdAt` | string | ISO date |
| `updatedAt` | string | ISO date |

### HireRecord
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (UUID) |
| `applicantId` | string | Reference to Applicant |
| `companyId` | string | Reference to Company that hired |
| `jobPostingId` | string | Reference to the JobPosting filled |
| `hireDate` | string | ISO date when hire occurred |
| `positionTitle` | string | Title of the position hired into |
| `status` | enum | `"active"`, `"terminated"`, `"probation"` |
| `notifiedEmployer` | boolean | Whether employer was notified of new hire |
| `createdAt` | string | ISO date |
| `updatedAt` | string | ISO date |

### Application
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (UUID) |
| `applicantId` | string | Reference to Applicant |
| `jobPostingId` | string | Reference to JobPosting |
| `status` | enum | `"pending"`, `"reviewed"`, `"accepted"`, `"rejected"`, `"interview scheduled"` |
| `matchScore` | number | 1-10 score (dynamic calculation) |
| `keywordMatches` | object[] | Keyword analysis details |
| `educationMatchScore` | number | Education fit (1-10) |
| `experienceMatchScore` | number | Experience fit (1-10) |
| `appliedAt` | string | ISO date |
| `updatedAt` | string | ISO date |
| `emailConfirmed` | boolean | Dual email validation status |

### User (Auth)
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (UUID) |
| `username` | string | Login username |
| `passwordHash` | string | Encrypted password |
| `role` | enum | `"member-services"`, `"recruiter"`, `"hiring-manager"`, `"applicant"` |
| `email` | string | Email address |
| `createdAt` | string | ISO date |
| `oauthProvider` | string\|null | Stub for OAuth |

### ObservabilityLog
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (UUID) |
| `timestamp` | string | ISO date |
| `action` | string | What happened |
| `entityType` | string | Company, Job, Applicant, Application, User, Hire |
| `entityId` | string | Entity ID |
| `userId` | string | Who performed the action |
| `details` | object | Additional details |
| `outcome` | string | "success" or "failure" |

---

## Workflows

### 1. Applicant Applies to a Job
1. Applicant browses job postings (frontend → API)
2. Applicant clicks on a job to see details (company info, job info, company size, industry)
3. Applicant submits application form with all required fields
4. Email validation occurs: regex check + confirmation field match
5. System validates right-to-work and sponsorship fields
6. System calculates match score:
   - Keyword matching against job requirements
   - Education history comparison
   - Work experience in years comparison
   - Final score: 1-10 (10 = perfect fit)
7. Application is created with status `"pending"`
8. Observability log entry created
9. Notification sent to applicant (via preferred contact method)
10. Hiring manager notified of new application

### 2. Application Status Updates
1. Hiring manager/recruiter changes application status
2. Status transition validation (e.g., cannot go from "accepted" to "pending")
3. Observability log entry created
4. Email notification sent to applicant with status update
5. Statuses: `pending` → `reviewed` → `interview scheduled` → `accepted` or `rejected`

### 3. Resume Matching Engine
1. Extract keywords from job requirements and required skills
2. Compare against applicant's education history, employment history, and resume
3. Score each dimension:
   - `keywordMatches`: How many required keywords appear in resume
   - `educationMatchScore`: Education level vs. required qualifications
   - `experienceMatchScore`: Years of experience vs. required experience
4. Calculate final `matchScore` (1-10) as weighted average

### 4. Authentication & Authorization
1. User logs in with username + encrypted password
2. Role is checked from `User.role`
3. Role-based access:
   - `applicant`: Can browse jobs, apply, view own applications
   - `recruiter`: Can review applications, update statuses
   - `hiring-manager`: Can post jobs, view all applications, manage recruiters
   - `member-services`: Admin-level, manages users and system settings
4. OAuth stubs ready for future integration

### 5. Mass Job Import
1. Company uploads CSV or JSON file with multiple job openings
2. File is parsed (`papaparse` for CSV, native JSON parsing)
3. Each row/object is validated against the JobPosting schema
4. All parsed jobs are associated with the uploading company
5. Each job is created with `isActive: true` and `currentApplications: 0`
6. Import results are summarized (count, successes, failures)
7. Observability log entries created for each import action
8. When `totalOpenings` are filled or company manually closes them, `isActive` becomes `false`
9. Inactive jobs cannot be applied to
10. Closed/inactive jobs are removed from browse-able listings

### 6. Job Closure & Removal
1. When a job's `currentApplications` reaches `totalOpenings`, `isActive` auto-sets to `false`
2. Hiring manager can manually close a job (set `isActive: false`)
3. Closed/inactive jobs are hidden from applicant browse listings
4. Existing applications on closed jobs remain accessible to recruiters/hiring-managers
5. Observability log tracks every closure

### 7. Applicant Hired (New Hire Tracking)
1. When application status reaches `"accepted"`, a HireRecord can be created
2. HireRecord associates applicant with company, job, hire date, position title
3. Applicant's `hireRecords` array is updated with the new hire
4. Company's new hire list is updated
5. Employer is notified of the new hire
6. `notifiedEmployer` flag tracks whether employer has been notified
7. Hiring manager can view all new hires for their company
8. Employers can see all new hires in their system with dates, positions, etc.
9. Hire status can be updated: `active`, `probation`, `terminated`
10. Observability log tracks every hire event

### 8. MCP Integration
1. Backend exposes MCP-compatible endpoints
2. External systems can query job postings, submit applications
3. Internal systems use same API for management dashboards
4. MCP layer handles model context protocol requests

---

## File Structure

```
rec-app-build/
├── brain/brain.md              ← This file (core domain logic)
├── src/                         ← Application source code
│   ├── index.ts                ← Express server entry point
│   ├── routes/                 ← API route definitions
│   ├── models/                 ← Data models
│   ├── middleware/             ← Auth, validation, logging
│   ├── services/               ← Business logic
│   ├── mcp/                    ← MCP server integration
│   └── frontend/               ← TypeScript frontend
├── applicant-management/       ← Applicant management skills
├── applications-management/    ← Application tracking skills
├── job-management/            ← Job posting management skills
├── data/                      ← JSON data files + observability.json
├── dist/                      ← Compiled TypeScript output
├── package.json
├── tsconfig.json
└── .nvmrc
```

---

## Observability

All transactions are logged to `data/observability.json`. Every action creates an entry with:
- Timestamp, action type, entity type/ID, user ID, details, outcome
- Used for tracking, auditing, and debugging

---

## Email Validation Rules

1. **Primary validation**: Regex pattern to validate email format
2. **Confirmation**: Secondary email field must match primary email exactly
3. Both validations must pass before application is accepted

---

## Status Lifecycle

```
pending → reviewed → interview scheduled → accepted
                          ↓
                         rejected
pending → reviewed → rejected
```

No backward transitions allowed after final status (accepted/rejected).

---

## Job Active Status

- `isActive: true` — Job is open, applicants can apply
- `isActive: false` — Job is closed, removed from browse listings
- Auto-closure: When `currentApplications >= totalOpenings`, `isActive` auto-sets to `false`
- Manual closure: Hiring manager can set `isActive: false` at any time
- Closed jobs remain in data store but are hidden from applicant browse

---

## Hire Status Lifecycle

- `active` — Employee is actively working
- `probation` — Employee is in probationary period
- `terminated` — Employment has ended
- Employers can view all hires with status, position, hire date
- Hire notifications sent to company when new hire is recorded
