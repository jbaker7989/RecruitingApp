---
name: job-management
description: Manage job postings, company information, job application interfaces, and mass import functionality
---

# Job Management Skills

This skill governs all operations related to job posting management, company information, mass import, and job application interfaces in the New Fronteir Recruiting application.

## Core Functions

### Job Posting Management
- Create, read, update, and delete job postings
- Associate job postings with companies
- Display job details with company information (company name, description, location, size, industry)
- Track active/inactive status for each job

### Company Information Management
- Manage company profiles (name, description, location, size, industry)
- Display company context alongside job postings
- Show number of job openings per company

### Mass Job Import
- Accept CSV or JSON file upload from companies
- Parse file using `papaparse` (CSV) or native JSON parsing
- Validate each row/object against JobPosting schema
- Associate all parsed jobs with the uploading company
- Each job gets `isActive: true` and `currentApplications: 0`
- Summarize import results (count, successes, failures)
- Create observability log entries for each import

### Application Interface
- Allow applicants to browse job postings
- Click-through to view detailed job and company information
- Apply directly from job posting page
- Display application status to applicants
- Only active (`isActive: true`) jobs are browse-able

### Job Closure & Removal
- Auto-close when `currentApplications >= totalOpenings` (`isActive: false`)
- Manual close by hiring manager
- Closed jobs hidden from applicant browse listings
- Existing applications remain accessible
- Observability tracks every closure

### Data Display
- Show job title, position description, requirements, responsibilities, qualifications, required skills, experience needed, and who position reports to
- Display pay range
- Show position location
- Show required skills and experience

## Files
- `data/companies.json` — All company records
- `data/jobs.json` — All job postings
- `data/observability.json` — Transaction logs
- `data/imports/` — Imported files archive

## API Endpoints (Jobs)
- `GET /api/jobs` — List all active job postings with company info
- `GET /api/jobs/:id` — Get single job with full company details
- `POST /api/jobs` — Create new job posting (hiring-manager only)
- `PUT /api/jobs/:id` — Update job posting
- `DELETE /api/jobs/:id` — Delete job posting
- `POST /api/jobs/import` — Mass import from CSV/JSON (hiring-manager only)
- `GET /api/companies` — List all companies
- `GET /api/companies/:id` — Get company with its job postings
- `GET /api/companies/:id/jobs` — Get all jobs for a company (active + inactive)
- `GET /api/companies/:id/active-jobs` — Get only active jobs
- `POST /api/companies` — Create new company

## Click-Through Functionality
1. Applicant browses `/jobs` → sees all active job postings
2. Clicks on a job → sees full details + company info (name, description, location, size, industry)
3. Clicks "Apply" → application form
4. After submission → sees application status and match score
5. Inactive/closed jobs are NOT shown in browse

## Observability
Every job/company CRUD operation and import creates an observability entry with: timestamp, action type, entity type/ID, user ID, and outcome.

## Roles
- `applicant`: Browse active jobs and apply
- `hiring-manager`: Create, update, delete jobs, import jobs, close jobs
- `recruiter`: View jobs and applications
- `member-services`: Full access

## Import Details
- Supported formats: CSV and JSON
- CSV uses `papaparse` library for parsing
- Each import creates a record in `data/imports/`
- Import results include: total rows, successes, failures, validation errors
- Imported jobs are associated with the company that uploaded the file
