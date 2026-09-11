---
name: applicant-management
description: Manage applicant profiles, application submissions, hiring tracking, and applicant data validation
---

# Applicant Management Skills

This skill governs all operations related to applicant management in the New Fronteir Recruiting application.

## Core Functions

### Applicant Profile Management
- Create, read, update, and delete applicant profiles
- Validate all applicant fields (legal name, email, phone, address, etc.)
- Store and retrieve applicant data from JSON file store

### Application Submission
- Handle new application submissions
- Validate email format using Regex + confirmation field match
- Validate right-to-work and sponsorship fields
- Calculate match scores on submission

### Hiring Tracking
- When an application is accepted, create a HireRecord
- Associate applicant with company, job posting, hire date, position title
- Track hire status: `active`, `probation`, `terminated`
- Maintain `hireRecords` array on each applicant profile
- Notify employer of new hire

### New Hire Management
- View all new hires for a company
- See hire date, position, company association
- Update hire status
- Employer notification when new hire is recorded
- Track notifiedEmployer flag

### Data Validation
- Regex-based email validation (format check)
- Secondary email confirmation (must match primary)
- Phone number formatting validation
- Address validation (state + zip)

### Match Score Calculation
- Dynamic keyword matching against job requirements
- Education history comparison
- Work experience years comparison
- Final score: 1-10 (10 = perfect fit)

## Files
- `data/applicants.json` — All applicant records (includes hireRecords)
- `data/applications.json` — All application records
- `data/hires.json` — All hire records
- `data/observability.json` — Transaction logs

## API Endpoints (Applicant)
- `POST /api/applicants` — Create new applicant
- `GET /api/applicants/:id` — Get applicant profile (including hireRecords)
- `PUT /api/applicants/:id` — Update applicant profile
- `POST /api/applicants/:id/apply` — Submit application for a job
- `GET /api/applicants/:id/hires` — Get all hire records for applicant
- `POST /api/hires` — Create hire record (when accepted)
- `GET /api/companies/:id/hires` — Get all new hires for a company

## Roles
- `applicant`: View own profile and hire history
- `hiring-manager`: Create hire records, view company hires
- `recruiter`: View applications and hire statuses
- `member-services`: Full access to all hire records

## Observability
Every applicant/hire action creates an entry in `data/observability.json`.
