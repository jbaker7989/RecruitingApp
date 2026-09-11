---
name: applications-management
description: Track application statuses, manage the application lifecycle, send status updates, and handle hiring workflow
---

# Applications Management Skills

This skill governs all operations related to application tracking, status management, and the hiring workflow in the New Fronteir Recruiting application.

## Core Functions

### Application Lifecycle Management
- Track applications through statuses: `pending` → `reviewed` → `interview scheduled` → `accepted` or `rejected`
- Validate status transitions (no backward transitions after final status)
- Update application status with proper authorization checks
- When status is `accepted`, trigger hire record creation

### Status Notifications
- Send email notifications to applicants on every status change
- Notify hiring managers of new applications
- Support preferred contact method (email or SMS)

### Match Score Display
- Display calculated match scores (1-10) to recruiters and hiring managers
- Show keyword matches, education match score, and experience match score
- Provide breakdown of scoring criteria

### Resume Matching Engine
- Extract keywords from job requirements and required skills
- Compare against applicant education history, employment history, and resume
- Calculate weighted match score
- Display keyword analysis details

### Hire Workflow Integration
- When application status is set to `accepted`:
  1. Create HireRecord automatically
  2. Associate applicant with company and job
  3. Set hireDate to current date
  4. Set hireStatus to `active`
  5. Notify employer of new hire
  6. Update company's new hire list
- HireRecord contains: applicantId, companyId, jobPostingId, hireDate, positionTitle, status, notifiedEmployer

## Files
- `data/applications.json` — All application records
- `data/hires.json` — All hire records
- `data/observability.json` — Transaction logs
- `data/jobs.json` — Job postings for matching reference

## API Endpoints (Applications)
- `GET /api/applications` — List all applications (role-based filtering)
- `GET /api/applications/:id` — Get application details with match score
- `PUT /api/applications/:id/status` — Update application status (triggers hire if accepted)
- `POST /api/applications/:id/notify` — Send status update notification
- `GET /api/hires` — List all hires (role-based)
- `GET /api/companies/:id/hires` — Get all new hires for a company

## Status Lifecycle
```
pending → reviewed → interview scheduled → accepted
                          ↓
                         rejected
pending → reviewed → rejected
```

## Roles
- `applicant`: View own applications and scores
- `recruiter`: Review and update application statuses
- `hiring-manager`: Full access to all applications and hires
- `member-services`: Admin oversight

## Observability
Every status change creates an observability entry with: timestamp, action ("status_change"), application ID, user ID, old status, new status, and outcome.
Every hire event creates a separate observability entry.
